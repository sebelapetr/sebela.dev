// The knowledge base of the backend: composes `@sebela/memory` with the retrieval persistence, the
// public portfolio reads and the configured embedding provider.
import {
  retrievalContentKinds,
  type ContentChange,
  type RetrievalContentKind,
  type SearchRequest,
  type SearchResult,
} from "@sebela/contracts";
import {
  retrievalDimension,
  type RetrievalDocumentVersion,
  type RetrievalPersistence,
} from "@sebela/db";
import {
  BudgetExhaustedError,
  ProviderUnavailableError,
  createIndexer,
  createRetriever,
  createVoyageEmbedder,
  DocumentRejectedError,
  contentHashOf,
  defaultDocumentLimits,
  documentSourceId,
  prepareDocument,
  sensitivityKinds,
  readRetrievalConfig,
  scheduleChanges,
  type Embedder,
  type IndexReport,
  type PortfolioSnapshot,
  type ProcessOptions,
  type QueueReport,
  type CandidateQuestion,
  type DocumentInput,
  type DocumentLimits,
  type DocumentRejection,
  type Indexer,
  type PreparedDocument,
  type SensitivityKind,
  type SensitivityFinding,
  type SourceChunk,
  type SourceSection,
  type RetrievalConfig,
  type RetrievalStore,
  type UsageTotals,
  type WorkCounts,
} from "@sebela/memory";

import { DomainError, type DomainErrorCode } from "../../errors.js";
import type { ProfileService } from "../profile/index.js";
import type { PrivateStorage } from "../storage/index.js";
import type { RoadmapService } from "../roadmap/index.js";

/**
 * Indexing and searching the public portfolio. Every operation that needs the provider fails with
 * a `DomainError` `provider_unavailable` when retrieval is not configured or the provider fails,
 * and `budget_exhausted` once the month's spend reached its ceiling; neither is ever no evidence.
 */
export interface KnowledgeService {
  /** Brings the index in step with the portfolio, embedding only what changed. */
  reindexPortfolio(): Promise<IndexReport>;
  /**
   * Stores every portfolio source again, as after an embedding model or version change; each text
   * is embedded at most once per model, the rest comes from stored vectors.
   */
  rebuildPortfolio(): Promise<IndexReport>;
  /**
   * Queues indexing for committed content changes. A deleted record's passages leave search at
   * once and a changed record's until it is indexed again. Needs no provider or settings.
   */
  schedule(changes: readonly ContentChange[]): Promise<void>;
  /**
   * Runs one bounded batch of queued work against the current portfolio. When the provider is
   * unavailable the batch counts a failed attempt; at the ceiling it stays as it was.
   */
  processPending(options?: ProcessOptions): Promise<QueueReport>;
  /** How much queued work waits, and how much gave up after the most attempts. */
  pending(): Promise<WorkCounts>;
  /** The passages answering the query, or no evidence below the relevance floor. */
  search(request: SearchRequest): Promise<SearchResult>;
  /**
   * Each question's candidate pool as source IDs, best first and without the floor, in the order
   * of the questions; the queries are embedded in batches. For the evals.
   */
  candidates(questions: readonly CandidateQuestion[]): Promise<string[][]>;
  /** The provider usage recorded this calendar month (UTC). */
  usage(): Promise<UsageTotals>;
  /**
   * Ingests a supplemental Markdown or plain-text document for the owner's review; never calls
   * the provider. Bytes already ingested for the same slug change nothing (`created: false`); the
   * same bytes under another slug are a `conflict`. A document with sensitivity findings is
   * recorded `blocked`, with the kinds and lines of the findings only and without its original;
   * otherwise the original is kept in private storage and the version is `pending`. An unsupported
   * or non-UTF-8 file is `unsupported_media_type`, an oversized one `payload_too_large`, and an
   * empty one, an invalid slug or title or an exceeded processing time `validation_failed`.
   * Throws a plain error when no private storage is configured.
   */
  ingestDocument(input: DocumentInput): Promise<DocumentIngest>;
  /** Every ingested document version, newest first. */
  listDocuments(): Promise<DocumentVersion[]>;
  /**
   * The version with this content hash and its preview: the cleaned text, sections and chunks as
   * they would be indexed (`null` and empty once the original is gone) and its findings.
   */
  showDocument(contentHash: string): Promise<DocumentPreview>;
  /**
   * Approves the pending version with exactly this content hash: re-reads the original, verifies
   * its hash, embeds it and makes it searchable, superseding the source's earlier approved
   * version. A blocked, rejected or decided version is a `conflict`; an unknown hash `not_found`.
   */
  approveDocument(contentHash: string): Promise<DocumentApproval>;
  /** Rejects a pending or blocked version and deletes its original; a decided one is a `conflict`. */
  rejectDocument(contentHash: string): Promise<DocumentVersion>;
}

/** An ingested document version as the owner reviews it; the storage key stays inside. */
export type DocumentVersion = Omit<RetrievalDocumentVersion, "storageKey">;

export interface DocumentIngest {
  /** `false` when these bytes were ingested before; nothing changed then. */
  readonly created: boolean;
  readonly version: DocumentVersion;
}

export interface DocumentPreview {
  readonly version: DocumentVersion;
  readonly text: string | null;
  readonly sections: readonly SourceSection[];
  readonly chunks: readonly SourceChunk[];
  readonly findings: readonly SensitivityFinding[];
}

export interface DocumentApproval {
  readonly version: DocumentVersion;
  readonly report: {
    readonly embedded: number;
    readonly reused: number;
    readonly tokens: number;
    readonly costUsd: number;
  };
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
  /** Where originals of supplemental documents are kept; needed to ingest, show and approve. */
  readonly privateStorage?: PrivateStorage;
  /** Limits of a supplemental document; `defaultDocumentLimits` when absent. */
  readonly documentLimits?: DocumentLimits;
}

export function createKnowledgeService(
  sources: KnowledgeSources,
  options: KnowledgeServiceOptions,
): KnowledgeService {
  const { config, embedder } = options;
  const store = narrowStore(sources.store);
  const engine =
    config === null || embedder === undefined
      ? null
      : {
          indexer: createIndexer({ store, embedder, config }),
          retriever: createRetriever({ store, embedder, config }),
        };

  const ready = () => {
    if (engine === null) {
      throw new DomainError("provider_unavailable", "Retrieval is not configured.");
    }
    return engine;
  };

  return {
    reindexPortfolio: () =>
      provider(async () => ready().indexer.reindexPortfolio(await snapshot(sources))),
    rebuildPortfolio: () =>
      provider(async () => ready().indexer.rebuildPortfolio(await snapshot(sources))),
    schedule: async (changes) => {
      if (changes.length === 0) return;
      await scheduleChanges(store, changes, await snapshot(sources));
    },
    processPending: (processOptions) =>
      provider(() => ready().indexer.processPending(() => snapshot(sources), processOptions)),
    pending: () => store.workCounts(),
    search: (request) => provider(() => ready().retriever.search(request)),
    candidates: (questions) => provider(() => ready().retriever.candidates(questions)),
    usage: () => store.usageSince(monthStart(new Date())),
    ...createDocumentReview(sources.store, options, () => ready().indexer),
  };
}

type DocumentReview = Pick<
  KnowledgeService,
  "ingestDocument" | "listDocuments" | "showDocument" | "approveDocument" | "rejectDocument"
>;

/** The owner's review of supplemental documents: ingest, preview, approve and reject. */
function createDocumentReview(
  store: RetrievalPersistence,
  options: KnowledgeServiceOptions,
  indexer: () => Indexer,
): DocumentReview {
  const limits = options.documentLimits ?? defaultDocumentLimits;

  const storage = (): PrivateStorage => {
    if (options.privateStorage === undefined) {
      throw new Error("Supplemental documents need private storage, which is not configured.");
    }
    return options.privateStorage;
  };

  const versionOf = async (contentHash: string): Promise<RetrievalDocumentVersion> => {
    if (!contentHashPattern.test(contentHash)) {
      throw new DomainError(
        "validation_failed",
        "A content hash is the 64 lower-case hexadecimal characters of the version's SHA-256.",
      );
    }
    const version = await store.documentVersion(contentHash);
    if (version === null) {
      throw new DomainError("not_found", "No document version has this content hash.");
    }
    return version;
  };

  /** The stored original prepared again; `null` when it is gone or no longer has its hash. */
  const reprepare = async (version: RetrievalDocumentVersion): Promise<PreparedDocument | null> => {
    if (version.storageKey === null) return null;
    const bytes = await storage().read(version.storageKey);
    if (bytes === null || contentHashOf(bytes) !== version.contentHash) return null;
    return prepare({
      slug: version.sourceId.slice(documentPrefix.length),
      title: version.title,
      fileName: version.mediaType === "text/plain" ? "document.txt" : "document.md",
      bytes,
    });
  };

  const prepare = (input: DocumentInput): PreparedDocument => {
    try {
      return prepareDocument(input, { limits });
    } catch (error) {
      if (error instanceof DocumentRejectedError) {
        throw new DomainError(rejectionCodes[error.reason], error.message);
      }
      throw error;
    }
  };

  return {
    async ingestDocument(input) {
      const privateStorage = storage();
      const contentHash = contentHashOf(input.bytes);
      // An invalid slug is refused by the preparation with its own message, before any lookup.
      if (documentSourceId(input.slug) === null) prepare(input);
      const sourceId = documentSourceId(input.slug);
      const existing = await store.documentVersion(contentHash);
      if (existing !== null) {
        if (existing.sourceId !== sourceId) {
          throw new DomainError(
            "conflict",
            "These exact bytes were already ingested under another slug; ingest them under that slug.",
          );
        }
        return { created: false, version: withoutKey(existing) };
      }

      const prepared = prepare(input);
      const counts = {
        sourceId: prepared.sourceId,
        contentHash: prepared.contentHash,
        title: prepared.title,
        mediaType: prepared.mediaType,
        byteSize: input.bytes.length,
        sectionCount: prepared.sections.length,
        chunkCount: prepared.chunks.length,
      };
      if (prepared.findings.length > 0) {
        const added = await store.addDocumentVersion({
          ...counts,
          storageKey: null,
          status: "blocked",
          findings: prepared.findings,
        });
        return { created: added.created, version: withoutKey(added.version) };
      }

      const storageKey = await privateStorage.store({
        bytes: input.bytes,
        extension: prepared.extension,
      });
      let added;
      try {
        added = await store.addDocumentVersion({
          ...counts,
          storageKey,
          status: "pending",
          findings: [],
        });
      } catch (error) {
        await privateStorage.delete(storageKey);
        throw error;
      }
      // Another ingest of the same bytes won the race; its original is the one kept.
      if (!added.created) await privateStorage.delete(storageKey);
      return { created: added.created, version: withoutKey(added.version) };
    },

    listDocuments: async () => (await store.documentVersions()).map(withoutKey),

    async showDocument(contentHash) {
      const version = await versionOf(contentHash);
      const prepared = await reprepare(version);
      return {
        version: withoutKey(version),
        text: prepared?.text ?? null,
        sections: prepared?.sections ?? [],
        chunks: prepared?.chunks ?? [],
        findings: version.findings.map((finding) => ({
          kind: sensitivityKindOf(finding.kind),
          line: finding.line,
        })),
      };
    },

    async approveDocument(contentHash) {
      const version = await versionOf(contentHash);
      if (version.status === "blocked") {
        throw new DomainError(
          "conflict",
          "This version has sensitivity findings; ingest a sanitized revision and approve that.",
        );
      }
      if (version.status !== "pending") {
        throw new DomainError("conflict", `This version is ${version.status}, not pending.`);
      }
      const prepared = await reprepare(version);
      if (prepared === null) {
        throw new DomainError(
          "conflict",
          "The stored original no longer has this content hash; ingest the document again.",
        );
      }
      const embedding = await provider(() => indexer().embedDocument(prepared));
      if (!(await store.approveDocumentVersion(contentHash, embedding.version))) {
        throw new DomainError("conflict", "This version was decided meanwhile.");
      }
      return { version: withoutKey(await versionOf(contentHash)), report: embedding.report };
    },

    async rejectDocument(contentHash) {
      const version = await versionOf(contentHash);
      if (version.status !== "pending" && version.status !== "blocked") {
        throw new DomainError(
          "conflict",
          `This version is ${version.status}; only a pending or blocked one is rejected.`,
        );
      }
      if (version.storageKey !== null) await storage().delete(version.storageKey);
      if (!(await store.rejectDocumentVersion(contentHash))) {
        throw new DomainError("conflict", "This version was decided meanwhile.");
      }
      return withoutKey(await versionOf(contentHash));
    },
  };
}

const contentHashPattern = /^[0-9a-f]{64}$/;
const documentPrefix = "document:";

const rejectionCodes: Readonly<Record<DocumentRejection, DomainErrorCode>> = {
  invalid_slug: "validation_failed",
  invalid_title: "validation_failed",
  unsupported_type: "unsupported_media_type",
  not_utf8: "unsupported_media_type",
  empty: "validation_failed",
  too_large: "payload_too_large",
  extracted_too_large: "payload_too_large",
  too_slow: "validation_failed",
};

function withoutKey(version: RetrievalDocumentVersion): DocumentVersion {
  return {
    sourceId: version.sourceId,
    contentHash: version.contentHash,
    title: version.title,
    mediaType: version.mediaType,
    byteSize: version.byteSize,
    status: version.status,
    findings: version.findings,
    sectionCount: version.sectionCount,
    chunkCount: version.chunkCount,
    createdAt: version.createdAt,
    decidedAt: version.decidedAt,
  };
}

function sensitivityKindOf(value: string): SensitivityKind {
  const kind = sensitivityKinds.find((known) => known === value);
  if (kind === undefined) throw new Error(`Unknown sensitivity kind ${value}.`);
  return kind;
}

/** The first instant of the calendar month (UTC) of `now`. */
function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Runs a provider operation, turning the provider's failures into domain errors. */
async function provider<Result>(operation: () => Promise<Result>): Promise<Result> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ProviderUnavailableError) {
      const answered =
        error.status === undefined ? "" : `: it answered ${statusClass(error.status)}`;
      throw new DomainError(
        "provider_unavailable",
        `The embedding provider is unavailable${answered}.`,
      );
    }
    if (error instanceof BudgetExhaustedError) {
      throw new DomainError("budget_exhausted", "The month's embedding budget is exhausted.");
    }
    throw error;
  }
}

/** An HTTP status with its class, for example `HTTP 429 (4xx, rate limited)`; nothing of the body. */
function statusClass(status: number): string {
  const kind =
    status === 429
      ? "4xx, rate limited"
      : status >= 500
        ? "5xx, provider error"
        : status >= 400
          ? "4xx, refused"
          : `${String(Math.floor(status / 100))}xx, unexpected`;
  return `HTTP ${String(status)} (${kind})`;
}

/** The content kind the persistence stores as text, narrowed back to the contract's kinds. */
function contentKindOf(value: string): RetrievalContentKind {
  const kind = retrievalContentKinds.find((known) => known === value);
  if (kind === undefined) throw new Error(`Unknown retrieval content kind ${value}.`);
  return kind;
}

/** The persistence as the memory package's store: the same operations, kinds narrowed. */
function narrowStore(persistence: RetrievalPersistence): RetrievalStore {
  return {
    indexedSources: () => persistence.indexedSources(),
    vectorsByHash: (hashes, model, modelVersion) =>
      persistence.vectorsByHash(hashes, model, modelVersion),
    storeVectors: (vectors, model, modelVersion) =>
      persistence.storeVectors(vectors, model, modelVersion),
    replaceSource: (source, unlessWorkAfter) => persistence.replaceSource(source, unlessWorkAfter),
    removeSourcesExcept: (sourceKind, sourceIds) =>
      persistence.removeSourcesExcept(sourceKind, sourceIds),
    recordUsage: (usage) => persistence.recordUsage(usage),
    usageSince: (since) => persistence.usageSince(since),
    nearest: async (query) =>
      (await persistence.nearest(query)).map((chunk) => ({
        ...chunk,
        contentKind: contentKindOf(chunk.contentKind),
      })),
    scheduleWork: (work) => persistence.scheduleWork(work),
    workWatermark: () => persistence.workWatermark(),
    pendingWork: (limit, includeFailed) => persistence.pendingWork(limit, includeFailed),
    completeWork: (ids) => persistence.completeWork(ids),
    failWork: (ids, error, maxAttempts) => persistence.failWork(ids, error, maxAttempts),
    workCounts: () => persistence.workCounts(),
  };
}

/** The public portfolio as the public reads return it. */
async function snapshot({ profile, roadmap }: KnowledgeSources): Promise<PortfolioSnapshot> {
  const person = await profile.getPerson().catch((error: unknown) => {
    if (error instanceof DomainError && error.code === "not_found") return null;
    throw error;
  });
  const [
    experiences,
    projects,
    explorations,
    services,
    education,
    testimonials,
    tree,
    diary,
    books,
    events,
    glossary,
  ] = await Promise.all([
    profile.listExperiences(),
    profile.listProjects(),
    profile.listExplorations(),
    profile.listServices(),
    profile.listEducation(),
    profile.listTestimonials(),
    roadmap.getRoadmap(),
    roadmap.getDiary(),
    roadmap.listBooks(),
    roadmap.listEvents(),
    roadmap.listGlossaryTerms(),
  ]);
  return {
    person,
    experiences,
    projects,
    caseStudies: projects.flatMap((project) => (project.caseStudy ? [project.caseStudy] : [])),
    explorations,
    services,
    education,
    testimonials,
    roadmap: tree,
    diary,
    books,
    events,
    glossary,
  };
}

/**
 * The retrieval options of a process from its environment: the `RETRIEVAL_*` settings (none set
 * switches retrieval off) and the Voyage embedder when `VOYAGE_API_KEY` is set. Throws an error
 * naming every invalid setting, never a value.
 */
export function readRetrievalOptions(
  env: Readonly<Record<string, string | undefined>>,
): KnowledgeServiceOptions {
  const config = readRetrievalConfig(env);
  const apiKey = env["VOYAGE_API_KEY"]?.trim() ?? "";
  if (config === null || apiKey === "") return { config };
  return {
    config,
    embedder: createVoyageEmbedder({
      apiKey,
      model: config.embeddingModel,
      dimension: retrievalDimension,
      timeoutMs: config.providerTimeoutMs,
      retries: config.providerRetries,
      maxRetryWaitMs: config.providerMaxRetryWaitMs,
    }),
  };
}
