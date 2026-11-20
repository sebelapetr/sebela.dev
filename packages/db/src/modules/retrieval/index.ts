import type { Database } from "../../database.js";

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
  const missing = (): never => {
    throw new Error(`Not implemented: ${typeof db}`);
  };
  return {
    indexedSources: missing,
    vectorsByHash: missing,
    replaceSource: missing,
    removeSourcesExcept: missing,
    recordUsage: missing,
    usageSince: missing,
    nearest: missing,
  };
}
