// The knowledge index after content writes: a write through the API queues indexing, a deleted
// record leaves search at once, and the queue brings the change into search in the background
// without ever failing or delaying the write. Real Postgres, the fake embedder.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SearchResultSchema } from "@sebela/contracts";
import {
  DomainError,
  demoSeedFolder,
  type Embedder,
  type KnowledgeService,
  type RetrievalConfig,
} from "@sebela/services";
import { createFakeEmbedder } from "@sebela/services/testing";

import {
  createIndexingQueue,
  type IndexingQueue,
  type IndexingQueueOptions,
} from "./modules/indexing/index.js";
import { bearer, connection, json, openTestBackend, type TestBackend } from "./test-support.js";

const config: RetrievalConfig = {
  embeddingModel: "fake",
  embeddingPricePerMillionTokensUsd: 0.06,
  embeddingBatchSize: 32,
  rerankModel: "fake-word-overlap",
  rerankPricePerMillionTokensUsd: 0.05,
  providerTimeoutMs: 1000,
  providerRetries: 0,
  providerMaxRetryWaitMs: 0,
  monthlyCeilingUsd: 1,
  candidatePool: 20,
  finalPassages: 6,
  relevanceFloor: 0.1,
};

/**
 * The fake embedder, which holds every call while `hold` is set and reports the first held call
 * through `held`, so a test can write while a run is embedding.
 */
function gatedEmbedder() {
  const fake = createFakeEmbedder();
  const gate: { hold: Promise<void> | null; held: () => void } = {
    hold: null,
    held: () => undefined,
  };
  const embedder: Embedder = {
    model: fake.model,
    version: fake.version,
    dimension: fake.dimension,
    embed: async (texts, input, signal) => {
      if (gate.hold !== null) {
        gate.held();
        await gate.hold;
      }
      return fake.embed(texts, input, signal);
    },
  };
  /** Holds the provider; resolves `reached` once a call waits, and `release` lets it go on. */
  const close = () => {
    let release: () => void = () => undefined;
    gate.hold = new Promise<void>((resolve) => {
      release = () => {
        gate.hold = null;
        resolve();
      };
    });
    const reached = new Promise<void>((resolve) => {
      gate.held = resolve;
    });
    return {
      reached,
      release: () => {
        release();
      },
    };
  };
  return { embedder, close };
}

describe("indexing after content writes", () => {
  let backend: TestBackend;
  let auth: Record<string, string>;
  let lines: string[];
  const provider = gatedEmbedder();

  beforeAll(async () => {
    backend = await openTestBackend({ retrieval: { config, embedder: provider.embedder } });
    await backend.services.seed.loadSeed(demoSeedFolder);
    await backend.services.knowledge.reindexPortfolio();
    auth = bearer((await backend.services.apiKeys.createKey("indexing")).key);
  });

  afterAll(async () => {
    await backend.close();
  });

  const queueOver = (knowledge: IndexingQueueOptions["knowledge"], retryDelaysMs = [0]) => {
    lines = [];
    return createIndexingQueue({ knowledge, log: (line) => lines.push(line), retryDelaysMs });
  };

  const write = (queue: IndexingQueue, path: string, method: string, init: RequestInit) =>
    backend.api({ onWrite: queue.notify }).app.request(path, { ...init, method }, connection());

  const found = async (query: string) =>
    SearchResultSchema.parse(await backend.services.knowledge.search({ query })).passages.map(
      (passage) => passage.sourceId,
    );

  it("makes an edited project searchable once the queue has run", async () => {
    const queue = queueOver(backend.services.knowledge);
    const response = await write(
      queue,
      "/v1/projects/warehouse-picking",
      "PATCH",
      json({ summary: "Quokka lanterns guide pickers through both warehouses." }, auth),
    );
    expect(response.status).toBe(200);

    await queue.idle();
    expect((await found("quokka lanterns guide pickers"))[0]).toBe(
      "portfolio:project:warehouse-picking",
    );
    expect(await backend.services.knowledge.pending()).toEqual({ pending: 0, failed: 0 });
    await queue.close();
  });

  it("removes a deleted project's passages at once, before the queue runs", async () => {
    const query = "small tool that compares headline variants on a share of readers";
    expect(await found(query)).toContain("portfolio:project:headline-tester");
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { knowledge } = backend.services;
    const queue = queueOver({
      schedule: (changes) => knowledge.schedule(changes),
      processPending: async (options) => {
        await gate;
        return knowledge.processPending(options);
      },
    });

    const response = await write(queue, "/v1/projects/headline-tester", "DELETE", {
      headers: auth,
    });
    expect(response.status).toBe(204);
    expect(await found(query)).not.toContain("portfolio:project:headline-tester");

    release();
    await queue.idle();
    expect(await found(query)).not.toContain("portfolio:project:headline-tester");
    await queue.close();
  });

  it("keeps the write and the work while the provider fails, and finishes after a restart", async () => {
    const { knowledge } = backend.services;
    let runs = 0;
    const offline = queueOver({
      schedule: (changes) => knowledge.schedule(changes),
      processPending: () => {
        runs += 1;
        return Promise.reject(
          new DomainError("provider_unavailable", "The embedding provider is unavailable."),
        );
      },
    });
    const response = await write(
      offline,
      "/v1/projects/booking-portal",
      "PATCH",
      json({ summary: "Ocelot dispatchers book freight from a single page." }, auth),
    );
    expect(response.status).toBe(200);
    await offline.idle();
    expect(runs).toBe(2);
    expect(await knowledge.pending()).toEqual({ pending: 1, failed: 0 });
    expect(await found("ocelot dispatchers book freight")).not.toContain(
      "portfolio:project:booking-portal",
    );
    expect(lines.join("\n")).toContain("provider_unavailable");
    expect(lines.join("\n")).not.toContain("Ocelot");
    await offline.close();

    const restarted = queueOver(knowledge);
    restarted.start();
    await restarted.idle();
    expect(await knowledge.pending()).toEqual({ pending: 0, failed: 0 });
    expect((await found("ocelot dispatchers book freight"))[0]).toBe(
      "portfolio:project:booking-portal",
    );
    await restarted.close();
  });

  /** A queue whose runs never reach the provider, as while it is down. */
  const offlineQueue = (knowledge: KnowledgeService) =>
    queueOver({
      schedule: (changes) => knowledge.schedule(changes),
      processPending: () =>
        Promise.reject(
          new DomainError("provider_unavailable", "The embedding provider is unavailable."),
        ),
    });

  const passageTexts = async (query: string) =>
    SearchResultSchema.parse(await backend.services.knowledge.search({ query })).passages.map(
      (passage) => passage.text,
    );

  it("takes a deleted testimonial's quote out of search at once, while the provider is down", async () => {
    const quote = "That is why we trusted it with our archive.";
    expect((await passageTexts(quote)).join("\n")).toContain(quote);
    const { knowledge } = backend.services;
    const offline = offlineQueue(knowledge);

    const response = await write(offline, "/v1/testimonials/lumen-editor-in-chief", "DELETE", {
      headers: auth,
    });
    expect(response.status).toBe(204);
    await offline.idle();
    expect((await passageTexts(quote)).join("\n")).not.toContain(quote);
    await offline.close();

    const restarted = queueOver(knowledge);
    restarted.start();
    await restarted.idle();
    expect(await knowledge.pending()).toEqual({ pending: 0, failed: 0 });
    expect((await passageTexts(quote)).join("\n")).not.toContain(quote);
    expect(await found("staff engineer at Lumen Press")).toContain(
      "portfolio:experience:lumen-press-staff-engineer",
    );
    await restarted.close();
  });

  it("does not bring back a project deleted while a run is embedding", async () => {
    const { knowledge } = backend.services;
    const offline = offlineQueue(knowledge);
    const patched = await write(
      offline,
      "/v1/projects/community-catalogue",
      "PATCH",
      json({ summary: "Narwhal librarians lend kayaks across the island." }, auth),
    );
    expect(patched.status).toBe(200);
    await offline.idle();

    const gate = provider.close();
    const run = knowledge.processPending();
    await gate.reached;
    const deleted = await write(offline, "/v1/projects/community-catalogue", "DELETE", {
      headers: auth,
    });
    expect(deleted.status).toBe(204);
    await offline.idle();
    gate.release();
    await run;

    expect(await found("narwhal librarians lend kayaks")).not.toContain(
      "portfolio:project:community-catalogue",
    );
    expect(await knowledge.pending()).toEqual({ pending: 1, failed: 0 });
    await knowledge.processPending();
    expect(await knowledge.pending()).toEqual({ pending: 0, failed: 0 });
    expect(await found("narwhal librarians lend kayaks")).not.toContain(
      "portfolio:project:community-catalogue",
    );
    await offline.close();
  });

  it("keeps a project hidden that was edited again while a run was embedding", async () => {
    const { knowledge } = backend.services;
    const offline = offlineQueue(knowledge);
    const edit = (summary: string) =>
      write(offline, "/v1/projects/warehouse-picking", "PATCH", json({ summary }, auth));
    expect((await edit("Pelican couriers sort parcels by moonlight.")).status).toBe(200);
    await offline.idle();

    const gate = provider.close();
    const run = knowledge.processPending();
    await gate.reached;
    expect((await edit("Otter forklifts stack crates before dawn.")).status).toBe(200);
    await offline.idle();
    gate.release();
    await run;

    expect(await found("pelican couriers sort parcels by moonlight")).not.toContain(
      "portfolio:project:warehouse-picking",
    );
    expect(await knowledge.pending()).toEqual({ pending: 1, failed: 0 });
    await knowledge.processPending();
    expect((await found("otter forklifts stack crates before dawn"))[0]).toBe(
      "portfolio:project:warehouse-picking",
    );
    await offline.close();
  });

  it("stops at the ceiling without a retry and keeps the work", async () => {
    const { knowledge } = backend.services;
    let runs = 0;
    const spent = queueOver(
      {
        schedule: (changes) => knowledge.schedule(changes),
        processPending: () => {
          runs += 1;
          return Promise.reject(
            new DomainError("budget_exhausted", "The month's embedding budget is exhausted."),
          );
        },
      },
      [0, 0, 0],
    );
    await spent.notify({
      change: { domain: "service", record: "evaluation-setup", action: "updated" },
    });
    await spent.idle();
    expect(runs).toBe(1);
    expect(await knowledge.pending()).toEqual({ pending: 1, failed: 0 });
    expect(lines.join("\n")).toContain("budget_exhausted");
    await spent.close();

    const queue = queueOver(knowledge);
    queue.start();
    await queue.idle();
    expect(await knowledge.pending()).toEqual({ pending: 0, failed: 0 });
    await queue.close();
  });

  it("never fails or delays a write when queueing fails", async () => {
    const queue = queueOver({
      schedule: () => Promise.reject(new TypeError("connection refused to db.internal")),
      processPending: () => Promise.reject(new Error("unused")),
    });
    await expect(
      queue.notify({
        change: { domain: "service", record: "evaluation-setup", action: "updated" },
      }),
    ).resolves.toBeUndefined();
    await queue.idle();
    expect(lines.join("\n")).toContain("TypeError");
    expect(lines.join("\n")).not.toContain("db.internal");
    await queue.close();
  });

  it("ignores changes once closed", async () => {
    let scheduled = 0;
    const queue = queueOver({
      schedule: () => {
        scheduled += 1;
        return Promise.resolve();
      },
      processPending: () => Promise.reject(new Error("unused")),
    });
    await queue.close();
    await queue.notify({
      change: { domain: "service", record: "evaluation-setup", action: "updated" },
    });
    expect(scheduled).toBe(0);
  });
});
