import {
  and,
  asc,
  cosineDistance,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  notInArray,
  sql,
} from "drizzle-orm";

import type { Database } from "../../database.js";
import {
  chunks,
  documentVersions,
  embeddings,
  providerUsage,
  sections,
  sources,
  versions,
  workItems,
} from "./schema.js";

export { retrievalDimension } from "./schema.js";

/** Whether a source is portfolio content or a supplemental document. */
export type RetrievalSourceKind = "portfolio" | "supplemental";

/** What an embedding provider call served. */
export type RetrievalUsageOperation = "index" | "search" | "candidates";

/** What is stored about an indexed source: enough to tell whether it is current. */
export interface RetrievalIndexedSource {
  readonly sourceId: string;
  readonly sourceKind: RetrievalSourceKind;
  readonly version: string;
  readonly model: string;
  readonly modelVersion: string;
  /** A content write superseded it; search leaves it out until it is stored again. */
  readonly stale: boolean;
}

/** What queued work asks for: index a changed source again, or drop a deleted one. */
export type RetrievalWorkOperation = "index" | "remove";

/** One queued piece of indexing work. */
export interface RetrievalWorkItem {
  readonly id: string;
  readonly sourceId: string;
  readonly operation: RetrievalWorkOperation;
  readonly attempts: number;
  readonly failed: boolean;
}

/** Work to queue, with the sources it removes or hides from search at once. */
export interface RetrievalScheduledWork {
  readonly removeSourceIds: readonly string[];
  readonly staleSourceIds: readonly string[];
  readonly items: readonly {
    readonly sourceId: string;
    readonly operation: RetrievalWorkOperation;
  }[];
}

/** How much work waits. */
export interface RetrievalWorkCounts {
  readonly pending: number;
  readonly failed: number;
}

/** A section of a source version: its heading path and its span in the version's text. */
export interface RetrievalSectionRecord {
  readonly ordinal: number;
  readonly headingPath: readonly string[];
  readonly start: number;
  readonly end: number;
}

/** A chunk of a section with its vector. */
export interface RetrievalChunkRecord {
  readonly sectionOrdinal: number;
  readonly ordinal: number;
  readonly text: string;
  readonly textHash: string;
  readonly vector: readonly number[];
}

/** One complete version of a source; storing it replaces the source's earlier version. */
export interface RetrievalSourceVersion {
  readonly sourceId: string;
  readonly sourceKind: RetrievalSourceKind;
  readonly contentKind: string;
  readonly title: string;
  readonly path: string | null;
  readonly version: string;
  readonly model: string;
  readonly modelVersion: string;
  readonly dimension: number;
  readonly indexedAt: Date;
  readonly sections: readonly RetrievalSectionRecord[];
  readonly chunks: readonly RetrievalChunkRecord[];
}

/** A nearest-neighbour query over the chunks of one model. */
export interface RetrievalNearestQuery {
  readonly vector: readonly number[];
  readonly model: string;
  readonly modelVersion: string;
  /** Only chunks of sources with these content kinds; every kind when absent. */
  readonly kinds?: readonly string[];
  readonly limit: number;
}

/** A full-text query over the chunks: any of the query's words, ranked by `ts_rank`. */
export interface RetrievalFullTextQuery {
  readonly query: string;
  /** Only chunks of sources with these content kinds; every kind when absent. */
  readonly kinds?: readonly string[];
  readonly limit: number;
}

/** A chunk found by cosine distance, with its source. */
export interface RetrievalNearestChunk {
  readonly sourceId: string;
  readonly sourceKind: RetrievalSourceKind;
  readonly contentKind: string;
  readonly title: string;
  readonly path: string | null;
  readonly version: string;
  readonly text: string;
  readonly headingPath: readonly string[];
  readonly indexedAt: Date;
  /** 1 minus the cosine distance; for a full-text match, its `ts_rank`. */
  readonly similarity: number;
}

/** One provider call and its estimated cost. */
export interface RetrievalUsageRecord {
  readonly operation: RetrievalUsageOperation;
  readonly model: string;
  readonly tokens: number;
  readonly costUsd: number;
  readonly occurredAt: Date;
}

/** Recorded usage in total and per operation. */
export interface RetrievalUsageTotals {
  readonly tokens: number;
  readonly costUsd: number;
  readonly byOperation: Readonly<
    Record<RetrievalUsageOperation, { readonly tokens: number; readonly costUsd: number }>
  >;
}

/**
 * Where a supplemental document version stands: `pending` waits for the owner's decision,
 * `blocked` has sensitivity findings and can never be approved, `approved` is the indexed version
 * of its source until a revision supersedes it, `rejected` was refused by the owner and
 * `withdrawn` was taken out of search by the owner after its approval. Rejected, superseded and
 * withdrawn are final.
 */
export type RetrievalDocumentStatus =
  "pending" | "blocked" | "approved" | "rejected" | "superseded" | "withdrawn";

/**
 * A chunk of an approved version that contradicts the structured portfolio facts and is therefore
 * left out of search: its kind (`date`, `role_title`, `technology`), the chunk's ordinal, the
 * portfolio source it contradicts, the claim found in the chunk and the fact it contradicts.
 */
export interface RetrievalDocumentConflict {
  readonly kind: string;
  readonly chunkOrdinal: number;
  readonly sourceId: string;
  readonly claim: string;
  readonly fact: string;
}

/** A sensitivity finding of a document version: its kind and line, never the detected value. */
export interface RetrievalDocumentFinding {
  readonly kind: string;
  readonly line: number;
}

/** One ingested version of a supplemental document, identified by the hash of its bytes. */
export interface RetrievalDocumentVersion {
  /** `document:<slug>`. */
  readonly sourceId: string;
  /** SHA-256 of the original bytes, lower-case hex. */
  readonly contentHash: string;
  readonly title: string;
  readonly mediaType: string;
  readonly byteSize: number;
  /** The private storage key of the original; `null` once it is gone or when it was never kept. */
  readonly storageKey: string | null;
  readonly status: RetrievalDocumentStatus;
  readonly findings: readonly RetrievalDocumentFinding[];
  /** The conflicts recorded when it was approved or last rebuilt; empty before. */
  readonly conflicts: readonly RetrievalDocumentConflict[];
  readonly sectionCount: number;
  readonly chunkCount: number;
  readonly createdAt: Date;
  /** When it was approved, rejected, superseded or withdrawn. */
  readonly decidedAt: Date | null;
}

/** A version as ingestion records it: waiting for a decision, or blocked by findings. */
export type NewRetrievalDocumentVersion = Omit<
  RetrievalDocumentVersion,
  "status" | "createdAt" | "decidedAt" | "conflicts"
> & { readonly status: "pending" | "blocked" };

/**
 * The persistence of the knowledge index and of embedding spend in the private `retrieval` schema.
 * It implements the store port of `@sebela/memory` structurally.
 */
export interface RetrievalPersistence {
  /** Every indexed source with its current version and embedding model. */
  indexedSources(): Promise<RetrievalIndexedSource[]>;
  /** Cached vectors of these text hashes, embedded with this model and version. */
  vectorsByHash(
    hashes: readonly string[],
    model: string,
    modelVersion: string,
  ): Promise<Map<string, readonly number[]>>;
  /** Adds vectors to the embedding cache; a vector already cached is kept. */
  storeVectors(
    vectors: ReadonlyMap<string, readonly number[]>,
    model: string,
    modelVersion: string,
  ): Promise<void>;
  /**
   * Stores a source version, its sections and chunks in one transaction, replacing the earlier
   * and clearing its stale mark; its chunks' vectors join the embedding cache. With
   * `unlessWorkAfter` (a `workWatermark()`) it stores nothing when work was queued after that
   * watermark; returns whether it stored.
   */
  replaceSource(source: RetrievalSourceVersion, unlessWorkAfter?: number): Promise<boolean>;
  /** Removes every source of this kind that is not named; returns how many it removed. */
  removeSourcesExcept(
    sourceKind: RetrievalSourceKind,
    sourceIds: readonly string[],
  ): Promise<number>;
  recordUsage(usage: RetrievalUsageRecord): Promise<void>;
  /** Usage recorded at or after `since`. */
  usageSince(since: Date): Promise<RetrievalUsageTotals>;
  /** The nearest chunks of non-stale versions by cosine distance, nearest first. */
  nearest(query: RetrievalNearestQuery): Promise<RetrievalNearestChunk[]>;
  /**
   * The chunks of non-stale versions matching any word of the query in the `simple`, unaccented
   * text search configuration, best `ts_rank` first; the rank is reported as the similarity.
   */
  fullText(query: RetrievalFullTextQuery): Promise<RetrievalNearestChunk[]>;
  /** Removes and marks stale the named sources and queues the items, in one transaction. */
  scheduleWork(work: RetrievalScheduledWork): Promise<void>;
  /** The newest work queued so far; covers every `scheduleWork` committed before it. */
  workWatermark(): Promise<number>;
  /** The oldest queued items, at most `limit`; failed ones only with `includeFailed`. */
  pendingWork(limit: number, includeFailed: boolean): Promise<RetrievalWorkItem[]>;
  /** Drops finished items. */
  completeWork(ids: readonly string[]): Promise<void>;
  /** Counts a failed attempt on each item and keeps the error; at `maxAttempts` it is failed. */
  failWork(ids: readonly string[], error: string, maxAttempts: number): Promise<void>;
  workCounts(): Promise<RetrievalWorkCounts>;
  /**
   * Records an ingested document version. A version with the same content hash is never recorded
   * twice: the stored one is returned with `created: false`.
   */
  addDocumentVersion(
    version: NewRetrievalDocumentVersion,
  ): Promise<{ readonly created: boolean; readonly version: RetrievalDocumentVersion }>;
  /** The version with this content hash, or `null`. */
  documentVersion(contentHash: string): Promise<RetrievalDocumentVersion | null>;
  /** Every recorded version, newest first. */
  documentVersions(): Promise<RetrievalDocumentVersion[]>;
  /**
   * Approves the pending version with this content hash with its recorded conflicts and stores
   * `source` (its embedded version, which must be of the same source and carry the hash as its
   * version, without the conflicting chunks) in one transaction; the source's earlier approved
   * version becomes superseded and forgets its storage key, so its chunks and original are no
   * longer referenced. Returns `false` and stores nothing when no pending version has the hash.
   */
  approveDocumentVersion(
    contentHash: string,
    source: RetrievalSourceVersion,
    conflicts?: readonly RetrievalDocumentConflict[],
  ): Promise<boolean>;
  /**
   * Withdraws the approved version with this content hash: in one transaction it becomes
   * `withdrawn`, forgets its storage key and its source leaves the index. Returns `false` when no
   * approved version has the hash.
   */
  withdrawDocumentVersion(contentHash: string): Promise<boolean>;
  /**
   * Deletes every version of the source and its indexed chunks in one transaction; returns the
   * storage keys the versions still held, so their originals can be deleted. Empty when the source
   * had no versions.
   */
  deleteDocumentSource(sourceId: string): Promise<string[]>;
  /**
   * Stores `source` again for the approved version with this content hash and records its
   * conflicts, in one transaction that holds the version's row; returns `false` and stores nothing
   * when the version is no longer approved (it was withdrawn, superseded or deleted meanwhile).
   */
  reindexApprovedDocument(
    contentHash: string,
    source: RetrievalSourceVersion,
    conflicts: readonly RetrievalDocumentConflict[],
  ): Promise<boolean>;
  /**
   * Rejects the pending or blocked version with this content hash and forgets its storage key;
   * returns `false` when there is no such version.
   */
  rejectDocumentVersion(contentHash: string): Promise<boolean>;
  /**
   * Forgets the storage key of the superseded or withdrawn version with this content hash, once
   * its original is deleted; returns `false` when no such version still holds a key.
   */
  forgetDocumentOriginal(contentHash: string): Promise<boolean>;
  /**
   * Removes from the index every supplemental source that has no approved version, or whose
   * approved version is one of `unpublished` (its original is missing), in one statement that reads
   * the versions as it runs; returns how many sources were removed.
   */
  unpublishDocumentSources(unpublished: readonly string[]): Promise<number>;
}

export function createRetrievalPersistence(db: Database): RetrievalPersistence {
  return {
    async indexedSources() {
      const rows = await db
        .select({
          sourceId: sources.sourceId,
          sourceKind: sources.sourceKind,
          version: versions.version,
          model: versions.model,
          modelVersion: versions.modelVersion,
          stale: sources.stale,
        })
        .from(sources)
        .innerJoin(versions, eq(versions.sourceId, sources.id))
        .orderBy(asc(sources.sourceId));
      return rows.map((row) => ({ ...row, sourceKind: sourceKindOf(row.sourceKind) }));
    },

    async vectorsByHash(hashes, model, modelVersion) {
      const found = new Map<string, readonly number[]>();
      if (hashes.length === 0) return found;
      const rows = await db
        .select({ textHash: embeddings.textHash, embedding: embeddings.embedding })
        .from(embeddings)
        .where(
          and(
            inArray(embeddings.textHash, [...new Set(hashes)]),
            eq(embeddings.model, model),
            eq(embeddings.modelVersion, modelVersion),
          ),
        );
      for (const row of rows) found.set(row.textHash, row.embedding);
      return found;
    },

    async storeVectors(vectors, model, modelVersion) {
      await cacheVectors(db, vectors, model, modelVersion);
    },

    async replaceSource(source, unlessWorkAfter) {
      return db.transaction(async (tx) => {
        if (unlessWorkAfter !== undefined) {
          await lockWork(tx);
          const [newer] = await tx
            .select({ seq: workItems.seq })
            .from(workItems)
            .where(gt(workItems.seq, unlessWorkAfter))
            .limit(1);
          if (newer !== undefined) return false;
        }
        await storeVersion(tx, source);
        return true;
      });
    },

    async scheduleWork(work) {
      await db.transaction(async (tx) => {
        await lockWork(tx);
        if (work.removeSourceIds.length > 0) {
          await tx.delete(sources).where(inArray(sources.sourceId, [...work.removeSourceIds]));
        }
        if (work.staleSourceIds.length > 0) {
          await tx
            .update(sources)
            .set({ stale: true })
            .where(inArray(sources.sourceId, [...work.staleSourceIds]));
        }
        if (work.items.length > 0) {
          await tx.insert(workItems).values(work.items.map((item) => ({ ...item })));
        }
      });
    },

    async workWatermark() {
      return db.transaction(async (tx) => {
        await lockWork(tx);
        const [row] = await tx
          .select({ seq: sql<number>`coalesce(max(${workItems.seq}), 0)::float8` })
          .from(workItems);
        return row?.seq ?? 0;
      });
    },

    async pendingWork(limit, includeFailed) {
      const rows = await db
        .select({
          id: workItems.id,
          sourceId: workItems.sourceId,
          operation: workItems.operation,
          attempts: workItems.attempts,
          status: workItems.status,
        })
        .from(workItems)
        .where(inArray(workItems.status, includeFailed ? ["pending", "failed"] : ["pending"]))
        .orderBy(asc(workItems.seq))
        .limit(limit);
      return rows.map(({ status, operation, ...row }) => ({
        ...row,
        operation: workOperationOf(operation),
        failed: status === "failed",
      }));
    },

    async completeWork(ids) {
      if (ids.length === 0) return;
      await db.delete(workItems).where(inArray(workItems.id, [...ids]));
    },

    async failWork(ids, error, maxAttempts) {
      if (ids.length === 0) return;
      await db
        .update(workItems)
        .set({
          attempts: sql`${workItems.attempts} + 1`,
          status: sql`CASE WHEN ${workItems.attempts} + 1 >= ${maxAttempts} THEN 'failed' ELSE 'pending' END`,
          lastError: error.slice(0, 200),
          updatedAt: sql`now()`,
        })
        .where(inArray(workItems.id, [...ids]));
    },

    async workCounts() {
      const rows = await db
        .select({ status: workItems.status, count: count() })
        .from(workItems)
        .groupBy(workItems.status);
      const of = (status: string) => rows.find((row) => row.status === status)?.count ?? 0;
      return { pending: of("pending"), failed: of("failed") };
    },

    async addDocumentVersion(version) {
      const [added] = await db
        .insert(documentVersions)
        .values({
          sourceId: version.sourceId,
          contentHash: version.contentHash,
          title: version.title,
          mediaType: version.mediaType,
          byteSize: version.byteSize,
          storageKey: version.storageKey,
          status: version.status,
          findings: version.findings.map(({ kind, line }) => ({ kind, line })),
          sectionCount: version.sectionCount,
          chunkCount: version.chunkCount,
        })
        .onConflictDoNothing({ target: documentVersions.contentHash })
        .returning();
      if (added !== undefined) return { created: true, version: documentVersionOf(added) };
      const [stored] = await db
        .select()
        .from(documentVersions)
        .where(eq(documentVersions.contentHash, version.contentHash));
      if (stored === undefined) throw new Error("The document version was not stored.");
      return { created: false, version: documentVersionOf(stored) };
    },

    async documentVersion(contentHash) {
      const [row] = await db
        .select()
        .from(documentVersions)
        .where(eq(documentVersions.contentHash, contentHash));
      return row === undefined ? null : documentVersionOf(row);
    },

    async documentVersions() {
      const rows = await db.select().from(documentVersions).orderBy(desc(documentVersions.seq));
      return rows.map(documentVersionOf);
    },

    async approveDocumentVersion(contentHash, source, conflicts = []) {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(documentVersions)
          .where(eq(documentVersions.contentHash, contentHash))
          .for("update");
        if (row?.status !== "pending") return false;
        assertSourceOf(row, source);
        const decidedAt = new Date();
        await tx
          .update(documentVersions)
          .set({ status: "superseded", storageKey: null, decidedAt })
          .where(
            and(
              eq(documentVersions.sourceId, row.sourceId),
              eq(documentVersions.status, "approved"),
            ),
          );
        await tx
          .update(documentVersions)
          .set({ status: "approved", conflicts: conflictsOf(conflicts), decidedAt })
          .where(eq(documentVersions.id, row.id));
        await storeVersion(tx, source);
        return true;
      });
    },

    async rejectDocumentVersion(contentHash) {
      const rejected = await db
        .update(documentVersions)
        .set({ status: "rejected", storageKey: null, decidedAt: new Date() })
        .where(
          and(
            eq(documentVersions.contentHash, contentHash),
            inArray(documentVersions.status, ["pending", "blocked"]),
          ),
        )
        .returning({ id: documentVersions.id });
      return rejected.length > 0;
    },

    async withdrawDocumentVersion(contentHash) {
      return db.transaction(async (tx) => {
        const [withdrawn] = await tx
          .update(documentVersions)
          .set({ status: "withdrawn", storageKey: null, decidedAt: new Date() })
          .where(
            and(
              eq(documentVersions.contentHash, contentHash),
              eq(documentVersions.status, "approved"),
            ),
          )
          .returning({ sourceId: documentVersions.sourceId });
        if (withdrawn === undefined) return false;
        await tx
          .delete(sources)
          .where(
            and(eq(sources.sourceId, withdrawn.sourceId), eq(sources.sourceKind, "supplemental")),
          );
        return true;
      });
    },

    async deleteDocumentSource(sourceId) {
      return db.transaction(async (tx) => {
        const deleted = await tx
          .delete(documentVersions)
          .where(eq(documentVersions.sourceId, sourceId))
          .returning({ storageKey: documentVersions.storageKey });
        await tx
          .delete(sources)
          .where(and(eq(sources.sourceId, sourceId), eq(sources.sourceKind, "supplemental")));
        return deleted.flatMap((row) => (row.storageKey === null ? [] : [row.storageKey]));
      });
    },

    forgetDocumentOriginal: () => Promise.reject(new Error("not implemented")),

    unpublishDocumentSources: () => Promise.reject(new Error("not implemented")),

    async reindexApprovedDocument(contentHash, source, conflicts) {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(documentVersions)
          .where(eq(documentVersions.contentHash, contentHash))
          .for("update");
        if (row?.status !== "approved") return false;
        assertSourceOf(row, source);
        await tx
          .update(documentVersions)
          .set({ conflicts: conflictsOf(conflicts) })
          .where(eq(documentVersions.id, row.id));
        await storeVersion(tx, source);
        return true;
      });
    },

    async fullText(query) {
      if (query.query.trim() === "") return [];
      // Any of the query's words: the plain query's AND operators become OR, so a question is not
      // required to repeat every word of a passage.
      const tsquery = sql`replace(plainto_tsquery('simple', unaccent(${query.query}))::text, '&', '|')::tsquery`;
      const rank = sql<number>`ts_rank(${chunks.search}, ${tsquery})::float8`;
      const rows = await db
        .select({
          sourceId: sources.sourceId,
          sourceKind: sources.sourceKind,
          contentKind: sources.contentKind,
          title: versions.title,
          path: versions.path,
          version: versions.version,
          text: chunks.text,
          headingPath: sections.headingPath,
          indexedAt: versions.indexedAt,
          similarity: rank,
        })
        .from(chunks)
        .innerJoin(versions, eq(versions.id, chunks.versionId))
        .innerJoin(sources, eq(sources.id, versions.sourceId))
        .innerJoin(sections, eq(sections.id, chunks.sectionId))
        .where(
          and(
            eq(sources.stale, false),
            sql`${chunks.search} @@ ${tsquery}`,
            query.kinds === undefined ? undefined : inArray(sources.contentKind, [...query.kinds]),
          ),
        )
        .orderBy(desc(rank), asc(sources.sourceId), asc(chunks.ordinal))
        .limit(query.limit);
      return rows.map((row) => ({ ...row, sourceKind: sourceKindOf(row.sourceKind) }));
    },

    async removeSourcesExcept(sourceKind, sourceIds) {
      const removed = await db
        .delete(sources)
        .where(
          and(
            eq(sources.sourceKind, sourceKind),
            sourceIds.length === 0 ? undefined : notInArray(sources.sourceId, [...sourceIds]),
          ),
        )
        .returning({ id: sources.id });
      return removed.length;
    },

    async recordUsage(usage) {
      await db.insert(providerUsage).values({ ...usage });
    },

    async usageSince(since) {
      const rows = await db
        .select({
          operation: providerUsage.operation,
          tokens: sql<number>`sum(${providerUsage.tokens})::float8`,
          costUsd: sql<number>`sum(${providerUsage.costUsd})::float8`,
        })
        .from(providerUsage)
        .where(gte(providerUsage.occurredAt, since))
        .groupBy(providerUsage.operation);
      const byOperation = {
        index: { tokens: 0, costUsd: 0 },
        search: { tokens: 0, costUsd: 0 },
        candidates: { tokens: 0, costUsd: 0 },
      } satisfies Record<RetrievalUsageOperation, { tokens: number; costUsd: number }>;
      let tokens = 0;
      let costUsd = 0;
      for (const row of rows) {
        const operation = usageOperations.find((known) => known === row.operation);
        if (operation === undefined) continue;
        byOperation[operation] = { tokens: row.tokens, costUsd: row.costUsd };
        tokens += row.tokens;
        costUsd += row.costUsd;
      }
      return { tokens, costUsd, byOperation };
    },

    async nearest(query) {
      const distance = cosineDistance(chunks.embedding, [...query.vector]);
      // The model and content-kind conditions filter the rows an HNSW scan yields, and one scan
      // yields only hnsw.ef_search of them. An iterative scan goes on until `limit` rows pass the
      // filters (or hnsw.max_scan_tuples is reached), still in exact distance order, so a narrow
      // kind is not reported empty while matches exist.
      const rows = await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL hnsw.iterative_scan = strict_order`);
        return tx
          .select({
            sourceId: sources.sourceId,
            sourceKind: sources.sourceKind,
            contentKind: sources.contentKind,
            title: versions.title,
            path: versions.path,
            version: versions.version,
            text: chunks.text,
            headingPath: sections.headingPath,
            indexedAt: versions.indexedAt,
            similarity: sql<number>`(1 - (${distance}))::float8`,
          })
          .from(chunks)
          .innerJoin(versions, eq(versions.id, chunks.versionId))
          .innerJoin(sources, eq(sources.id, versions.sourceId))
          .innerJoin(sections, eq(sections.id, chunks.sectionId))
          .where(
            and(
              eq(sources.stale, false),
              eq(chunks.model, query.model),
              eq(chunks.modelVersion, query.modelVersion),
              query.kinds === undefined
                ? undefined
                : inArray(sources.contentKind, [...query.kinds]),
            ),
          )
          .orderBy(distance)
          .limit(query.limit);
      });
      return rows.map((row) => ({ ...row, sourceKind: sourceKindOf(row.sourceKind) }));
    },
  };
}

type Executor = Pick<Database, "insert">;

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Stores a source version, its sections and chunks inside the caller's transaction. */
async function storeVersion(tx: Transaction, source: RetrievalSourceVersion): Promise<void> {
  const [stored] = await tx
    .insert(sources)
    .values({
      sourceId: source.sourceId,
      sourceKind: source.sourceKind,
      contentKind: source.contentKind,
    })
    .onConflictDoUpdate({
      target: sources.sourceId,
      set: { sourceKind: source.sourceKind, contentKind: source.contentKind, stale: false },
    })
    .returning({ id: sources.id });
  if (stored === undefined) throw new Error("The source was not stored.");
  await tx.delete(versions).where(eq(versions.sourceId, stored.id));
  const [version] = await tx
    .insert(versions)
    .values({
      sourceId: stored.id,
      version: source.version,
      title: source.title,
      path: source.path,
      model: source.model,
      modelVersion: source.modelVersion,
      dimension: source.dimension,
      indexedAt: source.indexedAt,
    })
    .returning({ id: versions.id });
  if (version === undefined) throw new Error("The version was not stored.");
  await cacheVectors(
    tx,
    new Map(source.chunks.map((chunk) => [chunk.textHash, chunk.vector])),
    source.model,
    source.modelVersion,
  );
  if (source.sections.length === 0) return;
  const storedSections = await tx
    .insert(sections)
    .values(
      source.sections.map((section) => ({
        versionId: version.id,
        ordinal: section.ordinal,
        headingPath: [...section.headingPath],
        start: section.start,
        end: section.end,
      })),
    )
    .returning({ id: sections.id, ordinal: sections.ordinal });
  const sectionIds = new Map(storedSections.map((section) => [section.ordinal, section.id]));
  if (source.chunks.length === 0) return;
  await tx.insert(chunks).values(
    source.chunks.map((chunk) => {
      const sectionId = sectionIds.get(chunk.sectionOrdinal);
      if (sectionId === undefined) {
        throw new Error(`Chunk ${String(chunk.ordinal)} names an unknown section.`);
      }
      return {
        versionId: version.id,
        sectionId,
        ordinal: chunk.ordinal,
        text: chunk.text,
        textHash: chunk.textHash,
        search: sql`to_tsvector('simple', unaccent(${chunk.text}))`,
        embedding: [...chunk.vector],
        model: source.model,
        modelVersion: source.modelVersion,
        dimension: source.dimension,
      };
    }),
  );
}

/**
 * Serialises queueing work, reading the watermark and a conditional replace until the end of the
 * caller's transaction. A work item's `seq` is drawn before its transaction commits, so without the
 * lock a watermark could be read past an item that commits later with a lower `seq`.
 */
async function lockWork(tx: Pick<Database, "execute">) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('retrieval.work_items'))`);
}

/** Adds vectors to the embedding cache, keeping a vector already there. */
async function cacheVectors(
  db: Executor,
  vectors: ReadonlyMap<string, readonly number[]>,
  model: string,
  modelVersion: string,
) {
  if (vectors.size === 0) return;
  await db
    .insert(embeddings)
    .values(
      [...vectors].map(([textHash, vector]) => ({
        textHash,
        model,
        modelVersion,
        embedding: [...vector],
      })),
    )
    .onConflictDoNothing();
}

function workOperationOf(value: string): RetrievalWorkOperation {
  if (value === "index" || value === "remove") return value;
  throw new Error(`Unknown work operation ${value}.`);
}

const usageOperations: readonly RetrievalUsageOperation[] = ["index", "search", "candidates"];

function sourceKindOf(value: string): RetrievalSourceKind {
  if (value === "portfolio" || value === "supplemental") return value;
  throw new Error(`Unknown source kind ${value}.`);
}

const documentStatuses: readonly RetrievalDocumentStatus[] = [
  "pending",
  "blocked",
  "approved",
  "rejected",
  "superseded",
  "withdrawn",
];

/** Refuses to index a source that is not the supplemental version of this row. */
function assertSourceOf(row: typeof documentVersions.$inferSelect, source: RetrievalSourceVersion) {
  if (
    source.sourceId !== row.sourceId ||
    source.version !== row.contentHash ||
    source.sourceKind !== "supplemental"
  ) {
    throw new Error("The indexed version is not the version being approved.");
  }
}

function conflictsOf(conflicts: readonly RetrievalDocumentConflict[]) {
  return conflicts.map(({ kind, chunkOrdinal, sourceId, claim, fact }) => ({
    kind,
    chunkOrdinal,
    sourceId,
    claim,
    fact,
  }));
}

function documentVersionOf(row: typeof documentVersions.$inferSelect): RetrievalDocumentVersion {
  const status = documentStatuses.find((known) => known === row.status);
  if (status === undefined) throw new Error(`Unknown document status ${row.status}.`);
  return {
    sourceId: row.sourceId,
    contentHash: row.contentHash,
    title: row.title,
    mediaType: row.mediaType,
    byteSize: row.byteSize,
    storageKey: row.storageKey,
    status,
    findings: row.findings.map(({ kind, line }) => ({ kind, line })),
    conflicts: conflictsOf(row.conflicts),
    sectionCount: row.sectionCount,
    chunkCount: row.chunkCount,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt,
  };
}
