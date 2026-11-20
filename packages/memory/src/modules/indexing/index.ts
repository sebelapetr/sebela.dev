// Keeps the index in step with the portfolio: embeds only chunks whose text hash has no cached
// vector for the configured model, in bounded batches, checks the month's spend ceiling before
// each batch, records the usage of every provider call and caches every returned vector at once.
// Queued work from content writes is finished by a run over the whole portfolio.
import { portfolioSources, type PortfolioSource } from "../ingest/index.js";
import {
  BudgetExhaustedError,
  ProviderUnavailableError,
  type Embedder,
  type PortfolioSnapshot,
  type RetrievalConfig,
  type RetrievalStore,
  type UsageTotals,
  type WorkCounts,
} from "../ports/index.js";
import { createSpend } from "../spend/index.js";

export interface IndexerOptions {
  readonly store: RetrievalStore;
  readonly embedder: Embedder;
  readonly config: RetrievalConfig;
  /** The clock; tests pass a fixed one. */
  readonly now?: () => Date;
}

/** What one reindex did. */
export interface IndexReport {
  /** Portfolio sources now indexed. */
  readonly sources: number;
  /** Sources stored with a new version. */
  readonly updated: number;
  /** Sources removed because their record no longer exists. */
  readonly removed: number;
  /** Chunks sent to the provider. */
  readonly embedded: number;
  /** Chunks whose stored vector was reused. */
  readonly reused: number;
  readonly tokens: number;
  readonly costUsd: number;
}

/** What one run over the queued work did. */
export interface QueueReport extends IndexReport {
  /** Queued items the run finished. */
  readonly completed: number;
  /** Work still queued after the run. */
  readonly remaining: WorkCounts;
}

export interface ProcessOptions {
  /** Most queued items one run takes; `workBatchLimit` when absent. */
  readonly limit?: number;
  /** Takes failed items too, as an explicit re-index does. */
  readonly retryFailed?: boolean;
}

/** Failed runs after which a queued item waits for an explicit re-index. */
export const maxWorkAttempts = 5;

/** Most queued items one run takes by default. */
export const workBatchLimit = 500;

export interface Indexer {
  /**
   * Indexes the portfolio. Throws `BudgetExhaustedError` before a batch the ceiling no longer
   * allows and `ProviderUnavailableError` when the provider fails; sources stored before either
   * stay stored, the rest stay as they were. Every vector the provider returned is kept, so a
   * later run never embeds it again.
   */
  reindexPortfolio(snapshot: PortfolioSnapshot): Promise<IndexReport>;
  /**
   * Stores every portfolio source again from the snapshot, as after an embedding model or version
   * change; vectors come from the embedding cache where it has them, so each text is embedded at
   * most once per model. Fails like `reindexPortfolio`.
   */
  rebuildPortfolio(snapshot: PortfolioSnapshot): Promise<IndexReport>;
  /**
   * Takes the oldest queued items, reads the snapshot after them and reconciles the portfolio
   * with it. Finished items are dropped. When the provider is unavailable each item counts a
   * failed attempt (failed at `maxWorkAttempts`) and `ProviderUnavailableError` is thrown; at the
   * ceiling `BudgetExhaustedError` is thrown and the items stay as they were.
   */
  processPending(
    read: () => Promise<PortfolioSnapshot>,
    options?: ProcessOptions,
  ): Promise<QueueReport>;
  /** Recorded provider usage this calendar month (UTC). */
  usage(): Promise<UsageTotals>;
}

export function createIndexer(options: IndexerOptions): Indexer {
  const { store, embedder, config } = options;
  const now = options.now ?? (() => new Date());
  const spend = createSpend({ store, embedder, config, now });

  /** Stores every source that is not current (or every source with `all`) from the snapshot. */
  async function reconcile(snapshot: PortfolioSnapshot, all: boolean): Promise<IndexReport> {
    const sources = portfolioSources(snapshot);
    const indexed = new Map(
      (await store.indexedSources()).map((source) => [source.sourceId, source]),
    );
    const stale = sources.filter((source) => {
      if (all) return true;
      const current = indexed.get(source.sourceId);
      return (
        current?.version !== source.version ||
        current.model !== embedder.model ||
        current.modelVersion !== embedder.version ||
        current.stale
      );
    });
    const removed = await store.removeSourcesExcept(
      "portfolio",
      sources.map((source) => source.sourceId),
    );

    const hashes = [...new Set(stale.flatMap((source) => source.chunks.map((c) => c.textHash)))];
    const vectors = new Map(await store.vectorsByHash(hashes, embedder.model, embedder.version));
    const texts = new Map<string, string>();
    for (const source of stale) {
      for (const chunk of source.chunks) {
        if (!vectors.has(chunk.textHash)) texts.set(chunk.textHash, chunk.text);
      }
    }
    const missing = [...texts.entries()];
    const chunkCount = stale.reduce((sum, source) => sum + source.chunks.length, 0);

    let tokens = 0;
    let costUsd = 0;
    let pending = stale;
    const storeComplete = async () => {
      const waiting: PortfolioSource[] = [];
      for (const source of pending) {
        if (source.chunks.every((chunk) => vectors.has(chunk.textHash))) {
          await store.replaceSource(toVersion(source, vectors, embedder, now()));
        } else {
          waiting.push(source);
        }
      }
      pending = waiting;
    };
    await storeComplete();
    for (let start = 0; start < missing.length; start += config.embeddingBatchSize) {
      const batch = missing.slice(start, start + config.embeddingBatchSize);
      const embedding = await spend.embed(
        "index",
        batch.map(([, text]) => text),
        "document",
      );
      const fresh = new Map<string, readonly number[]>();
      batch.forEach(([hash], index) => {
        const vector = embedding.vectors[index];
        if (vector === undefined) throw new ProviderUnavailableError("A vector was missing.");
        fresh.set(hash, vector);
        vectors.set(hash, vector);
      });
      tokens += embedding.tokens;
      costUsd += embedding.costUsd;
      // Cached before anything else can fail, so an interrupted run never pays for them again.
      await store.storeVectors(fresh, embedder.model, embedder.version);
      await storeComplete();
    }

    return {
      sources: sources.length,
      updated: stale.length,
      removed,
      embedded: missing.length,
      reused: chunkCount - missing.length,
      tokens,
      costUsd,
    };
  }

  async function processPending(
    read: () => Promise<PortfolioSnapshot>,
    processOptions: ProcessOptions = {},
  ): Promise<QueueReport> {
    const items = await store.pendingWork(
      processOptions.limit ?? workBatchLimit,
      processOptions.retryFailed ?? false,
    );
    const ids = items.map((item) => item.id);
    let report: IndexReport;
    try {
      // Read after taking the items, so the snapshot holds every write they stand for.
      report = await reconcile(await read(), false);
    } catch (error) {
      // At the ceiling nothing was attempted for lack of the provider: the work stays as it was.
      if (!(error instanceof BudgetExhaustedError)) {
        const code = error instanceof ProviderUnavailableError ? "provider_unavailable" : "error";
        await store.failWork(ids, code, maxWorkAttempts);
      }
      throw error;
    }
    await store.completeWork(ids);
    return { ...report, completed: ids.length, remaining: await store.workCounts() };
  }

  return {
    reindexPortfolio: (snapshot) => reconcile(snapshot, false),
    rebuildPortfolio: (snapshot) => reconcile(snapshot, true),
    processPending,
    usage: () => spend.thisMonth(),
  };
}

function toVersion(
  source: PortfolioSource,
  vectors: ReadonlyMap<string, readonly number[]>,
  embedder: Embedder,
  indexedAt: Date,
) {
  return {
    sourceId: source.sourceId,
    sourceKind: "portfolio" as const,
    contentKind: source.contentKind,
    title: source.title,
    path: source.path,
    version: source.version,
    model: embedder.model,
    modelVersion: embedder.version,
    dimension: embedder.dimension,
    indexedAt,
    sections: source.sections,
    chunks: source.chunks.map((chunk) => ({
      sectionOrdinal: chunk.sectionOrdinal,
      ordinal: chunk.ordinal,
      text: chunk.text,
      textHash: chunk.textHash,
      vector: vectors.get(chunk.textHash) ?? [],
    })),
  };
}
