// The knowledge base of the backend: composes `@sebela/memory` with the retrieval persistence, the
// public portfolio reads and the configured embedding provider.
import type { SearchRequest, SearchResult } from "@sebela/contracts";
import type { RetrievalPersistence } from "@sebela/db";
import type { Embedder, IndexReport, RetrievalConfig, UsageTotals } from "@sebela/memory";

import type { ProfileService } from "../profile/index.js";
import type { RoadmapService } from "../roadmap/index.js";

/**
 * Indexing and searching the public portfolio. Every operation that needs the provider fails with
 * a `DomainError` `provider_unavailable` when retrieval is not configured or the provider fails,
 * and `budget_exhausted` once the month's spend reached its ceiling; neither is ever no evidence.
 */
export interface KnowledgeService {
  /** Brings the index in step with the portfolio, embedding only what changed. */
  reindexPortfolio(): Promise<IndexReport>;
  /** The passages answering the query, or no evidence below the relevance floor. */
  search(request: SearchRequest): Promise<SearchResult>;
  /** The candidate pool's source IDs, best first and without the floor; for the evals. */
  candidates(query: string): Promise<string[]>;
  /** The provider usage recorded this calendar month (UTC). */
  usage(): Promise<UsageTotals>;
}

export interface KnowledgeSources {
  readonly store: RetrievalPersistence;
  readonly profile: ProfileService;
  readonly roadmap: RoadmapService;
}

export interface KnowledgeServiceOptions {
  /** `null` when retrieval is not configured. */
  readonly config: RetrievalConfig | null;
  /** The embedding provider; without it every provider operation is unavailable. */
  readonly embedder?: Embedder;
}

export function createKnowledgeService(
  sources: KnowledgeSources,
  options: KnowledgeServiceOptions,
): KnowledgeService {
  const missing = (): never => {
    throw new Error(`Not implemented: ${typeof sources} ${typeof options}`);
  };
  return { reindexPortfolio: missing, search: missing, candidates: missing, usage: missing };
}
