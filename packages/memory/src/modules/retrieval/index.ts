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

import {
  ProviderUnavailableError,
  type Embedder,
  type NearestChunk,
  type RetrievalConfig,
  type RetrievalStore,
  type UsageOperation,
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
   * For each question, in order, the source IDs of its candidate pool, best first, without the
   * floor and, like the search, only of the given kinds when any; for the evals' recall. The
   * queries are embedded together, `embeddingBatchSize` per provider call. Throws as `search` does.
   */
  candidates(questions: readonly CandidateQuestion[]): Promise<string[][]>;
}

/** One question of a candidate run. */
export interface CandidateQuestion {
  readonly query: string;
  readonly kinds?: readonly RetrievalContentKind[];
}

export function createRetriever(options: RetrieverOptions): Retriever {
  const { store, embedder, config } = options;
  const spend = createSpend({ store, embedder, config, now: options.now });

  /** The candidate pool of a query's vector, best chunk of each source first. */
  async function pool(
    vector: readonly number[],
    kinds?: readonly RetrievalContentKind[],
  ): Promise<NearestChunk[]> {
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

  return {
    async search(request) {
      const limit = Math.min(request.limit ?? config.finalPassages, config.finalPassages);
      const [vector] = await embedQueries("search", [request.query]);
      const found = vector === undefined ? [] : await pool(vector, request.kinds);
      const passages = found
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
    async candidates(questions) {
      const vectors = await embedQueries(
        "candidates",
        questions.map((question) => question.query),
      );
      const pools: string[][] = [];
      for (const [index, { kinds }] of questions.entries()) {
        const vector = vectors[index];
        if (vector === undefined) throw new ProviderUnavailableError("A vector was missing.");
        pools.push((await pool(vector, kinds)).map((chunk) => chunk.sourceId));
      }
      return pools;
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
