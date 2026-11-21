// The private retrieval route: an authenticated, read-only search of the indexed public portfolio.
// It never writes content, so it is neither audited nor announced; a failing provider is a typed
// 503, never "no evidence".
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SearchResultSchema, retrievalQueryMaxLength } from "@sebela/contracts";
import { demoSeedFolder, openPrivateStorage, type RetrievalConfig } from "@sebela/services";
import { createFakeEmbedder, createFakeReranker } from "@sebela/services/testing";

import {
  anyText,
  bearer,
  connection,
  json,
  openTestBackend,
  type TestBackend,
} from "./test-support.js";

const SEARCH = "/v1/retrieval/search";

/** Settings for the fake embedder, whose similarities are low: a floor that keeps real matches. */
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

describe("POST /v1/retrieval/search", () => {
  let backend: TestBackend;
  let failing: TestBackend;
  let key: string;
  let failingKey: string;

  beforeAll(async () => {
    [backend, failing] = await Promise.all([
      openTestBackend({
        retrieval: { config, embedder: createFakeEmbedder(), reranker: createFakeReranker() },
      }),
      openTestBackend({ retrieval: { config, embedder: createFakeEmbedder({ failing: true }) } }),
    ]);
    await backend.services.seed.loadSeed(demoSeedFolder);
    await backend.services.knowledge.reindexPortfolio();
    ({ key } = await backend.services.apiKeys.createKey("retrieval search"));
    ({ key: failingKey } = await failing.services.apiKeys.createKey("retrieval failing"));
  });

  afterAll(async () => {
    await Promise.all([backend.close(), failing.close()]);
  });

  const search = (body: unknown, headers: Record<string, string> = bearer(key), on = backend) =>
    on.api().app.request(SEARCH, { method: "POST", ...json(body, headers) }, connection());

  it("refuses a request without a valid API key", async () => {
    for (const headers of [{}, bearer(`sebela_0123456789abcdef_${"A".repeat(43)}`)]) {
      const response = await search({ query: "context window" }, headers);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: { code: "unauthorized", message: anyText } });
    }
  });

  it("refuses an oversized query, an unknown content kind and unknown fields", async () => {
    for (const body of [
      { query: "x".repeat(retrievalQueryMaxLength + 1) },
      { query: "" },
      { query: "context window", kinds: ["secret_notes"] },
      { query: "context window", limit: 99 },
      { query: "context window", filter: "anything" },
    ]) {
      const response = await search(body);
      expect(response.status, JSON.stringify(body).slice(0, 80)).toBe(400);
    }
  });

  it("returns portfolio passages that validate against the contract", async () => {
    // The fake embedder is a bag of words, so stop words would rank long records first: the query
    // names the glossary term's own words.
    const response = await search({ query: "context window tokens a model reads in one request" });

    expect(response.status).toBe(200);
    const result = SearchResultSchema.parse(await response.json());
    expect(result.status).toBe("found");
    expect(result.passages.length).toBeGreaterThan(0);
    expect(result.passages.length).toBeLessThanOrEqual(config.finalPassages);
    expect(result.passages.map((passage) => passage.sourceId)).toContain(
      "portfolio:glossary_term:context-window",
    );
  });

  it("filters by content kind and honours the limit", async () => {
    const response = await search({
      query: "context window",
      kinds: ["glossary_term"],
      limit: 2,
    });

    expect(response.status).toBe(200);
    const result = SearchResultSchema.parse(await response.json());
    expect(result.passages.length).toBeLessThanOrEqual(2);
    for (const passage of result.passages) {
      expect(passage.provenance.contentKind).toBe("glossary_term");
    }
  });

  it("returns no evidence below the relevance floor", async () => {
    // The fake embedder hashes words into 1024 buckets; no demo-seed word shares these words' buckets.
    const unmatched = "glorpk vlemish drubnik";
    const response = await search({ query: unmatched });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "no_evidence", passages: [] });
  });

  it("answers a failing provider with the typed unavailable error, never no evidence", async () => {
    const response = await search({ query: "context window" }, bearer(failingKey), failing);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: { code: "provider_unavailable", message: anyText },
    });
  });

  it("is documented as a private, read-only route that audits nothing", () => {
    expect(backend.api().routes).toContainEqual({
      method: "POST",
      path: SEARCH,
      access: "private",
      hasBody: true,
      audit: null,
    });
  });

  it("announces no content change", async () => {
    const writes: unknown[] = [];
    const api = backend.api({
      onWrite: (event) => {
        writes.push(event);
        return Promise.resolve();
      },
    });

    const response = await api.app.request(
      SEARCH,
      { method: "POST", ...json({ query: "context window" }, bearer(key)) },
      connection(),
    );

    expect(response.status).toBe(200);
    expect(writes).toEqual([]);
  });
});

describe("supplemental documents in POST /v1/retrieval/search", () => {
  let backend: TestBackend;
  let key: string;
  let privateRoot: string;

  // Three fictional documents that share their words, so one query matches each of them.
  const document = (place: string) =>
    new TextEncoder().encode(
      `# Lantern ${place}\n\nThe lantern ferry to ${place} leaves the quay at dawn.\n`,
    );

  beforeAll(async () => {
    privateRoot = await mkdtemp(join(tmpdir(), "sebela-api-private-"));
    const privateStorage = openPrivateStorage({
      driver: "local",
      root: privateRoot,
      environment: "test",
      worktree: null,
    });
    backend = await openTestBackend({
      retrieval: {
        config,
        embedder: createFakeEmbedder(),
        reranker: createFakeReranker(),
        privateStorage,
      },
    });
    ({ key } = await backend.services.apiKeys.createKey("retrieval documents"));
    const { knowledge } = backend.services;
    const ingest = (slug: string, place: string) =>
      knowledge.ingestDocument({
        slug,
        title: `Lantern ${place}`,
        fileName: `${slug}.md`,
        bytes: document(place),
      });
    await ingest("lantern-pending", "Northmoor");
    const rejected = await ingest("lantern-rejected", "Eastmere");
    await knowledge.rejectDocument(rejected.version.contentHash);
    const approved = await ingest("lantern-approved", "Westholm");
    await knowledge.approveDocument(approved.version.contentHash);
  });

  afterAll(async () => {
    await backend.close();
    await rm(privateRoot, { recursive: true, force: true });
  });

  it("finds the approved version only, never a pending or rejected one", async () => {
    const response = await backend
      .api()
      .app.request(
        SEARCH,
        { method: "POST", ...json({ query: "lantern ferry quay dawn" }, bearer(key)) },
        connection(),
      );

    expect(response.status).toBe(200);
    const result = SearchResultSchema.parse(await response.json());
    const sources = new Set(result.passages.map((passage) => passage.sourceId));
    expect([...sources]).toEqual(["document:lantern-approved"]);
    expect(result.passages[0]).toMatchObject({
      sourceKind: "supplemental",
      title: "Lantern Westholm",
    });
    expect(result.passages[0]).not.toHaveProperty("path");
  });

  it("never serves a private original through the media route", async () => {
    const entries = await readdir(privateRoot, { recursive: true, withFileTypes: true });
    const keys = entries
      .filter((entry) => entry.isFile())
      .map((entry) => relative(privateRoot, join(entry.parentPath, entry.name)));
    // The pending and the approved originals are kept; the rejected one is gone.
    expect(keys).toHaveLength(2);
    for (const stored of keys) {
      const response = await backend
        .api()
        .app.request(`/v1/media/files/${stored}`, {}, connection());
      expect(response.status, stored).toBe(404);
    }
  });
});
