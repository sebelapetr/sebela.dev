// Every paid provider call goes through here: refused once the calendar month's (UTC) recorded
// spend reached the ceiling, and recorded with its tokens and estimated cost after it answered.
import {
  BudgetExhaustedError,
  type Embedder,
  type EmbeddingInput,
  type RetrievalConfig,
  type RetrievalStore,
  type UsageOperation,
  type UsageTotals,
} from "../ports/index.js";

export interface SpendOptions {
  readonly store: RetrievalStore;
  readonly embedder: Embedder;
  readonly config: RetrievalConfig;
  readonly now?: (() => Date) | undefined;
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
  /** The usage recorded this calendar month (UTC). */
  thisMonth(): Promise<UsageTotals>;
}

export function createSpend({
  store,
  embedder,
  config,
  now = () => new Date(),
}: SpendOptions): Spend {
  const monthStart = () => {
    const today = now();
    return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  };
  const thisMonth = () => store.usageSince(monthStart());
  return {
    thisMonth,
    async embed(operation, texts, input) {
      const spent = await thisMonth();
      if (spent.costUsd >= config.monthlyCeilingUsd) {
        throw new BudgetExhaustedError("The month's embedding spend reached its ceiling.");
      }
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
  };
}
