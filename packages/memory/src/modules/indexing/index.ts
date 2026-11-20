// Keeps the index in step with the portfolio: embeds only chunks whose text hash has no stored
// vector for the configured model, in bounded batches, checks the month's spend ceiling before
// each batch and records the usage of every provider call.
import { portfolioSources, type PortfolioSource } from "../ingest/index.js";
import {
  ProviderUnavailableError,
  type Embedder,
  type PortfolioSnapshot,
  type RetrievalConfig,
  type RetrievalStore,
  type UsageTotals,
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

export interface Indexer {
  /**
   * Indexes the portfolio. Throws `BudgetExhaustedError` before a batch the ceiling no longer
   * allows and `ProviderUnavailableError` when the provider fails; sources stored before either
   * stay stored, the rest stay as they were.
   */
  reindexPortfolio(snapshot: PortfolioSnapshot): Promise<IndexReport>;
  /** Recorded provider usage this calendar month (UTC). */
  usage(): Promise<UsageTotals>;
}

export function createIndexer(options: IndexerOptions): Indexer {
  const { store, embedder, config } = options;
  const now = options.now ?? (() => new Date());
  const spend = createSpend({ store, embedder, config, now });

  async function reindexPortfolio(snapshot: PortfolioSnapshot): Promise<IndexReport> {
    const sources = portfolioSources(snapshot);
    const indexed = new Map(
      (await store.indexedSources()).map((source) => [source.sourceId, source]),
    );
    const stale = sources.filter((source) => {
      const current = indexed.get(source.sourceId);
      return (
        current?.version !== source.version ||
        current.model !== embedder.model ||
        current.modelVersion !== embedder.version
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
      batch.forEach(([hash], index) => {
        const vector = embedding.vectors[index];
        if (vector === undefined) throw new ProviderUnavailableError("A vector was missing.");
        vectors.set(hash, vector);
      });
      tokens += embedding.tokens;
      costUsd += embedding.costUsd;
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

  return { reindexPortfolio, usage: () => spend.thisMonth() };
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
