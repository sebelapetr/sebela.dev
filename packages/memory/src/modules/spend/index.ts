// Every paid provider call (embedding or reranking) goes through here: refused once the calendar month's (UTC) recorded
// spend reached the ceiling, and recorded with its tokens and estimated cost after it answered.
import {
  BudgetExhaustedError,
  type Embedder,
  type EmbeddingInput,
  ProviderUnavailableError,
  type Reranker,
  type RetrievalConfig,
  type RetrievalStore,
  type UsageOperation,
  type UsageTotals,
} from "../ports/index.js";

export interface SpendOptions {
  readonly store: RetrievalStore;
  readonly embedder: Embedder;
  /** Absent where nothing reranks; `rerank` then throws `ProviderUnavailableError`. */
  readonly reranker?: Reranker | undefined;
  readonly config: RetrievalConfig;
  readonly now?: (() => Date) | undefined;
}

export interface MeteredReranking {
  readonly scores: readonly number[];
  readonly tokens: number;
  readonly costUsd: number;
}

export interface MeteredEmbedding {
  readonly vectors: readonly (readonly number[])[];
  readonly tokens: number;
  readonly costUsd: number;
}

export interface Spend {
  /**
   * Embeds the texts for an operation. Throws `BudgetExhaustedError` without calling the provider
   * once the ceiling is reached; the provider's `ProviderUnavailableError` passes through.
   */
  embed(
    operation: UsageOperation,
    texts: readonly string[],
    input: EmbeddingInput,
  ): Promise<MeteredEmbedding>;
  /**
   * Scores the documents against the query, recorded as `rerank` usage at the reranker's price.
   * Throws as `embed` does, and `ProviderUnavailableError` when there is no reranker or it
   * returned a score too few.
   */
  rerank(query: string, documents: readonly string[]): Promise<MeteredReranking>;
  /** The usage recorded this calendar month (UTC). */
  thisMonth(): Promise<UsageTotals>;
}

export function createSpend({
  store,
  embedder,
  reranker,
  config,
  now = () => new Date(),
}: SpendOptions): Spend {
  const monthStart = () => {
    const today = now();
    return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  };
  const thisMonth = () => store.usageSince(monthStart());
  const refuseOverCeiling = async () => {
    const spent = await thisMonth();
    if (spent.costUsd >= config.monthlyCeilingUsd) {
      throw new BudgetExhaustedError("The month's provider spend reached its ceiling.");
    }
  };
  return {
    thisMonth,
    async embed(operation, texts, input) {
      await refuseOverCeiling();
      const { vectors, tokens } = await embedder.embed(texts, input);
      const costUsd = (tokens / 1_000_000) * config.embeddingPricePerMillionTokensUsd;
      await store.recordUsage({
        operation,
        model: embedder.model,
        tokens,
        costUsd,
        occurredAt: now(),
      });
      return { vectors, tokens, costUsd };
    },
    async rerank(query, documents) {
      if (reranker === undefined) {
        throw new ProviderUnavailableError("No reranker is configured.");
      }
      await refuseOverCeiling();
      const { scores, tokens } = await reranker.rerank(query, documents);
      const costUsd = (tokens / 1_000_000) * config.rerankPricePerMillionTokensUsd;
      await store.recordUsage({
        operation: "rerank",
        model: reranker.model,
        tokens,
        costUsd,
        occurredAt: now(),
      });
      if (scores.length !== documents.length) {
        throw new ProviderUnavailableError("The reranker returned a score too few or too many.");
      }
      return { scores, tokens, costUsd };
    },
  };
}
