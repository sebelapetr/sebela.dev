// Search over the index in two stages. The first stage embeds the query (within the spend ceiling),
// takes the nearest chunks of the configured model by cosine distance and the best chunks by text
// search rank, keeps the best chunk of each source in each list and fuses the two lists by
// reciprocal rank into the candidate pool. The second stage scores the pool with the cross-encoder
// reranker, keeps the passages at or above the relevance floor (a reranker score), at most the
// final count, and projects them as contract passages. The evals' other variants stop earlier.
import {
  SearchResultSchema,
  type Passage,
  type RetrievalContentKind,
  type SearchRequest,
  type SearchResult,
} from "@sebela/contracts";

import {
  ProviderUnavailableError,
  type Embedder,
  type NearestChunk,
  type Reranker,
  type RetrievalConfig,
  type RetrievalStore,
  type UsageOperation,
} from "../ports/index.js";
import { createSpend } from "../spend/index.js";

/**
 * How passages are ranked. `reranked` (the deployed search): the hybrid pool scored by the
 * reranker, the floor applied to its score. The evals' baselines: `hybrid`, the fused pool in its
 * order without the reranker and without a floor; `vector`, by cosine similarity with the floor
 * applied to it; `fulltext`, by text search rank without calling the provider and without a floor.
 */
export type SearchVariant = "vector" | "fulltext" | "hybrid" | "reranked";

export interface RetrieverOptions {
  readonly store: RetrievalStore;
  readonly embedder: Embedder;
  /** The cross-encoder of the `reranked` variant; without it that search is unavailable. */
  readonly reranker?: Reranker;
  readonly config: RetrievalConfig;
  readonly now?: () => Date;
  /** `reranked` when absent. */
  readonly variant?: SearchVariant;
}

export interface Retriever {
  /**
   * The passages answering the query, or no evidence when none reaches the relevance floor.
   * Throws `ProviderUnavailableError` when the query cannot be embedded and `BudgetExhaustedError`
   * when the ceiling is reached; neither is ever reported as no evidence.
   */
  search(request: SearchRequest): Promise<SearchResult>;
  /**
   * For each question, in order, the source IDs of its candidate pool, best first, without the
   * floor and, like the search, only of the given kinds when any; for the evals' recall. The
   * queries are embedded together, `embeddingBatchSize` per provider call. Throws as `search` does.
   */
  candidates(questions: readonly CandidateQuestion[]): Promise<string[][]>;
}

/** The rank constant of reciprocal rank fusion: a source at rank r of a list scores 1/(k + r). */
const FUSION_RANK_CONSTANT = 60;

/** One question of a candidate run. */
export interface CandidateQuestion {
  readonly query: string;
  readonly kinds?: readonly RetrievalContentKind[];
}

export function createRetriever(options: RetrieverOptions): Retriever {
  const { store, embedder, config } = options;
  const variant = options.variant ?? "reranked";
  const spend = createSpend({
    store,
    embedder,
    reranker: options.reranker,
    config,
    now: options.now,
  });
  const usesVectors = variant !== "fulltext";

  /** The candidate pool of a query's vector, best chunk of each source first. */
  async function pool(
    vector: readonly number[],
    kinds?: readonly RetrievalContentKind[],
  ): Promise<NearestChunk[]> {
    return bestPerSource(
      await store.nearest({
        vector,
        model: embedder.model,
        modelVersion: embedder.version,
        ...(kinds === undefined ? {} : { kinds }),
        limit: config.candidatePool,
      }),
    );
  }

  /** The candidate pool of a query's words by text search rank, best chunk of each source first. */
  async function textPool(
    query: string,
    kinds?: readonly RetrievalContentKind[],
  ): Promise<NearestChunk[]> {
    return bestPerSource(
      await store.fullText({
        query,
        ...(kinds === undefined ? {} : { kinds }),
        limit: config.candidatePool,
      }),
    );
  }

  function bestPerSource(nearest: readonly NearestChunk[]): NearestChunk[] {
    const best = new Map<string, NearestChunk>();
    for (const chunk of [...nearest].sort((a, b) => b.similarity - a.similarity)) {
      if (!best.has(chunk.sourceId)) best.set(chunk.sourceId, chunk);
    }
    return [...best.values()];
  }

  /** The vectors of the queries, `embeddingBatchSize` per provider call, in their order. */
  async function embedQueries(
    operation: UsageOperation,
    queries: readonly string[],
  ): Promise<(readonly number[])[]> {
    const vectors: (readonly number[])[] = [];
    for (let start = 0; start < queries.length; start += config.embeddingBatchSize) {
      const batch = queries.slice(start, start + config.embeddingBatchSize);
      const embedded = await spend.embed(operation, batch, "query");
      for (let index = 0; index < batch.length; index += 1) {
        const vector = embedded.vectors[index];
        if (vector === undefined) throw new ProviderUnavailableError("A vector was missing.");
        vectors.push(vector);
      }
    }
    return vectors;
  }

  /** The first-stage pool of a query, best first, from its vector when the variant uses one. */
  async function firstStage(
    query: string,
    vector: readonly number[] | undefined,
    kinds?: readonly RetrievalContentKind[],
  ): Promise<NearestChunk[]> {
    if (variant === "fulltext") return textPool(query, kinds);
    if (vector === undefined) throw new ProviderUnavailableError("A vector was missing.");
    if (variant === "vector") return pool(vector, kinds);
    const [byVector, byText] = await Promise.all([pool(vector, kinds), textPool(query, kinds)]);
    return fuse([byVector, byText], config.candidatePool);
  }

  /** The pool scored by the reranker, best first; ties keep the pool's order. */
  async function rerank(query: string, found: readonly NearestChunk[]): Promise<NearestChunk[]> {
    if (found.length === 0) return [];
    const { scores } = await spend.rerank(
      query,
      found.map((chunk) => chunk.text),
    );
    return found
      .map((chunk, index) => ({ ...chunk, similarity: scores[index] ?? 0 }))
      .sort((a, b) => b.similarity - a.similarity);
  }

  return {
    async search(request) {
      const limit = Math.min(request.limit ?? config.finalPassages, config.finalPassages);
      const [vector] = usesVectors ? await embedQueries("search", [request.query]) : [];
      const found = await firstStage(request.query, vector, request.kinds);
      const ranked = variant === "reranked" ? await rerank(request.query, found) : found;
      const floor = variant === "reranked" || variant === "vector" ? config.relevanceFloor : null;
      const passages = ranked
        .filter((chunk) => floor === null || chunk.similarity >= floor)
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
    async candidates(questions) {
      const vectors = usesVectors
        ? await embedQueries(
            "candidates",
            questions.map((question) => question.query),
          )
        : [];
      const pools: string[][] = [];
      for (const [index, { query, kinds }] of questions.entries()) {
        const found = await firstStage(query, vectors[index], kinds);
        pools.push(found.map((chunk) => chunk.sourceId));
      }
      return pools;
    },
  };
}

/**
 * Reciprocal rank fusion of lists that rank each source at most once, best first: a source scores
 * the sum of 1/(k + rank) over the lists that hold it (ranks from 1), ties go to the smaller source
 * ID, and the first `size` are kept. A source is represented by its chunk of the list it ranked
 * best in (the first such list on a tie), its similarity replaced by the fused score.
 */
function fuse(lists: readonly (readonly NearestChunk[])[], size: number): NearestChunk[] {
  const fused = new Map<string, { chunk: NearestChunk; rank: number; score: number }>();
  for (const list of lists) {
    for (const [index, chunk] of list.entries()) {
      const rank = index + 1;
      const score = 1 / (FUSION_RANK_CONSTANT + rank);
      const seen = fused.get(chunk.sourceId);
      if (seen === undefined) {
        fused.set(chunk.sourceId, { chunk, rank, score });
      } else {
        fused.set(chunk.sourceId, {
          chunk: rank < seen.rank ? chunk : seen.chunk,
          rank: Math.min(rank, seen.rank),
          score: seen.score + score,
        });
      }
    }
  }
  return [...fused.values()]
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.chunk.sourceId < b.chunk.sourceId ? -1 : a.chunk.sourceId > b.chunk.sourceId ? 1 : 0),
    )
    .slice(0, size)
    .map(({ chunk, score }) => ({ ...chunk, similarity: score }));
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
