import { and, asc, cosineDistance, eq, gte, inArray, notInArray, sql } from "drizzle-orm";

import type { Database } from "../../database.js";
import { chunks, providerUsage, sections, sources, versions } from "./schema.js";

export { retrievalDimension } from "./schema.js";

/** Whether a source is portfolio content or a supplemental document. */
export type RetrievalSourceKind = "portfolio" | "supplemental";

/** What an embedding provider call served. */
export type RetrievalUsageOperation = "index" | "search" | "candidates";

/** What is stored about an indexed source: enough to tell whether it is current. */
export interface RetrievalIndexedSource {
  readonly sourceId: string;
  readonly version: string;
  readonly model: string;
  readonly modelVersion: string;
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
  /** 1 minus the cosine distance. */
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
 * The persistence of the knowledge index and of embedding spend in the private `retrieval` schema.
 * It implements the store port of `@sebela/memory` structurally.
 */
export interface RetrievalPersistence {
  /** Every indexed source with its current version and embedding model. */
  indexedSources(): Promise<RetrievalIndexedSource[]>;
  /** Stored vectors of chunks with these text hashes, embedded with this model and version. */
  vectorsByHash(
    hashes: readonly string[],
    model: string,
    modelVersion: string,
  ): Promise<Map<string, readonly number[]>>;
  /** Stores a source version, its sections and chunks in one transaction, replacing the earlier. */
  replaceSource(source: RetrievalSourceVersion): Promise<void>;
  /** Removes every source of this kind that is not named; returns how many it removed. */
  removeSourcesExcept(
    sourceKind: RetrievalSourceKind,
    sourceIds: readonly string[],
  ): Promise<number>;
  recordUsage(usage: RetrievalUsageRecord): Promise<void>;
  /** Usage recorded at or after `since`. */
  usageSince(since: Date): Promise<RetrievalUsageTotals>;
  /** The nearest chunks by cosine distance, nearest first. */
  nearest(query: RetrievalNearestQuery): Promise<RetrievalNearestChunk[]>;
}

export function createRetrievalPersistence(db: Database): RetrievalPersistence {
  return {
    async indexedSources() {
      return db
        .select({
          sourceId: sources.sourceId,
          version: versions.version,
          model: versions.model,
          modelVersion: versions.modelVersion,
        })
        .from(sources)
        .innerJoin(versions, eq(versions.sourceId, sources.id))
        .orderBy(asc(sources.sourceId));
    },

    async vectorsByHash(hashes, model, modelVersion) {
      const found = new Map<string, readonly number[]>();
      if (hashes.length === 0) return found;
      const rows = await db
        .selectDistinctOn([chunks.textHash], {
          textHash: chunks.textHash,
          embedding: chunks.embedding,
        })
        .from(chunks)
        .where(
          and(
            inArray(chunks.textHash, [...hashes]),
            eq(chunks.model, model),
            eq(chunks.modelVersion, modelVersion),
          ),
        )
        .orderBy(chunks.textHash);
      for (const row of rows) found.set(row.textHash, row.embedding);
      return found;
    },

    async replaceSource(source) {
      await db.transaction(async (tx) => {
        const [stored] = await tx
          .insert(sources)
          .values({
            sourceId: source.sourceId,
            sourceKind: source.sourceKind,
            contentKind: source.contentKind,
          })
          .onConflictDoUpdate({
            target: sources.sourceId,
            set: { sourceKind: source.sourceKind, contentKind: source.contentKind },
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
      });
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

const usageOperations: readonly RetrievalUsageOperation[] = ["index", "search", "candidates"];

function sourceKindOf(value: string): RetrievalSourceKind {
  if (value === "portfolio" || value === "supplemental") return value;
  throw new Error(`Unknown source kind ${value}.`);
}
