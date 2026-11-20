// Keeps the index in step with the portfolio: embeds only chunks whose text hash has no stored
// vector for the configured model, in bounded batches, checks the month's spend ceiling before
// each batch and records the usage of every provider call.
import type {
  Embedder,
  PortfolioSnapshot,
  RetrievalConfig,
  RetrievalStore,
  UsageTotals,
} from "../ports/index.js";

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
  throw new Error(`Not implemented: ${options.embedder.model}`);
}
