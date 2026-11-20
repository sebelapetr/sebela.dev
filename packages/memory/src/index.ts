// The public interface of @sebela/memory: indexing the portfolio and searching it, the ports the
// backend implements and the embedding providers.
export {
  BudgetExhaustedError,
  ProviderUnavailableError,
  readRetrievalConfig,
} from "./modules/ports/index.js";
export type {
  Embedder,
  Embedding,
  EmbeddingInput,
  IndexedSource,
  NearestChunk,
  NearestQuery,
  PortfolioSnapshot,
  RetrievalConfig,
  RetrievalStore,
  SourceKind,
  SourceVersion,
  StoredChunk,
  StoredSection,
  UsageOperation,
  UsageRecord,
  UsageTotals,
} from "./modules/ports/index.js";
export {
  createFakeEmbedder,
  createVoyageEmbedder,
  fakeEmbeddingModel,
} from "./modules/providers/index.js";
export type { FakeEmbedderOptions, VoyageEmbedderOptions } from "./modules/providers/index.js";
export { createIndexer } from "./modules/indexing/index.js";
export type { IndexReport, Indexer, IndexerOptions } from "./modules/indexing/index.js";
export { createRetriever } from "./modules/retrieval/index.js";
export type { CandidateQuestion, Retriever, RetrieverOptions } from "./modules/retrieval/index.js";
