import { createHash } from "node:crypto";

import { SearchResultSchema } from "@sebela/contracts";
import { describe, expect, it } from "vitest";

import {
  BudgetExhaustedError,
  ProviderUnavailableError,
  createFakeEmbedder,
  createIndexer,
  maxWorkAttempts,
  scheduleChanges,
  createRetriever,
  type Embedder,
  type FullTextQuery,
  type IndexedSource,
  type NearestChunk,
  type NearestQuery,
  type PortfolioSnapshot,
  type PreparedDocument,
  type RetrievalConfig,
  type RetrievalStore,
  type SourceKind,
  type SourceVersion,
  type UsageRecord,
  type UsageTotals,
  type WorkItem,
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
        startedOn: "2022-04-01",
        endedOn: null,
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
  const stale = new Set<string>();
  const cache = new Map<string, readonly number[]>();
  const usage: UsageRecord[] = [];
  const work: (WorkItem & { error: string | null })[] = [];
  let nextId = 0;
  const cacheKey = (hash: string, model: string, modelVersion: string) =>
    `${model}\u0000${modelVersion}\u0000${hash}`;
  const store: RetrievalStore = {
    indexedSources: () =>
      Promise.resolve(
        [...sources.values()].map((source): IndexedSource => ({
          sourceId: source.sourceId,
          sourceKind: source.sourceKind,
          version: source.version,
          model: source.model,
          modelVersion: source.modelVersion,
          stale: stale.has(source.sourceId),
        })),
      ),
    vectorsByHash: (hashes, model, modelVersion) => {
      const found = new Map<string, readonly number[]>();
      for (const hash of hashes) {
        const vector = cache.get(cacheKey(hash, model, modelVersion));
        if (vector !== undefined) found.set(hash, vector);
      }
      return Promise.resolve(found);
    },
    storeVectors: (vectors, model, modelVersion) => {
      for (const [hash, vector] of vectors) {
        const key = cacheKey(hash, model, modelVersion);
        if (!cache.has(key)) cache.set(key, vector);
      }
      return Promise.resolve();
    },
    replaceSource: (source, unlessWorkAfter) => {
      if (unlessWorkAfter !== undefined && work.some((item) => Number(item.id) > unlessWorkAfter)) {
        return Promise.resolve(false);
      }
      sources.set(source.sourceId, source);
      stale.delete(source.sourceId);
      for (const chunk of source.chunks) {
        const key = cacheKey(chunk.textHash, source.model, source.modelVersion);
        if (!cache.has(key)) cache.set(key, chunk.vector);
      }
      return Promise.resolve(true);
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
        if (stale.has(source.sourceId)) continue;
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
    // The share of the query's words in the chunk stands in for the text search rank.
    fullText: (query: FullTextQuery) => {
      const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
      const asked = new Set(words(query.query));
      const found: NearestChunk[] = [];
      for (const source of sources.values()) {
        if (stale.has(source.sourceId)) continue;
        if (query.kinds !== undefined && !query.kinds.includes(source.contentKind)) continue;
        for (const chunk of source.chunks) {
          const present = new Set(words(chunk.text).filter((word) => asked.has(word)));
          if (present.size === 0) continue;
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
            similarity: present.size / asked.size / 10,
          });
        }
      }
      found.sort((a, b) => b.similarity - a.similarity);
      return Promise.resolve(found.slice(0, query.limit));
    },
    scheduleWork: (scheduled) => {
      for (const id of scheduled.removeSourceIds) {
        sources.delete(id);
        stale.delete(id);
      }
      for (const id of scheduled.staleSourceIds) if (sources.has(id)) stale.add(id);
      for (const item of scheduled.items) {
        nextId += 1;
        work.push({ ...item, id: String(nextId), attempts: 0, failed: false, error: null });
      }
      return Promise.resolve();
    },
    workWatermark: () => Promise.resolve(nextId),
    pendingWork: (limit, includeFailed) =>
      Promise.resolve(
        work
          .filter((item) => includeFailed || !item.failed)
          .slice(0, limit)
          .map(({ id, sourceId, operation, attempts, failed }) => ({
            id,
            sourceId,
            operation,
            attempts,
            failed,
          })),
      ),
    completeWork: (ids) => {
      for (let index = work.length - 1; index >= 0; index -= 1) {
        const item = work[index];
        if (item !== undefined && ids.includes(item.id)) work.splice(index, 1);
      }
      return Promise.resolve();
    },
    failWork: (ids, error, maxAttempts) => {
      work.forEach((item, index) => {
        if (!ids.includes(item.id)) return;
        const attempts = item.attempts + 1;
        work[index] = { ...item, attempts, failed: attempts >= maxAttempts, error };
      });
      return Promise.resolve();
    },
    workCounts: () =>
      Promise.resolve({
        pending: work.filter((item) => !item.failed).length,
        failed: work.filter((item) => item.failed).length,
      }),
  };
  return { store, sources, stale, cache, usage, work };
}

function knowledgeBase(
  options: {
    embedder?: Embedder;
    config?: Partial<RetrievalConfig>;
    /** The store of an earlier knowledge base, as a restarted process finds it. */
    memory?: ReturnType<typeof memoryStore>;
  } = {},
) {
  const memory = options.memory ?? memoryStore();
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

/** An embedder that records every text it embeds and fails every call after the first `ok`. */
function countingEmbedder(options: { ok?: number; version?: string } = {}) {
  const fake = createFakeEmbedder();
  const texts: string[] = [];
  let calls = 0;
  const embedder: Embedder = {
    model: fake.model,
    version: options.version ?? fake.version,
    dimension: fake.dimension,
    embed: (batch, input, signal) => {
      calls += 1;
      if (options.ok !== undefined && calls > options.ok) {
        return Promise.reject(new ProviderUnavailableError("The provider is down.", 503));
      }
      texts.push(...batch);
      return fake.embed(batch, input, signal);
    },
  };
  return { embedder, texts, calls: () => calls };
}

/** The fictional snapshot with the service's deliverable rewritten. */
function withDeliverable(deliverable: string): PortfolioSnapshot {
  const base = snapshot();
  const service = base.services[0];
  if (service === undefined) throw new Error("fixture");
  return { ...base, services: [{ ...service, deliverable }] };
}

const uniqueTexts = (texts: readonly string[]) => new Set(texts).size;

describe("keeping the index current after content writes", () => {
  it("drops a deleted record's passages and hides a changed record's at once", async () => {
    const { indexer, retriever, store, work } = knowledgeBase();
    await indexer.reindexPortfolio(snapshot());

    await scheduleChanges(
      store,
      [
        { domain: "service", record: "evaluation-setup", action: "deleted" },
        { domain: "project", record: "reading-assistant", action: "updated" },
      ],
      snapshot(),
    );

    const service = await retriever.search({ query: "evaluation setup question set metrics" });
    expect(service.passages.map((passage) => passage.sourceId)).not.toContain(
      "portfolio:service:evaluation-setup",
    );
    const project = await retriever.search({ query: "hybrid search reranker archive" });
    const ids = project.passages.map((passage) => passage.sourceId);
    expect(ids).not.toContain("portfolio:project:reading-assistant");
    expect(ids).not.toContain("portfolio:case_study:reading-assistant");
    expect(work.map((item) => item.operation)).toEqual(["remove", "index"]);
  });

  it("queues every change, also one that maps to no single source", async () => {
    const { store, work } = knowledgeBase();
    await scheduleChanges(
      store,
      [
        { domain: "technology", record: "typescript", action: "updated" },
        { domain: "person", record: null, action: "updated" },
        { domain: "roadmap-diary", record: "2025-02-10", action: "created" },
      ],
      snapshot(),
    );
    expect(work.map((item) => item.sourceId)).toEqual([
      "portfolio",
      "portfolio:profile:person",
      "portfolio:diary_day:2025-02-10",
    ]);
  });

  it("hides a record a deleted testimonial was indexed inside, until the run stores it again", async () => {
    const { indexer, retriever, store, stale } = knowledgeBase();
    await indexer.reindexPortfolio(snapshot());
    const current = { ...snapshot(), testimonials: [] };

    await scheduleChanges(
      store,
      [{ domain: "testimonial", record: "editor-in-chief", action: "deleted" }],
      current,
    );
    expect([...stale]).toEqual(["portfolio:experience:lumen-press-staff-engineer"]);
    const hidden = await retriever.search({ query: "Calm under deadlines" });
    expect(hidden.passages.map((passage) => passage.text).join("\n")).not.toContain("Calm");

    await indexer.processPending(() => Promise.resolve(current));
    expect(stale.size).toBe(0);
    const stored = await retriever.search({ query: "Calm under deadlines" });
    expect(stored.passages.map((passage) => passage.text).join("\n")).not.toContain("Calm");
  });

  it("hides records a renamed technology appears in and drops records gone with a parent", async () => {
    const { indexer, store, stale, sources } = knowledgeBase();
    await indexer.reindexPortfolio(snapshot());
    const base = snapshot();
    const [experience] = base.experiences;
    if (experience === undefined) throw new Error("fixture");
    const current: PortfolioSnapshot = {
      ...base,
      experiences: [{ ...experience, technologies: [{ name: "TypeScript 6" }] }],
      roadmap: { areas: [] },
    };

    await scheduleChanges(
      store,
      [
        { domain: "technology", record: "typescript", action: "updated" },
        { domain: "roadmap-area", record: "foundations", action: "deleted" },
      ],
      current,
    );
    expect([...stale]).toEqual(["portfolio:experience:lumen-press-staff-engineer"]);
    expect([...sources.keys()].filter((id) => id.includes("roadmap"))).toEqual([]);
  });

  it("does not bring back a record deleted while a run reads the portfolio", async () => {
    const { indexer, retriever, store, sources } = knowledgeBase();
    await indexer.reindexPortfolio(snapshot());
    const changed = withDeliverable("A quarterly zebra audit.");
    const service = { domain: "service", record: "evaluation-setup" } as const;
    await scheduleChanges(store, [{ ...service, action: "updated" }], changed);

    const report = await indexer.processPending(async () => {
      await scheduleChanges(store, [{ ...service, action: "deleted" }], {
        ...snapshot(),
        services: [],
      });
      return changed;
    });

    expect(sources.has("portfolio:service:evaluation-setup")).toBe(false);
    expect(report.remaining).toEqual({ pending: 1, failed: 0 });
    const result = await retriever.search({ query: "quarterly zebra audit" });
    expect(result.passages.map((passage) => passage.sourceId)).not.toContain(
      "portfolio:service:evaluation-setup",
    );
  });

  it("keeps a record hidden that changed again while a run read it, until the next run", async () => {
    const { indexer, retriever, store, stale } = knowledgeBase();
    await indexer.reindexPortfolio(snapshot());
    const service = { domain: "service", record: "evaluation-setup", action: "updated" } as const;
    const first = withDeliverable("A quarterly zebra audit.");
    const second = withDeliverable("A yearly walrus review.");
    await scheduleChanges(store, [service], first);

    await indexer.processPending(async () => {
      await scheduleChanges(store, [service], second);
      return first;
    });
    expect(stale.has("portfolio:service:evaluation-setup")).toBe(true);
    const old = await retriever.search({ query: "quarterly zebra audit" });
    expect(old.passages.map((passage) => passage.sourceId)).not.toContain(
      "portfolio:service:evaluation-setup",
    );

    await expect(indexer.processPending(() => Promise.resolve(second))).resolves.toMatchObject({
      remaining: { pending: 0, failed: 0 },
    });
    const fresh = await retriever.search({ query: "yearly walrus review" });
    expect(fresh.passages[0]?.sourceId).toBe("portfolio:service:evaluation-setup");
  });

  it("makes a change searchable once the queued work runs", async () => {
    const { indexer, retriever, store } = knowledgeBase();
    await indexer.reindexPortfolio(snapshot());
    await scheduleChanges(
      store,
      [{ domain: "service", record: "evaluation-setup", action: "updated" }],
      snapshot(),
    );

    const report = await indexer.processPending(() =>
      Promise.resolve(withDeliverable("A quarterly zebra audit of the assistant.")),
    );
    expect(report).toMatchObject({
      completed: 1,
      updated: 1,
      remaining: { pending: 0, failed: 0 },
    });
    const result = await retriever.search({ query: "quarterly zebra audit" });
    expect(result.passages[0]?.sourceId).toBe("portfolio:service:evaluation-setup");
  });

  it("keeps the work queued while the provider fails and finishes it after a restart", async () => {
    const memory = memoryStore();
    const first = knowledgeBase({ memory, embedder: createFakeEmbedder({ failing: true }) });
    await knowledgeBase({ memory }).indexer.reindexPortfolio(snapshot());
    await scheduleChanges(
      memory.store,
      [{ domain: "service", record: "evaluation-setup", action: "updated" }],
      snapshot(),
    );
    const changed = () => Promise.resolve(withDeliverable("A quarterly zebra audit."));

    await expect(first.indexer.processPending(changed)).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
    expect(memory.work).toMatchObject([{ attempts: 1, failed: false }]);
    expect(memory.stale.has("portfolio:service:evaluation-setup")).toBe(true);

    const restarted = knowledgeBase({ memory });
    await expect(restarted.indexer.processPending(changed)).resolves.toMatchObject({
      completed: 1,
      remaining: { pending: 0, failed: 0 },
    });
    const result = await restarted.retriever.search({ query: "quarterly zebra audit" });
    expect(result.passages[0]?.sourceId).toBe("portfolio:service:evaluation-setup");
  });

  it("restores an unchanged record from stored vectors without the provider", async () => {
    const memory = memoryStore();
    await knowledgeBase({ memory }).indexer.reindexPortfolio(snapshot());
    await scheduleChanges(
      memory.store,
      [{ domain: "service", record: "evaluation-setup", action: "updated" }],
      snapshot(),
    );
    const offline = knowledgeBase({ memory, embedder: createFakeEmbedder({ failing: true }) });

    await expect(
      offline.indexer.processPending(() => Promise.resolve(snapshot())),
    ).resolves.toMatchObject({ completed: 1, embedded: 0 });
    expect(memory.stale.size).toBe(0);
  });

  it("gives up on an item after the most attempts until it is retried explicitly", async () => {
    const memory = memoryStore();
    await knowledgeBase({ memory }).indexer.reindexPortfolio(snapshot());
    await scheduleChanges(
      memory.store,
      [{ domain: "service", record: "evaluation-setup", action: "updated" }],
      snapshot(),
    );
    const offline = knowledgeBase({ memory, embedder: createFakeEmbedder({ failing: true }) });
    const changed = () => Promise.resolve(withDeliverable("A quarterly zebra audit."));
    for (let attempt = 0; attempt < maxWorkAttempts; attempt += 1) {
      await expect(offline.indexer.processPending(changed)).rejects.toBeInstanceOf(
        ProviderUnavailableError,
      );
    }
    expect(memory.work).toMatchObject([{ attempts: maxWorkAttempts, failed: true }]);

    const online = knowledgeBase({ memory });
    await expect(online.indexer.processPending(changed)).resolves.toMatchObject({
      completed: 0,
      remaining: { pending: 0, failed: 1 },
    });
    await expect(
      online.indexer.processPending(changed, { retryFailed: true }),
    ).resolves.toMatchObject({ completed: 1, remaining: { pending: 0, failed: 0 } });
  });

  it("takes at most the given number of queued items in one run", async () => {
    const { indexer, store } = knowledgeBase();
    await scheduleChanges(
      store,
      [
        { domain: "service", record: "evaluation-setup", action: "updated" },
        { domain: "project", record: "reading-assistant", action: "updated" },
      ],
      snapshot(),
    );
    await expect(
      indexer.processPending(() => Promise.resolve(snapshot()), { limit: 1 }),
    ).resolves.toMatchObject({ completed: 1, remaining: { pending: 1, failed: 0 } });
  });

  it("stops at the ceiling and keeps the work exactly as it was", async () => {
    const { indexer, store, work } = knowledgeBase();
    await scheduleChanges(
      store,
      [{ domain: "service", record: "evaluation-setup", action: "updated" }],
      snapshot(),
    );
    await store.recordUsage({
      operation: "index",
      model: config.embeddingModel,
      tokens: 1,
      costUsd: config.monthlyCeilingUsd,
      occurredAt: NOW,
    });
    await expect(indexer.processPending(() => Promise.resolve(snapshot()))).rejects.toBeInstanceOf(
      BudgetExhaustedError,
    );
    expect(work).toMatchObject([{ attempts: 0, failed: false }]);
  });

  it("never embeds a text twice across an interrupted run and records each call once", async () => {
    const memory = memoryStore();
    const interrupted = countingEmbedder({ ok: 1 });
    await expect(
      knowledgeBase({ memory, embedder: interrupted.embedder }).indexer.reindexPortfolio(
        snapshot(),
      ),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(memory.usage).toHaveLength(1);

    const resumed = countingEmbedder();
    await knowledgeBase({ memory, embedder: resumed.embedder }).indexer.reindexPortfolio(
      snapshot(),
    );
    const embedded = [...interrupted.texts, ...resumed.texts];
    expect(embedded.length).toBe(uniqueTexts(embedded));
    expect(memory.usage).toHaveLength(1 + resumed.calls());
  });

  it("re-embeds everything once after a model version change, searching one model throughout", async () => {
    const memory = memoryStore();
    const before = countingEmbedder();
    await knowledgeBase({ memory, embedder: before.embedder }).indexer.reindexPortfolio(snapshot());

    const interrupted = countingEmbedder({ ok: 1, version: "2" });
    const partial = knowledgeBase({ memory, embedder: interrupted.embedder });
    await expect(partial.indexer.rebuildPortfolio(snapshot())).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
    const during = await knowledgeBase({
      memory,
      embedder: countingEmbedder({ version: "2" }).embedder,
    }).retriever.search({ query: "hybrid search reranker archive" });
    for (const passage of during.passages) {
      expect(memory.sources.get(passage.sourceId)?.modelVersion).toBe("2");
    }

    const resumed = countingEmbedder({ version: "2" });
    const after = knowledgeBase({ memory, embedder: resumed.embedder });
    const report = await after.indexer.rebuildPortfolio(snapshot());
    expect(report.updated).toBe(report.sources);
    expect([...memory.sources.values()].every((source) => source.modelVersion === "2")).toBe(true);
    const embedded = [...interrupted.texts, ...resumed.texts];
    expect(embedded.length).toBe(uniqueTexts(embedded));
    expect(uniqueTexts(embedded)).toBe(uniqueTexts(before.texts));

    await expect(after.indexer.rebuildPortfolio(snapshot())).resolves.toMatchObject({
      embedded: 0,
      updated: report.sources,
    });
    const found = await after.retriever.search({ query: "hybrid search reranker archive" });
    expect(found.passages[0]?.sourceId).toBe("portfolio:project:reading-assistant");
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

describe("the full-text search variant", () => {
  const fullText = (memory: ReturnType<typeof memoryStore>, embedder: Embedder) =>
    createRetriever({ store: memory.store, embedder, config, now: () => NOW, variant: "fulltext" });

  it("finds passages by text search rank without the provider or the relevance floor", async () => {
    const { indexer, ...memory } = knowledgeBase();
    await indexer.reindexPortfolio(snapshot());
    const retriever = fullText(memory, createFakeEmbedder({ failing: true }));

    const result = await retriever.search({ query: "hybrid search reranker archive" });
    expect(SearchResultSchema.parse(result)).toEqual(result);
    expect(result.status).toBe("found");
    expect(result.passages[0]?.sourceId).toBe("portfolio:project:reading-assistant");
    // The stand-in rank stays far below the cosine floor; full text applies none.
    expect(result.passages[0]?.score).toBeLessThan(config.relevanceFloor);
    expect(memory.usage.filter((record) => record.operation !== "index")).toEqual([]);

    await expect(retriever.search({ query: "quarterly tax filing" })).resolves.toEqual({
      status: "no_evidence",
      passages: [],
    });
  });

  it("lists full-text candidate pools by source and kind without the provider", async () => {
    const { indexer, ...memory } = knowledgeBase();
    await indexer.reindexPortfolio(snapshot());
    const retriever = fullText(memory, createFakeEmbedder({ failing: true }));
    const [pool = [], glossary = []] = await retriever.candidates([
      { query: "hybrid search reranker archive" },
      { query: "hybrid search answering sources", kinds: ["glossary_term"] },
    ]);
    expect(pool[0]).toBe("portfolio:project:reading-assistant");
    expect(new Set(pool).size).toBe(pool.length);
    expect(glossary.length).toBeGreaterThan(0);
    expect(glossary.every((sourceId) => sourceId.startsWith("portfolio:glossary_term:"))).toBe(
      true,
    );
  });
});

/** A prepared supplemental document, as the documents module returns it for an approval. */
function preparedDocument(texts: readonly string[]): PreparedDocument {
  const sha = (text: string) => createHash("sha256").update(text).digest("hex");
  return {
    sourceId: "document:harbour-handbook",
    title: "Harbour support handbook",
    mediaType: "text/markdown",
    extension: "md",
    contentHash: sha(texts.join("\n")),
    text: texts.join("\n"),
    sections: [{ ordinal: 0, headingPath: ["Harbour support handbook"], start: 0, end: 10 }],
    chunks: texts.map((text, ordinal) => ({
      sectionOrdinal: 0,
      ordinal,
      text,
      textHash: sha(text),
    })),
    findings: [],
  };
}

describe("embedding an approved document", () => {
  it("embeds its chunks in batches and returns a supplemental version without storing it", async () => {
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
    const { indexer, sources, usage } = knowledgeBase({
      embedder,
      config: { embeddingBatchSize: 2 },
    });
    const document = preparedDocument(["Opening hours", "Refunds", "Escalation", "Refunds"]);

    const { version, report } = await indexer.embedDocument(document);

    expect(sizes).toEqual([2, 1]);
    expect(report).toMatchObject({ embedded: 3, reused: 1 });
    expect(report.tokens).toBeGreaterThan(0);
    expect(usage.filter((record) => record.operation === "index")).toHaveLength(2);
    expect(version).toMatchObject({
      sourceId: "document:harbour-handbook",
      sourceKind: "supplemental",
      contentKind: "document",
      title: "Harbour support handbook",
      path: null,
      version: document.contentHash,
      model: embedder.model,
      modelVersion: embedder.version,
      dimension: embedder.dimension,
      indexedAt: NOW,
      sections: document.sections,
    });
    expect(version.chunks.map((chunk) => chunk.vector.length)).toEqual([
      embedder.dimension,
      embedder.dimension,
      embedder.dimension,
      embedder.dimension,
    ]);
    expect(sources.size).toBe(0);
  });

  it("reuses the cached vectors of a document embedded before", async () => {
    const embedder = createFakeEmbedder();
    const { indexer } = knowledgeBase({ embedder });
    const document = preparedDocument(["Opening hours", "Refunds"]);
    await indexer.embedDocument(document);
    const calls = embedder.calls;

    const { report } = await indexer.embedDocument(document);

    expect(embedder.calls).toBe(calls);
    expect(report).toEqual({ embedded: 0, reused: 2, tokens: 0, costUsd: 0 });
  });

  it("stops before a batch the monthly ceiling no longer allows", async () => {
    const embedder = createFakeEmbedder();
    const { indexer } = knowledgeBase({ embedder, config: { monthlyCeilingUsd: 0 } });
    await expect(indexer.embedDocument(preparedDocument(["Opening hours"]))).rejects.toBeInstanceOf(
      BudgetExhaustedError,
    );
    expect(embedder.calls).toBe(0);
  });
});
