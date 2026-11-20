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
import { createFakeEmbedder, type RetrievalConfig } from "@sebela/memory";

import { DomainError } from "../../errors.js";
import { createProfileService } from "../profile/index.js";
import { createRoadmapService } from "../roadmap/index.js";
import { createSeedService } from "../seed/index.js";
import { openStorage } from "../storage/index.js";
import { createKnowledgeService, type KnowledgeService } from "./index.js";

const config: RetrievalConfig = {
  embeddingModel: "fake-hashed-words",
  embeddingPricePerMillionTokensUsd: 0.06,
  embeddingBatchSize: 16,
  providerTimeoutMs: 1000,
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
    expect(await knowledge.search({ query: "zyxwvut plughqwerty frobnicated" })).toEqual({
      status: "no_evidence",
      passages: [],
    });
  });

  it("names the candidate pool's sources for the evals", async () => {
    const candidates = await knowledge.candidates("context window tokens");
    expect(candidates[0]).toBe("portfolio:glossary_term:context-window");
    expect(candidates.length).toBeLessThanOrEqual(config.candidatePool);
  });

  it("reports a failing provider as unavailable, never as no evidence", async () => {
    const failing = open({ config, embedder: createFakeEmbedder({ failing: true }) });
    expect((await refusal(failing.search({ query: "context window" }))).code).toBe(
      "provider_unavailable",
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
