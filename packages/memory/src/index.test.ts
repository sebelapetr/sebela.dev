import { SearchResultSchema } from "@sebela/contracts";
import { describe, expect, it } from "vitest";

import {
  BudgetExhaustedError,
  ProviderUnavailableError,
  createFakeEmbedder,
  createIndexer,
  createRetriever,
  type Embedder,
  type IndexedSource,
  type NearestChunk,
  type NearestQuery,
  type PortfolioSnapshot,
  type RetrievalConfig,
  type RetrievalStore,
  type SourceKind,
  type SourceVersion,
  type UsageRecord,
  type UsageTotals,
} from "./index.js";

// The knowledge base through its package interface, over an in-memory store and the fake
// embedder. The same behaviour against Postgres/pgvector is covered in `@sebela/services`.

const NOW = new Date("2026-11-20T10:00:00.000Z");

const config: RetrievalConfig = {
  embeddingModel: "voyage-4",
  embeddingPricePerMillionTokensUsd: 0.06,
  embeddingBatchSize: 4,
  providerTimeoutMs: 1000,
  providerRetries: 0,
  providerMaxRetryWaitMs: 0,
  monthlyCeilingUsd: 1,
  candidatePool: 30,
  finalPassages: 5,
  relevanceFloor: 0.2,
};

/** A small fictional portfolio. */
function snapshot(): PortfolioSnapshot {
  return {
    person: {
      name: "Alex Example",
      headline: "Engineer building evaluated retrieval systems",
      shortBio: "Builds editorial tools and search for small publishers.",
      longBio: null,
      location: "Harbour City",
      availability: "Open to short consulting engagements.",
      servicesIntro: null,
      collaborationSteps: [{ title: "Discovery", description: "A call about the problem." }],
      servicesNote: null,
    },
    experiences: [
      {
        slug: "lumen-press-staff-engineer",
        title: "Staff engineer",
        summary: "Leads the editorial platform team at a fictional publisher.",
        responsibilities: ["Owns the article pipeline", "Mentors two engineers"],
        organization: { name: "Lumen Press" },
        technologies: [{ name: "TypeScript" }, { name: "Postgres" }],
      },
    ],
    projects: [
      {
        slug: "reading-assistant",
        experience: "lumen-press-staff-engineer",
        name: "Reading assistant",
        summary: "Answers reader questions from the archive.",
        problem: "Readers could not find older articles.",
        workDone: "Built hybrid search with a reranker over the archive.",
        result: "Archive visits doubled.",
        technologies: [{ name: "pgvector" }],
      },
    ],
    caseStudies: [
      {
        project: "reading-assistant",
        role: "Technical lead",
        body: "We started from a question set and measured recall before every change.",
      },
    ],
    explorations: [],
    services: [
      {
        slug: "evaluation-setup",
        name: "Evaluation setup",
        summary: "A question set and metrics for an existing assistant.",
        audience: "Teams shipping a chatbot.",
        deliverable: "A repeatable eval run.",
      },
    ],
    education: [],
    testimonials: [
      {
        slug: "editor-in-chief",
        experience: "lumen-press-staff-engineer",
        quote: "Calm under deadlines.",
        authorName: "Jordan Sample",
        authorRole: "Editor in chief",
      },
    ],
    roadmap: {
      areas: [
        {
          slug: "foundations",
          name: "Foundations",
          description: "Embeddings, tokens and similarity.",
          modules: [
            {
              slug: "embeddings",
              name: "Embeddings",
              description: "What an embedding vector captures.",
              resources: [
                {
                  slug: "cosine-similarity-notes",
                  name: "Cosine similarity notes",
                  description: "Why normalized vectors make cosine a dot product.",
                },
              ],
            },
          ],
        },
      ],
    },
    diary: { days: [{ date: "2025-02-10", notes: "Compared chunk sizes on the archive." }] },
    books: [],
    events: [],
    glossary: [
      { slug: "grounding", term: "Grounding", description: "Answering only from given sources." },
    ],
  };
}

const emptyUsage = (): UsageTotals => ({
  tokens: 0,
  costUsd: 0,
  byOperation: {
    index: { tokens: 0, costUsd: 0 },
    search: { tokens: 0, costUsd: 0 },
    candidates: { tokens: 0, costUsd: 0 },
  },
});

const cosine = (a: readonly number[], b: readonly number[]) => {
  let dot = 0;
  let left = 0;
  let right = 0;
  a.forEach((value, index) => {
    const other = b[index] ?? 0;
    dot += value * other;
    left += value * value;
    right += other * other;
  });
  return left === 0 || right === 0 ? 0 : dot / Math.sqrt(left * right);
};

/** An in-memory `RetrievalStore` with the same observable behaviour as the Postgres one. */
function memoryStore() {
  const sources = new Map<string, SourceVersion>();
  const usage: UsageRecord[] = [];
  const store: RetrievalStore = {
    indexedSources: () =>
      Promise.resolve(
        [...sources.values()].map((source): IndexedSource => ({
          sourceId: source.sourceId,
          version: source.version,
          model: source.model,
          modelVersion: source.modelVersion,
        })),
      ),
    vectorsByHash: (hashes, model, modelVersion) => {
      const found = new Map<string, readonly number[]>();
      for (const source of sources.values()) {
        if (source.model !== model || source.modelVersion !== modelVersion) continue;
        for (const chunk of source.chunks) {
          if (hashes.includes(chunk.textHash)) found.set(chunk.textHash, chunk.vector);
        }
      }
      return Promise.resolve(found);
    },
    replaceSource: (source) => {
      sources.set(source.sourceId, source);
      return Promise.resolve();
    },
    removeSourcesExcept: (sourceKind: SourceKind, sourceIds) => {
      let removed = 0;
      for (const [id, source] of sources) {
        if (source.sourceKind === sourceKind && !sourceIds.includes(id)) {
          sources.delete(id);
          removed += 1;
        }
      }
      return Promise.resolve(removed);
    },
    recordUsage: (record) => {
      usage.push(record);
      return Promise.resolve();
    },
    usageSince: (since) => {
      const totals = emptyUsage();
      const byOperation = { ...totals.byOperation };
      let tokens = 0;
      let costUsd = 0;
      for (const record of usage) {
        if (record.occurredAt < since) continue;
        tokens += record.tokens;
        costUsd += record.costUsd;
        const current = byOperation[record.operation];
        byOperation[record.operation] = {
          tokens: current.tokens + record.tokens,
          costUsd: current.costUsd + record.costUsd,
        };
      }
      return Promise.resolve({ tokens, costUsd, byOperation });
    },
    nearest: (query: NearestQuery) => {
      const found: NearestChunk[] = [];
      for (const source of sources.values()) {
        if (source.model !== query.model || source.modelVersion !== query.modelVersion) continue;
        if (query.kinds !== undefined && !query.kinds.includes(source.contentKind)) continue;
        for (const chunk of source.chunks) {
          const section = source.sections.find((each) => each.ordinal === chunk.sectionOrdinal);
          found.push({
            sourceId: source.sourceId,
            sourceKind: source.sourceKind,
            contentKind: source.contentKind,
            title: source.title,
            path: source.path,
            version: source.version,
            text: chunk.text,
            headingPath: section?.headingPath ?? [],
            indexedAt: source.indexedAt,
            similarity: cosine(query.vector, chunk.vector),
          });
        }
      }
      found.sort((a, b) => b.similarity - a.similarity);
      return Promise.resolve(found.slice(0, query.limit));
    },
  };
  return { store, sources, usage };
}

function knowledgeBase(options: { embedder?: Embedder; config?: Partial<RetrievalConfig> } = {}) {
  const memory = memoryStore();
  const embedder = options.embedder ?? createFakeEmbedder();
  const settings = { ...config, ...options.config };
  const parts = { store: memory.store, embedder, config: settings, now: () => NOW };
  return { ...memory, indexer: createIndexer(parts), retriever: createRetriever(parts) };
}

describe("indexing the portfolio", () => {
  it("embeds every chunk once and nothing when it is indexed again unchanged", async () => {
    const embedder = createFakeEmbedder();
    const { indexer, usage } = knowledgeBase({ embedder });

    const first = await indexer.reindexPortfolio(snapshot());
    expect(first.sources).toBeGreaterThan(5);
    expect(first.embedded).toBeGreaterThan(0);
    expect(first.updated).toBe(first.sources);
    const calls = embedder.calls;
    expect(usage.filter((record) => record.operation === "index")).toHaveLength(calls);

    const second = await indexer.reindexPortfolio(snapshot());
    expect(second).toMatchObject({ sources: first.sources, updated: 0, embedded: 0, tokens: 0 });
    expect(embedder.calls).toBe(calls);
    expect(usage.filter((record) => record.operation === "index")).toHaveLength(calls);
  });

  it("records the tokens and estimated cost of every provider call", async () => {
    const { indexer } = knowledgeBase();
    const report = await indexer.reindexPortfolio(snapshot());
    const usage = await indexer.usage();
    expect(usage.byOperation.index.tokens).toBe(report.tokens);
    expect(usage.byOperation.index.costUsd).toBeCloseTo(
      (report.tokens / 1_000_000) * config.embeddingPricePerMillionTokensUsd,
      12,
    );
  });

  it("embeds in batches no larger than configured", async () => {
    const sizes: number[] = [];
    const fake = createFakeEmbedder();
    const embedder: Embedder = {
      model: fake.model,
      version: fake.version,
      dimension: fake.dimension,
      embed: (texts, input, signal) => {
        sizes.push(texts.length);
        return fake.embed(texts, input, signal);
      },
    };
    const { indexer } = knowledgeBase({ embedder, config: { embeddingBatchSize: 2 } });
    await indexer.reindexPortfolio(snapshot());
    expect(sizes.length).toBeGreaterThan(1);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(2);
  });

  it("re-embeds only the changed record and removes a deleted one", async () => {
    const embedder = createFakeEmbedder();
    const { indexer, sources } = knowledgeBase({ embedder });
    await indexer.reindexPortfolio(snapshot());

    const changed = snapshot();
    const service = changed.services[0];
    if (service === undefined) throw new Error("fixture");
    const next: PortfolioSnapshot = {
      ...changed,
      services: [{ ...service, deliverable: "A repeatable eval run with a published report." }],
      glossary: [],
    };
    const report = await indexer.reindexPortfolio(next);
    expect(report.updated).toBe(1);
    expect(report.removed).toBe(1);
    expect(report.embedded).toBeGreaterThan(0);
    expect(sources.has("portfolio:glossary_term:grounding")).toBe(false);
  });

  it("never indexes the contact email", async () => {
    const { indexer, sources } = knowledgeBase();
    const withEmail = snapshot();
    await indexer.reindexPortfolio({
      ...withEmail,
      person: withEmail.person && { ...withEmail.person, email: "alex@example.test" },
    } as PortfolioSnapshot);
    const texts = [...sources.values()].flatMap((source) => source.chunks.map((c) => c.text));
    expect(texts.join("\n")).not.toContain("alex@example.test");
  });

  it("stops before a batch the monthly ceiling no longer allows", async () => {
    const { indexer, store } = knowledgeBase();
    await store.recordUsage({
      operation: "index",
      model: config.embeddingModel,
      tokens: 1,
      costUsd: config.monthlyCeilingUsd,
      occurredAt: NOW,
    });
    await expect(indexer.reindexPortfolio(snapshot())).rejects.toBeInstanceOf(BudgetExhaustedError);
  });

  it("does not count last month's spend against the ceiling", async () => {
    const { indexer, store } = knowledgeBase();
    await store.recordUsage({
      operation: "index",
      model: config.embeddingModel,
      tokens: 1,
      costUsd: config.monthlyCeilingUsd,
      occurredAt: new Date("2026-10-31T23:59:59.000Z"),
    });
    await expect(indexer.reindexPortfolio(snapshot())).resolves.toMatchObject({
      sources: 10,
      updated: 10,
    });
  });
});

describe("searching the portfolio", () => {
  it("returns contract passages from the best sources, with their canonical paths", async () => {
    const { indexer, retriever } = knowledgeBase();
    await indexer.reindexPortfolio(snapshot());

    const result = await retriever.search({ query: "hybrid search reranker archive" });
    expect(SearchResultSchema.parse(result)).toEqual(result);
    expect(result.status).toBe("found");
    const [best] = result.passages;
    expect(best).toMatchObject({
      sourceKind: "portfolio",
      sourceId: "portfolio:project:reading-assistant",
      path: "/experience#project-reading-assistant",
      provenance: { contentKind: "project", indexedAt: NOW.toISOString() },
    });
    const ids = result.passages.map((passage) => passage.sourceId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(result.passages.length).toBeLessThanOrEqual(config.finalPassages);
  });

  it("honours the kind filter and the requested limit", async () => {
    const { indexer, retriever } = knowledgeBase();
    await indexer.reindexPortfolio(snapshot());
    const result = await retriever.search({
      query: "embeddings cosine similarity vectors",
      kinds: ["roadmap_resource"],
      limit: 1,
    });
    expect(result.passages).toHaveLength(1);
    expect(result.passages[0]?.sourceId).toBe("portfolio:roadmap_resource:cosine-similarity-notes");
    expect(result.passages[0]).toMatchObject({
      path: "/ai-roadmap/foundations/embeddings#resource-cosine-similarity-notes",
    });
  });

  it("finds no evidence below the relevance floor", async () => {
    const { indexer, retriever } = knowledgeBase();
    await indexer.reindexPortfolio(snapshot());
    await expect(retriever.search({ query: "quarterly tax filing deadlines" })).resolves.toEqual({
      status: "no_evidence",
      passages: [],
    });
    const strict = knowledgeBase({ config: { relevanceFloor: 0.999 } });
    await strict.indexer.reindexPortfolio(snapshot());
    await expect(
      strict.retriever.search({ query: "hybrid search reranker archive" }),
    ).resolves.toEqual({ status: "no_evidence", passages: [] });
  });

  it("reports an unavailable provider, never no evidence", async () => {
    const { indexer, store } = knowledgeBase();
    await indexer.reindexPortfolio(snapshot());
    const failing = createRetriever({
      store,
      embedder: createFakeEmbedder({ failing: true }),
      config,
      now: () => NOW,
    });
    await expect(failing.search({ query: "hybrid search" })).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
  });

  it("refuses to embed a query once the ceiling is reached, and records each query", async () => {
    const { indexer, retriever, store, usage } = knowledgeBase();
    await indexer.reindexPortfolio(snapshot());
    await retriever.search({ query: "hybrid search" });
    expect(usage.filter((record) => record.operation === "search")).toHaveLength(1);
    await store.recordUsage({
      operation: "search",
      model: config.embeddingModel,
      tokens: 1,
      costUsd: config.monthlyCeilingUsd,
      occurredAt: NOW,
    });
    await expect(retriever.search({ query: "hybrid search" })).rejects.toBeInstanceOf(
      BudgetExhaustedError,
    );
  });

  it("lists the candidate pool by source without applying the floor", async () => {
    const { indexer, retriever } = knowledgeBase({ config: { relevanceFloor: 0.999 } });
    await indexer.reindexPortfolio(snapshot());
    const [pool = []] = await retriever.candidates([{ query: "hybrid search reranker archive" }]);
    expect(pool[0]).toBe("portfolio:project:reading-assistant");
    expect(new Set(pool).size).toBe(pool.length);
  });

  it("embeds the questions of a candidate run in batches, one usage record per call", async () => {
    const embedder = createFakeEmbedder();
    const { indexer, retriever, usage } = knowledgeBase({
      embedder,
      config: { embeddingBatchSize: 2 },
    });
    await indexer.reindexPortfolio(snapshot());
    const before = embedder.calls;
    const questions = ["hybrid search", "reranker archive", "context window"].map((query) => ({
      query,
    }));
    const pools = await retriever.candidates(questions);
    expect(pools).toHaveLength(3);
    expect(embedder.calls - before).toBe(2);
    expect(usage.filter((record) => record.operation === "candidates")).toHaveLength(2);
    expect(await retriever.candidates([])).toEqual([]);
  });

  it("restricts the candidate pool to the given kinds, as the search does", async () => {
    const { indexer, retriever } = knowledgeBase({ config: { relevanceFloor: 0.999 } });
    await indexer.reindexPortfolio(snapshot());
    const [pool = []] = await retriever.candidates([
      { query: "hybrid search reranker archive", kinds: ["glossary_term"] },
    ]);
    expect(pool.length).toBeGreaterThan(0);
    expect(pool.every((sourceId) => sourceId.startsWith("portfolio:glossary_term:"))).toBe(true);
  });
});
