// Search over the index: embeds the query (within the spend ceiling), takes the nearest chunks of
// the configured model by cosine distance, keeps the best chunk of each source at or above the
// relevance floor and projects them as contract passages.
import type { SearchRequest, SearchResult } from "@sebela/contracts";

import type { Embedder, RetrievalConfig, RetrievalStore } from "../ports/index.js";

export interface RetrieverOptions {
  readonly store: RetrievalStore;
  readonly embedder: Embedder;
  readonly config: RetrievalConfig;
  readonly now?: () => Date;
}

export interface Retriever {
  /**
   * The passages answering the query, or no evidence when none reaches the relevance floor.
   * Throws `ProviderUnavailableError` when the query cannot be embedded and `BudgetExhaustedError`
   * when the ceiling is reached; neither is ever reported as no evidence.
   */
  search(request: SearchRequest): Promise<SearchResult>;
  /** The source IDs of the candidate pool, best first, without the floor; for the evals' recall. */
  candidates(query: string): Promise<string[]>;
}

export function createRetriever(options: RetrieverOptions): Retriever {
  throw new Error(`Not implemented: ${options.embedder.model}`);
}
