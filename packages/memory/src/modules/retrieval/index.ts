// Search over the index: embeds the query (within the spend ceiling), takes the nearest chunks of
// the configured model by cosine distance, keeps the best chunk of each source at or above the
// relevance floor and projects them as contract passages.
import {
  SearchResultSchema,
  type Passage,
  type RetrievalContentKind,
  type SearchRequest,
  type SearchResult,
} from "@sebela/contracts";

import type {
  Embedder,
  NearestChunk,
  RetrievalConfig,
  RetrievalStore,
  UsageOperation,
} from "../ports/index.js";
import { createSpend } from "../spend/index.js";

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
  /**
   * The source IDs of the candidate pool, best first, without the floor and, like the search,
   * only of the given kinds when any; for the evals' recall.
   */
  candidates(query: string, kinds?: readonly RetrievalContentKind[]): Promise<string[]>;
}

export function createRetriever(options: RetrieverOptions): Retriever {
  const { store, embedder, config } = options;
  const spend = createSpend({ store, embedder, config, now: options.now });

  /** The candidate pool, best chunk of each source first. */
  async function pool(
    operation: UsageOperation,
    query: string,
    kinds?: readonly RetrievalContentKind[],
  ): Promise<NearestChunk[]> {
    const { vectors } = await spend.embed(operation, [query], "query");
    const [vector] = vectors;
    if (vector === undefined) return [];
    const nearest = await store.nearest({
      vector,
      model: embedder.model,
      modelVersion: embedder.version,
      ...(kinds === undefined ? {} : { kinds }),
      limit: config.candidatePool,
    });
    const best = new Map<string, NearestChunk>();
    for (const chunk of [...nearest].sort((a, b) => b.similarity - a.similarity)) {
      if (!best.has(chunk.sourceId)) best.set(chunk.sourceId, chunk);
    }
    return [...best.values()];
  }

  return {
    async search(request) {
      const limit = Math.min(request.limit ?? config.finalPassages, config.finalPassages);
      const passages = (await pool("search", request.query, request.kinds))
        .filter((chunk) => chunk.similarity >= config.relevanceFloor)
        .map(toPassage)
        .filter((passage) => passage !== null)
        .slice(0, limit);
      // Parsing guarantees the contract: a portfolio passage carries its canonical path and a
      // supplemental one never carries an address.
      return SearchResultSchema.parse(
        passages.length === 0
          ? { status: "no_evidence", passages: [] }
          : { status: "found", passages },
      );
    },
    async candidates(query, kinds) {
      return (await pool("candidates", query, kinds)).map((chunk) => chunk.sourceId);
    },
  };
}

const clamp = (value: number) => Math.max(-1, Math.min(1, value));

function toPassage(chunk: NearestChunk): Passage | null {
  const fields = {
    sourceId: chunk.sourceId,
    title: chunk.title,
    version: chunk.version,
    text: chunk.text,
    score: clamp(chunk.similarity),
  };
  const provenance = {
    sectionPath: [...chunk.headingPath],
    indexedAt: chunk.indexedAt.toISOString(),
  };
  if (chunk.sourceKind === "supplemental") {
    return chunk.contentKind === "document"
      ? {
          sourceKind: "supplemental",
          ...fields,
          provenance: { contentKind: "document", ...provenance },
        }
      : null;
  }
  if (chunk.path === null || chunk.contentKind === "document") return null;
  return {
    sourceKind: "portfolio",
    ...fields,
    path: chunk.path,
    provenance: { contentKind: chunk.contentKind, ...provenance },
  };
}
