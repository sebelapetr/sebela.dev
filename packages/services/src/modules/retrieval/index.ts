// The knowledge base of the backend: composes `@sebela/memory` with the retrieval persistence, the
// public portfolio reads and the configured embedding provider.
import { isAbsolute } from "node:path";

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
  createQueryCachingEmbedder,
  createRetriever,
  createVoyageEmbedder,
  createVoyageReranker,
  DocumentRejectedError,
  contentHashOf,
  defaultDocumentLimits,
  documentSourceId,
  findConflicts,
  prepareDocument,
  sensitivityKinds,
  readRetrievalConfig,
  scheduleChanges,
  type Embedder,
  type Reranker,
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
  type SearchVariant,
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
   * The superseded original is deleted afterwards; one private storage could not delete is counted
   * in `originalsLeft` and deleted by the next rebuild, and the approval stands.
   */
  approveDocument(contentHash: string): Promise<DocumentApproval>;
  /** Rejects a pending or blocked version and deletes its original; a decided one is a `conflict`. */
  rejectDocument(contentHash: string): Promise<DocumentVersion>;
  /**
   * Withdraws the approved version with this content hash: its source leaves search at once and
   * its original is deleted. Needs no provider. When private storage cannot delete the original
   * the version stays withdrawn and out of search, keeps its storage key and the call is
   * `provider_unavailable`; withdrawing again finishes it. Any other version that is not approved
   * is a `conflict`; an unknown hash `not_found`.
   */
  withdrawDocument(contentHash: string): Promise<DocumentVersion>;
  /**
   * Deletes the supplemental document with this slug completely: every version, its chunks and
   * every original. Needs no provider. The originals are deleted first: when private storage
   * cannot delete one the call is `provider_unavailable`, nothing is removed from the database and
   * deleting again finishes it. A slug without versions is `not_found`.
   */
  deleteDocument(slug: string): Promise<DocumentDeletion>;
  /**
   * Rebuilds the whole index from the current portfolio and the retained originals of the
   * approved versions, keeping each version's approval; a pending, blocked, rejected, superseded
   * or withdrawn version is never published, and a supplemental source without an approved
   * version leaves the index. Conflicts are checked again against the current facts. An approved
   * version whose original is gone, changed or now has sensitivity findings is counted `missing`,
   * named in `missingVersions` and leaves search, but stays `approved` until it is withdrawn or a
   * revision is approved. A document another process approves while the rebuild runs stays
   * published. Originals still held by superseded or withdrawn versions are deleted;
   * `originalsLeft` counts those private storage could not delete.
   */
  rebuildIndex(): Promise<IndexRebuild>;
}

export interface DocumentDeletion {
  readonly sourceId: string;
  /** How many versions were deleted. */
  readonly deletedVersions: number;
}

export interface IndexRebuild {
  readonly portfolio: IndexReport;
  readonly documents: {
    /** Approved versions stored again. */
    readonly restored: number;
    /** Approved versions whose original was gone, changed or now has sensitivity findings. */
    readonly missing: number;
    /** Content hashes of the missing versions. */
    readonly missingVersions: readonly string[];
    /** Superseded or withdrawn originals private storage could not delete. */
    readonly originalsLeft: number;
    /** Conflicting chunks left out of search. */
    readonly conflicts: number;
    readonly embedded: number;
    readonly reused: number;
    readonly tokens: number;
    readonly costUsd: number;
  };
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
  /** Superseded originals private storage could not delete; the next rebuild deletes them. */
  readonly originalsLeft: number;
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
  /** The cross-encoder that ranks the final passages; without it search is unavailable. */
  readonly reranker?: Reranker;
  /** Where originals of supplemental documents are kept; needed to ingest, show and approve. */
  readonly privateStorage?: PrivateStorage;
  /** Limits of a supplemental document; `defaultDocumentLimits` when absent. */
  readonly documentLimits?: DocumentLimits;
  /**
   * How search ranks: `reranked` (the default and what the site serves: the hybrid pool scored by
   * the reranker) or one of the evals' baselines, `hybrid`, `vector` or `fulltext`.
   */
  readonly searchVariant?: SearchVariant;
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
          retriever: createRetriever({
            store,
            embedder,
            config,
            ...(options.reranker === undefined ? {} : { reranker: options.reranker }),
            variant: options.searchVariant ?? "reranked",
          }),
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
    ...createDocumentReview(sources.store, options, {
      indexer: () => ready().indexer,
      snapshot: () => snapshot(sources),
      rebuildPortfolio: () =>
        provider(async () => ready().indexer.rebuildPortfolio(await snapshot(sources))),
    }),
  };
}

interface DocumentReviewDependencies {
  readonly indexer: () => Indexer;
  /** The public portfolio the conflict checks compare against. */
  readonly snapshot: () => Promise<PortfolioSnapshot>;
  readonly rebuildPortfolio: () => Promise<IndexReport>;
}

type DocumentReview = Pick<
  KnowledgeService,
  | "ingestDocument"
  | "listDocuments"
  | "showDocument"
  | "approveDocument"
  | "rejectDocument"
  | "withdrawDocument"
  | "deleteDocument"
  | "rebuildIndex"
>;

/**
 * The owner's review of supplemental documents: ingest, preview, approve, reject, withdraw and
 * delete, and the rebuild that restores the approved ones.
 */
function createDocumentReview(
  store: RetrievalPersistence,
  options: KnowledgeServiceOptions,
  { indexer, snapshot: facts, rebuildPortfolio }: DocumentReviewDependencies,
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
      fileName: fileNames[version.mediaType] ?? "document.md",
      bytes,
    });
  };

  const prepare = async (input: DocumentInput): Promise<PreparedDocument> => {
    try {
      return await prepareDocument(input, { limits });
    } catch (error) {
      if (error instanceof DocumentRejectedError) {
        throw new DomainError(rejectionCodes[error.reason], error.message);
      }
      throw error;
    }
  };

  /**
   * The chunks that conflict with the API facts and the document without them: the API facts come
   * first, so a conflicting chunk is recorded but never embedded or searchable.
   */
  const checked = async (prepared: PreparedDocument) => {
    const conflicts = findConflicts(prepared.chunks, await facts());
    const excluded = new Set(conflicts.map((conflict) => conflict.chunkOrdinal));
    const searchable: PreparedDocument = {
      ...prepared,
      chunks: prepared.chunks.filter((chunk) => !excluded.has(chunk.ordinal)),
    };
    return { conflicts, searchable, excluded: excluded.size };
  };

  /**
   * Deletes the originals of superseded or withdrawn versions and only then forgets their keys, so
   * an original private storage could not delete stays referenced and a later withdraw, delete or
   * rebuild deletes it. Returns how many were left.
   */
  const discardOriginals = async (versions: readonly RetrievalDocumentVersion[]) => {
    let left = 0;
    for (const version of versions) {
      if (version.storageKey === null) continue;
      try {
        await storage().delete(version.storageKey);
      } catch {
        left += 1;
        continue;
      }
      await store.forgetDocumentOriginal(version.contentHash);
    }
    return left;
  };

  const storageUnavailable = (what: string) =>
    new DomainError(
      "provider_unavailable",
      `Private storage could not delete the original; ${what}`,
    );

  const blockedMessage =
    "This version has sensitivity findings; ingest a sanitized revision and approve that.";

  return {
    async ingestDocument(input) {
      const privateStorage = storage();
      const contentHash = contentHashOf(input.bytes);
      // An invalid slug is refused by the preparation with its own message, before any lookup.
      if (documentSourceId(input.slug) === null) await prepare(input);
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

      const prepared = await prepare(input);
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
          ...(finding.page === undefined ? {} : { page: finding.page }),
          line: finding.line,
        })),
      };
    },

    async approveDocument(contentHash) {
      const version = await versionOf(contentHash);
      if (version.status === "blocked") throw new DomainError("conflict", blockedMessage);
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
      // The checks may have grown since the version was recorded; it is never embedded with findings.
      if (prepared.findings.length > 0) throw new DomainError("conflict", blockedMessage);
      const { conflicts, searchable } = await checked(prepared);
      const embedding = await provider(() => indexer().embedDocument(searchable));
      const superseded = (await store.documentVersions()).filter(
        (other) => other.sourceId === version.sourceId && other.status === "approved",
      );
      if (!(await store.approveDocumentVersion(contentHash, embedding.version, conflicts))) {
        throw new DomainError("conflict", "This version was decided meanwhile.");
      }
      // The superseded version's chunks left with the approval; its original goes now or at the next
      // rebuild, and the approval stands either way.
      const originalsLeft = await discardOriginals(superseded);
      return {
        version: withoutKey(await versionOf(contentHash)),
        originalsLeft,
        report: embedding.report,
      };
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

    async withdrawDocument(contentHash) {
      const version = await versionOf(contentHash);
      const unfinished = version.status === "withdrawn" && version.storageKey !== null;
      if (version.status !== "approved" && !unfinished) {
        throw new DomainError(
          "conflict",
          `This version is ${version.status}; only an approved one is withdrawn.`,
        );
      }
      // Search loses the source in the transaction, before private storage is asked for anything; a
      // withdrawal whose original was left is finished by withdrawing again.
      if (!unfinished && !(await store.withdrawDocumentVersion(contentHash))) {
        throw new DomainError("conflict", "This version was decided meanwhile.");
      }
      if ((await discardOriginals([version])) > 0) {
        throw storageUnavailable(
          "the version is withdrawn and out of search; run withdraw again to delete its original.",
        );
      }
      return withoutKey(await versionOf(contentHash));
    },

    async deleteDocument(slug) {
      const sourceId = documentSourceId(slug);
      if (sourceId === null) {
        throw new DomainError(
          "validation_failed",
          "The slug must be lower-case letters and digits in words joined by hyphens.",
        );
      }
      const versions = (await store.documentVersions()).filter(
        (version) => version.sourceId === sourceId,
      );
      if (versions.length === 0) throw new DomainError("not_found", "No document has this slug.");
      // The originals go first, so a failure leaves every version listed and the delete repeatable;
      // a file already gone counts as deleted.
      const deleteAll = async (keys: readonly (string | null)[]) => {
        try {
          for (const key of keys) if (key !== null) await storage().delete(key);
        } catch {
          throw storageUnavailable("the document is still listed; run delete again.");
        }
      };
      await deleteAll(versions.map((version) => version.storageKey));
      const held = new Set(versions.map((version) => version.storageKey));
      // A version ingested meanwhile is deleted with the others; its original goes too.
      const deleted = await store.deleteDocumentSource(sourceId);
      const ingestedMeanwhile = deleted.filter((key) => !held.has(key));
      await deleteAll(ingestedMeanwhile);
      return { sourceId, deletedVersions: versions.length + ingestedMeanwhile.length };
    },

    async rebuildIndex() {
      const portfolio = await rebuildPortfolio();
      const documents = {
        restored: 0,
        missing: 0,
        missingVersions: [] as string[],
        originalsLeft: 0,
        conflicts: 0,
        embedded: 0,
        reused: 0,
        tokens: 0,
        costUsd: 0,
      };
      const recorded = await store.documentVersions();
      const approved = recorded.filter((version) => version.status === "approved");
      for (const version of approved) {
        const prepared = await reprepare(version);
        // An original that is gone, changed or now has sensitivity findings is never published; the
        // version stays approved until the owner withdraws it or approves a sanitized revision.
        if (prepared === null || prepared.findings.length > 0) {
          documents.missing += 1;
          documents.missingVersions.push(version.contentHash);
          continue;
        }
        const { conflicts, searchable, excluded } = await checked(prepared);
        const embedding = await provider(() => indexer().embedDocument(searchable));
        if (
          !(await store.reindexApprovedDocument(version.contentHash, embedding.version, conflicts))
        ) {
          continue;
        }
        documents.restored += 1;
        documents.conflicts += excluded;
        documents.embedded += embedding.report.embedded;
        documents.reused += embedding.report.reused;
        documents.tokens += embedding.report.tokens;
        documents.costUsd += embedding.report.costUsd;
      }
      // Only approved, restorable documents stay; the database reads the approvals as it removes, so
      // a document another process approves meanwhile stays published.
      await store.unpublishDocumentSources(documents.missingVersions);
      documents.originalsLeft = await discardOriginals(
        recorded.filter(
          (version) => version.status === "superseded" || version.status === "withdrawn",
        ),
      );
      return { portfolio, documents };
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
  malformed: "unsupported_media_type",
  encrypted: "unsupported_media_type",
  no_text_layer: "unsupported_media_type",
  incomplete_extraction: "unsupported_media_type",
  too_many_pages: "payload_too_large",
  parser_limit: "payload_too_large",
};

/** The file name a stored original is prepared under again, by its recorded media type. */
const fileNames: Readonly<Record<string, string>> = {
  "text/markdown": "document.md",
  "text/plain": "document.txt",
  "application/pdf": "document.pdf",
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
    conflicts: version.conflicts,
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
        `The retrieval provider is unavailable${answered}.`,
      );
    }
    if (error instanceof BudgetExhaustedError) {
      throw new DomainError("budget_exhausted", "The month's retrieval budget is exhausted.");
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
    fullText: async (query) =>
      (await persistence.fullText(query)).map((chunk) => ({
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
 * switches retrieval off) and, when `VOYAGE_API_KEY` is set, the Voyage embedder and reranker (the
 * configured `RETRIEVAL_RERANK_MODEL`) on that key. An absolute
 * `RETRIEVAL_QUERY_CACHE_FILE` keeps query embeddings in that file and reuses them, for paid eval
 * runs only, and `RETRIEVAL_EVAL_VARIANT` (`reranked` when absent, `hybrid`, `vector` or `fulltext`) chooses the ranking
 * an eval run measures. Throws an error naming every invalid setting, never a value.
 */
export function readRetrievalOptions(
  env: Readonly<Record<string, string | undefined>>,
): KnowledgeServiceOptions {
  const config = readRetrievalConfig(env);
  const searchVariant = searchVariantOf(env["RETRIEVAL_EVAL_VARIANT"]);
  const apiKey = env["VOYAGE_API_KEY"]?.trim() ?? "";
  if (config === null) return { config };
  if (apiKey === "") return { config, searchVariant };
  const cacheFile = env["RETRIEVAL_QUERY_CACHE_FILE"]?.trim() ?? "";
  if (cacheFile !== "" && !isAbsolute(cacheFile)) {
    throw new Error("RETRIEVAL_QUERY_CACHE_FILE must be an absolute path.");
  }
  const voyage = createVoyageEmbedder({
    apiKey,
    model: config.embeddingModel,
    dimension: retrievalDimension,
    timeoutMs: config.providerTimeoutMs,
    retries: config.providerRetries,
    maxRetryWaitMs: config.providerMaxRetryWaitMs,
  });
  return {
    config,
    embedder: cacheFile === "" ? voyage : createQueryCachingEmbedder(voyage, cacheFile),
    reranker: createVoyageReranker({
      apiKey,
      model: config.rerankModel,
      timeoutMs: config.providerTimeoutMs,
      retries: config.providerRetries,
      maxRetryWaitMs: config.providerMaxRetryWaitMs,
    }),
    searchVariant,
  };
}

function searchVariantOf(value: string | undefined): SearchVariant {
  const variant = value?.trim() ?? "";
  if (variant === "" || variant === "reranked") return "reranked";
  if (variant === "hybrid" || variant === "vector" || variant === "fulltext") return variant;
  throw new Error("RETRIEVAL_EVAL_VARIANT must be reranked, hybrid, vector or fulltext.");
}
