import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SearchResultSchema } from "@sebela/contracts";
import {
  createPersistence,
  demoSeedFolder,
  readDatabaseConfig,
  type Persistence,
} from "@sebela/db";
import { createTemporaryDatabase, type TemporaryDatabase } from "@sebela/db/testing";
import {
  createFakeEmbedder,
  createQueryCachingEmbedder,
  type RetrievalConfig,
} from "@sebela/memory";

import { DomainError } from "../../errors.js";
import { createProfileService } from "../profile/index.js";
import { createRoadmapService } from "../roadmap/index.js";
import { createSeedService } from "../seed/index.js";
import { openStorage } from "../storage/index.js";
import { createKnowledgeService, readRetrievalOptions, type KnowledgeService } from "./index.js";

const config: RetrievalConfig = {
  embeddingModel: "fake-hashed-words",
  embeddingPricePerMillionTokensUsd: 0.06,
  embeddingBatchSize: 16,
  providerTimeoutMs: 1000,
  providerRetries: 0,
  providerMaxRetryWaitMs: 0,
  monthlyCeilingUsd: 1,
  candidatePool: 30,
  finalPassages: 6,
  relevanceFloor: 0.1,
};

async function refusal(promise: Promise<unknown>): Promise<DomainError> {
  const error = await promise.then(
    () => null,
    (failure: unknown) => failure,
  );
  if (!(error instanceof DomainError))
    throw new Error(`Expected a domain error, got ${String(error)}`);
  return error;
}

describe("the knowledge service over the demo seed", () => {
  let database: TemporaryDatabase;
  let persistence: Persistence;
  let storageFolder: string;
  const embedder = createFakeEmbedder();
  let knowledge: KnowledgeService;

  const open = (options: Parameters<typeof createKnowledgeService>[1]) =>
    createKnowledgeService(
      {
        store: persistence.retrieval,
        profile: createProfileService(persistence.profile),
        roadmap: createRoadmapService(persistence.roadmap),
      },
      options,
    );

  beforeAll(async () => {
    database = await createTemporaryDatabase(readDatabaseConfig(process.env));
    persistence = createPersistence(database.config);
    storageFolder = await mkdtemp(join(tmpdir(), "sebela-knowledge-storage-"));
    const storage = openStorage({
      driver: "local",
      root: storageFolder,
      environment: "test",
      worktree: "knowledge",
      publicBaseUrl: "https://media.example.test/files",
    });
    await createSeedService(persistence, {
      storage,
      limits: { maxBytes: 10 * 1024 * 1024, maxImageDimension: 4000 },
      onCleanupFailure: () => undefined,
    }).loadSeed(demoSeedFolder);
    knowledge = open({ config, embedder });
  }, 60_000);

  afterAll(async () => {
    await persistence.close();
    await database.drop();
    await rm(storageFolder, { recursive: true, force: true });
  });

  it("indexes the demo seed once and embeds nothing the second time", async () => {
    const first = await knowledge.reindexPortfolio();
    expect(first.sources).toBeGreaterThan(20);
    expect(first.embedded).toBeGreaterThan(0);
    const usageAfterFirst = await knowledge.usage();
    expect(usageAfterFirst.byOperation.index.tokens).toBe(first.tokens);

    const callsBefore = embedder.calls;
    const second = await knowledge.reindexPortfolio();

    expect(second).toMatchObject({ sources: first.sources, updated: 0, embedded: 0, tokens: 0 });
    expect(embedder.calls).toBe(callsBefore);
    expect((await knowledge.usage()).byOperation.index).toEqual(usageAfterFirst.byOperation.index);
  });

  it("finds a glossary term with a contract passage pointing at its page", async () => {
    const result = await knowledge.search({
      query: "context window tokens a model reads in one request",
    });

    expect(SearchResultSchema.parse(result)).toEqual(result);
    expect(result.status).toBe("found");
    expect(result.passages[0]).toMatchObject({
      sourceKind: "portfolio",
      sourceId: "portfolio:glossary_term:context-window",
      path: "/ai-roadmap",
      provenance: { contentKind: "glossary_term" },
    });
    expect(result.passages.length).toBeLessThanOrEqual(config.finalPassages);
  });

  it("returns only the requested content kinds", async () => {
    const result = await knowledge.search({
      query: "context window tokens a model reads in one request",
      kinds: ["book", "service"],
    });
    for (const passage of result.passages) {
      expect(["book", "service"]).toContain(passage.provenance.contentKind);
    }
  });

  it("finds no evidence below the relevance floor", async () => {
    // The fake embedder hashes words into 1024 buckets; no demo-seed word shares these words' buckets.
    const unmatched = "glorpk vlemish drubnik";
    expect(await knowledge.search({ query: unmatched })).toEqual({
      status: "no_evidence",
      passages: [],
    });
  });

  it("names the candidate pool's sources for the evals", async () => {
    const [candidates = []] = await knowledge.candidates([{ query: "context window tokens" }]);
    expect(candidates[0]).toBe("portfolio:glossary_term:context-window");
    expect(candidates.length).toBeLessThanOrEqual(config.candidatePool);
  });

  it("reports a failing provider as unavailable, never as no evidence", async () => {
    const failing = open({ config, embedder: createFakeEmbedder({ failing: true }) });
    expect((await refusal(failing.search({ query: "context window" }))).code).toBe(
      "provider_unavailable",
    );
  });

  it("names the provider's HTTP status class, and only that, when it answered one", async () => {
    for (const [status, text] of [
      [429, "HTTP 429 (4xx, rate limited)"],
      [401, "HTTP 401 (4xx, refused)"],
      [503, "HTTP 503 (5xx, provider error)"],
    ] as const) {
      const failing = open({
        config,
        embedder: createFakeEmbedder({ failing: true, failureStatus: status }),
      });
      const error = await refusal(failing.search({ query: "context window" }));
      expect(error.code).toBe("provider_unavailable");
      expect(error.message).toBe(`The embedding provider is unavailable: it answered ${text}.`);
    }
    const silent = open({ config, embedder: createFakeEmbedder({ failing: true }) });
    expect((await refusal(silent.search({ query: "context window" }))).message).toBe(
      "The embedding provider is unavailable.",
    );
  });

  it("is unavailable without retrieval settings or an embedder", async () => {
    expect((await refusal(open({ config: null }).search({ query: "context window" }))).code).toBe(
      "provider_unavailable",
    );
    expect((await refusal(open({ config }).reindexPortfolio())).code).toBe("provider_unavailable");
  });

  it("refuses to search once the month's ceiling is reached", async () => {
    const spent = open({ config: { ...config, monthlyCeilingUsd: 0 }, embedder });
    expect((await refusal(spent.search({ query: "context window" }))).code).toBe(
      "budget_exhausted",
    );
  });
});

describe("keeping the knowledge base current after content writes", () => {
  let database: TemporaryDatabase;
  let persistence: Persistence;
  let storageFolder: string;

  const open = (options: Parameters<typeof createKnowledgeService>[1]) =>
    createKnowledgeService(
      {
        store: persistence.retrieval,
        profile: createProfileService(persistence.profile),
        roadmap: createRoadmapService(persistence.roadmap),
      },
      options,
    );
  const term = "portfolio:glossary_term:context-window";
  const query = { query: "context window tokens a model reads in one request" };
  const found = async (knowledge: KnowledgeService) =>
    (await knowledge.search(query)).passages.map((passage) => passage.sourceId);
  const changed = { domain: "roadmap-glossary-term", record: "context-window" } as const;

  beforeAll(async () => {
    database = await createTemporaryDatabase(readDatabaseConfig(process.env));
    persistence = createPersistence(database.config);
    storageFolder = await mkdtemp(join(tmpdir(), "sebela-knowledge-queue-storage-"));
    const storage = openStorage({
      driver: "local",
      root: storageFolder,
      environment: "test",
      worktree: "knowledge-queue",
      publicBaseUrl: "https://media.example.test/files",
    });
    await createSeedService(persistence, {
      storage,
      limits: { maxBytes: 10 * 1024 * 1024, maxImageDimension: 4000 },
      onCleanupFailure: () => undefined,
    }).loadSeed(demoSeedFolder);
    await open({ config, embedder: createFakeEmbedder() }).reindexPortfolio();
  }, 60_000);

  afterAll(async () => {
    await persistence.close();
    await database.drop();
    await rm(storageFolder, { recursive: true, force: true });
  });

  it("queues a change without retrieval settings and hides the record at once", async () => {
    await open({ config: null }).schedule([{ ...changed, action: "updated" }]);
    const knowledge = open({ config, embedder: createFakeEmbedder() });
    expect(await knowledge.pending()).toEqual({ pending: 1, failed: 0 });
    expect(await found(knowledge)).not.toContain(term);

    await expect(knowledge.processPending()).resolves.toMatchObject({
      completed: 1,
      remaining: { pending: 0, failed: 0 },
    });
    expect((await found(knowledge))[0]).toBe(term);
  });

  it("restores an unchanged record from stored vectors while the provider is unavailable", async () => {
    const offline = open({ config, embedder: createFakeEmbedder({ failing: true }) });
    await offline.schedule([{ domain: "service", record: "evaluation-setup", action: "updated" }]);
    await expect(offline.processPending()).resolves.toMatchObject({ completed: 1, embedded: 0 });
    expect(await offline.pending()).toEqual({ pending: 0, failed: 0 });
  });

  it("rebuilds every source once for a new model version and then from stored vectors", async () => {
    const next = { ...createFakeEmbedder(), version: "2" };
    const knowledge = open({ config, embedder: next });
    const first = await knowledge.rebuildPortfolio();
    expect(first.updated).toBe(first.sources);
    expect(first.embedded).toBeGreaterThan(0);
    expect((await found(knowledge))[0]).toBe(term);

    const second = await knowledge.rebuildPortfolio();
    expect(second).toMatchObject({ updated: first.sources, embedded: 0, tokens: 0 });
    const indexed = await persistence.retrieval.indexedSources();
    expect(indexed.every((source) => source.modelVersion === "2" && !source.stale)).toBe(true);
  });

  it("reports the provider and the ceiling as domain errors and keeps the work", async () => {
    await open({ config: null }).schedule([{ ...changed, action: "updated" }]);
    const knowledge = open({ config, embedder: createFakeEmbedder() });
    await persistence.retrieval.recordUsage({
      operation: "index",
      model: config.embeddingModel,
      tokens: 1,
      costUsd: config.monthlyCeilingUsd,
      occurredAt: new Date(),
    });
    // Restoring from stored vectors needs no budget, so a changed text is what meets the ceiling.
    const rebuilt = open({
      config,
      embedder: { ...createFakeEmbedder(), version: "3" },
    });
    expect((await refusal(rebuilt.processPending())).code).toBe("budget_exhausted");
    expect(await knowledge.pending()).toEqual({ pending: 1, failed: 0 });
    expect((await refusal(open({ config }).processPending())).code).toBe("provider_unavailable");
    expect((await refusal(open({ config }).rebuildPortfolio())).code).toBe("provider_unavailable");
  });
});

describe("readRetrievalOptions", () => {
  const settings = {
    RETRIEVAL_EMBEDDING_MODEL: "voyage-4",
    RETRIEVAL_EMBEDDING_PRICE_PER_MILLION_TOKENS_USD: "0.06",
    RETRIEVAL_EMBEDDING_BATCH_SIZE: "64",
    RETRIEVAL_PROVIDER_TIMEOUT_MS: "10000",
    RETRIEVAL_PROVIDER_RETRIES: "2",
    RETRIEVAL_PROVIDER_MAX_RETRY_WAIT_MS: "2000",
    RETRIEVAL_MONTHLY_CEILING_USD: "1",
    RETRIEVAL_CANDIDATE_POOL: "30",
    RETRIEVAL_FINAL_PASSAGES: "6",
    RETRIEVAL_RELEVANCE_FLOOR: "0.3",
  };
  const fakeKey = "fictional-voyage-key-for-tests";

  it("switches retrieval off without its settings", () => {
    expect(readRetrievalOptions({ VOYAGE_API_KEY: fakeKey })).toEqual({ config: null });
  });

  it("has no provider without a key, so searching is unavailable", () => {
    for (const key of [undefined, "", "  "]) {
      const options = readRetrievalOptions({ ...settings, VOYAGE_API_KEY: key });
      expect(options.config?.embeddingModel).toBe("voyage-4");
      expect(options.embedder).toBeUndefined();
    }
  });

  it("embeds with the configured Voyage model at the stored dimension", () => {
    const { embedder } = readRetrievalOptions({ ...settings, VOYAGE_API_KEY: fakeKey });
    expect(embedder?.model).toBe("voyage-4");
    expect(embedder?.dimension).toBe(1024);
  });

  it("searches by vectors unless an eval run asks for the full-text baseline", () => {
    const env = { ...settings, VOYAGE_API_KEY: fakeKey };
    expect(readRetrievalOptions(env).searchVariant).toBe("vector");
    expect(readRetrievalOptions({ ...env, RETRIEVAL_EVAL_VARIANT: "fulltext" }).searchVariant).toBe(
      "fulltext",
    );
    expect(() => readRetrievalOptions({ ...env, RETRIEVAL_EVAL_VARIANT: "hybrid" })).toThrow(
      /RETRIEVAL_EVAL_VARIANT/,
    );
  });

  it("names invalid settings, never the key", () => {
    expect(() =>
      readRetrievalOptions({ ...settings, RETRIEVAL_FINAL_PASSAGES: "0", VOYAGE_API_KEY: fakeKey }),
    ).toThrow(/RETRIEVAL_FINAL_PASSAGES/);
    try {
      readRetrievalOptions({ ...settings, RETRIEVAL_FINAL_PASSAGES: "0", VOYAGE_API_KEY: fakeKey });
    } catch (error) {
      expect(String(error)).not.toContain(fakeKey);
    }
  });

  it("serves eval queries from the cache file when one is set, and needs an absolute path", async () => {
    const folder = await mkdtemp(join(tmpdir(), "sebela-query-cache-"));
    try {
      const file = join(folder, "queries.json");
      const voyage = readRetrievalOptions({ ...settings, VOYAGE_API_KEY: fakeKey }).embedder;
      if (voyage === undefined) throw new Error("a Voyage embedder");
      const fake = createFakeEmbedder();
      const prefilled = await createQueryCachingEmbedder(
        {
          model: voyage.model,
          version: voyage.version,
          dimension: 1024,
          embed: (texts, input) => fake.embed(texts, input),
        },
        file,
      ).embed(["golden sets"], "query");

      const { embedder } = readRetrievalOptions({
        ...settings,
        VOYAGE_API_KEY: fakeKey,
        RETRIEVAL_QUERY_CACHE_FILE: file,
      });
      // The fictional key would be refused by the provider; only the cache can answer.
      expect(await embedder?.embed(["golden sets"], "query")).toEqual({
        vectors: prefilled.vectors,
        tokens: 0,
      });
      expect(() =>
        readRetrievalOptions({
          ...settings,
          VOYAGE_API_KEY: fakeKey,
          RETRIEVAL_QUERY_CACHE_FILE: "queries.json",
        }),
      ).toThrow(/RETRIEVAL_QUERY_CACHE_FILE/);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
});
