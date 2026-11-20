// The knowledge index after content writes: a write through the API queues indexing, a deleted
// record leaves search at once, and the queue brings the change into search in the background
// without ever failing or delaying the write. Real Postgres, the fake embedder.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SearchResultSchema } from "@sebela/contracts";
import { DomainError, demoSeedFolder, type RetrievalConfig } from "@sebela/services";
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
  providerTimeoutMs: 1000,
  providerRetries: 0,
  providerMaxRetryWaitMs: 0,
  monthlyCeilingUsd: 1,
  candidatePool: 20,
  finalPassages: 6,
  relevanceFloor: 0.1,
};

describe("indexing after content writes", () => {
  let backend: TestBackend;
  let auth: Record<string, string>;
  let lines: string[];

  beforeAll(async () => {
    backend = await openTestBackend({ retrieval: { config, embedder: createFakeEmbedder() } });
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
