// The private retrieval route: an authenticated, read-only search of the indexed public portfolio.
// It never writes content, so it is neither audited nor announced; a failing provider is a typed
// 503, never "no evidence".
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SearchResultSchema, retrievalQueryMaxLength } from "@sebela/contracts";
import { demoSeedFolder, type RetrievalConfig } from "@sebela/services";
import { createFakeEmbedder } from "@sebela/services/testing";

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
  providerTimeoutMs: 1000,
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
      openTestBackend({ retrieval: { config, embedder: createFakeEmbedder() } }),
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
    const response = await search({ query: "What is a context window?" });

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
    const response = await search({ query: "zyxwv qpqpq mnbvc" });

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
