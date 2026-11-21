// The public interface of @sebela/memory: indexing the portfolio and supplemental documents and
// searching them, the ports the backend implements and the embedding providers.
export {
  BudgetExhaustedError,
  ProviderUnavailableError,
  readRetrievalConfig,
} from "./modules/ports/index.js";
export type {
  Embedder,
  Embedding,
  EmbeddingInput,
  FullTextQuery,
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
  ScheduledWork,
  WorkCounts,
  WorkItem,
  WorkOperation,
} from "./modules/ports/index.js";
export type { SourceChunk, SourceSection } from "./modules/ingest/index.js";
export { scheduleChanges } from "./modules/scheduling/index.js";
export {
  createFakeEmbedder,
  createQueryCachingEmbedder,
  createVoyageEmbedder,
  fakeEmbeddingModel,
} from "./modules/providers/index.js";
export type { FakeEmbedderOptions, VoyageEmbedderOptions } from "./modules/providers/index.js";
export { createIndexer, maxWorkAttempts, workBatchLimit } from "./modules/indexing/index.js";
export type {
  DocumentEmbedding,
  IndexReport,
  Indexer,
  IndexerOptions,
  ProcessOptions,
  QueueReport,
} from "./modules/indexing/index.js";
export { createRetriever } from "./modules/retrieval/index.js";
export type {
  CandidateQuestion,
  Retriever,
  RetrieverOptions,
  SearchVariant,
} from "./modules/retrieval/index.js";
export { findConflicts } from "./modules/conflicts/index.js";
export type { DocumentConflict, DocumentConflictKind } from "./modules/conflicts/index.js";
export {
  DocumentRejectedError,
  contentHashOf,
  defaultDocumentLimits,
  documentSourceId,
  documentTypeOf,
  prepareDocument,
  sensitivityKinds,
} from "./modules/documents/index.js";
export type {
  DocumentExtension,
  DocumentInput,
  DocumentLimits,
  DocumentMediaType,
  DocumentRejection,
  PrepareOptions,
  PreparedDocument,
  SensitivityFinding,
  SensitivityKind,
} from "./modules/documents/index.js";
