import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  primaryKey,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  text,
  timestamp,
  unique,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

/** The vector length every stored chunk has; a model of another dimension needs a migration. */
export const retrievalDimension = 1024;

export const retrievalSchema = pgSchema("retrieval");

/**
 * A `tsvector` column. It is written at insert time with `to_tsvector('simple', unaccent(text))`:
 * `unaccent` is not immutable, so the column cannot be a generated one.
 */
const tsvector = customType<{ data: string }>({
  dataType: () => "tsvector",
});

/**
 * A source of the knowledge index: a public portfolio record or a supplemental document. Private
 * operational state, derived from content; never content itself.
 */
export const sources = retrievalSchema.table(
  "sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: text("source_id").notNull().unique(),
    sourceKind: text("source_kind").notNull(),
    contentKind: text("content_kind").notNull(),
    /** A content write superseded the indexed version; search leaves it out until it is stored. */
    stale: boolean("stale").notNull().default(false),
  },
  (table) => [
    check("sources_kind_known", sql`${table.sourceKind} IN ('portfolio', 'supplemental')`),
    check("sources_id_bounded", sql`char_length(${table.sourceId}) BETWEEN 1 AND 200`),
  ],
);

/** The one indexed version of a source: the hash of its text and the model that embedded it. */
export const versions = retrievalSchema.table(
  "versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    version: text("version").notNull(),
    title: text("title").notNull(),
    path: text("path"),
    model: text("model").notNull(),
    modelVersion: text("model_version").notNull(),
    dimension: integer("dimension").notNull(),
    indexedAt: timestamp("indexed_at", { withTimezone: true }).notNull(),
  },
  (table) => [unique("versions_one_per_source").on(table.sourceId)],
);

/** A section of a version: its heading path and its span in the version's text. */
export const sections = retrievalSchema.table(
  "sections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    versionId: uuid("version_id")
      .notNull()
      .references(() => versions.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    headingPath: text("heading_path").array().notNull(),
    start: integer("start").notNull(),
    end: integer("end").notNull(),
  },
  (table) => [
    unique("sections_ordinal_per_version").on(table.versionId, table.ordinal),
    check("sections_span_ordered", sql`0 <= ${table.start} AND ${table.start} <= ${table.end}`),
  ],
);

/** A chunk of a section with its vector, its full-text form and the model that embedded it. */
export const chunks = retrievalSchema.table(
  "chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    versionId: uuid("version_id")
      .notNull()
      .references(() => versions.id, { onDelete: "cascade" }),
    sectionId: uuid("section_id")
      .notNull()
      .references(() => sections.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    text: text("text").notNull(),
    textHash: text("text_hash").notNull(),
    search: tsvector("search").notNull(),
    embedding: vector("embedding", { dimensions: retrievalDimension }).notNull(),
    model: text("model").notNull(),
    modelVersion: text("model_version").notNull(),
    dimension: integer("dimension").notNull(),
  },
  (table) => [
    unique("chunks_ordinal_per_version").on(table.versionId, table.ordinal),
    index("chunks_embedding_hnsw").using("hnsw", table.embedding.op("vector_cosine_ops")),
    index("chunks_search_gin").using("gin", table.search),
    index("chunks_text_hash_model").on(table.textHash, table.model, table.modelVersion),
  ],
);

/**
 * Every vector ever embedded, by text hash and model, so no text is embedded twice: not across an
 * interrupted run, a superseded version or a rebuild.
 */
export const embeddings = retrievalSchema.table(
  "embeddings",
  {
    textHash: text("text_hash").notNull(),
    model: text("model").notNull(),
    modelVersion: text("model_version").notNull(),
    embedding: vector("embedding", { dimensions: retrievalDimension }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.textHash, table.model, table.modelVersion] })],
);

/**
 * Queued indexing work: each item owes a run over the portfolio, and `seq` orders the items as
 * they were queued. Pending items wait. An item whose runs failed `maxAttempts` times is failed:
 * runs no longer take it, but every run reconciles the whole portfolio, so a later successful run
 * covers its change too; an explicit re-index takes and clears it.
 */
export const workItems = retrievalSchema.table(
  "work_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seq: bigint("seq", { mode: "number" }).notNull().generatedAlwaysAsIdentity(),
    sourceId: text("source_id").notNull(),
    operation: text("operation").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("work_items_operation_known", sql`${table.operation} IN ('index', 'remove')`),
    check(
      "work_items_status_known",
      sql`${table.status} IN ('pending', 'running', 'done', 'failed')`,
    ),
    index("work_items_status").on(table.status, table.createdAt),
  ],
);

/** Every embedding provider call: what it served, its tokens and its estimated cost. */
export const providerUsage = retrievalSchema.table(
  "provider_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    operation: text("operation").notNull(),
    model: text("model").notNull(),
    tokens: integer("tokens").notNull(),
    costUsd: numeric("cost_usd", { precision: 14, scale: 8, mode: "number" }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      "provider_usage_operation_known",
      sql`${table.operation} IN ('index', 'search', 'candidates')`,
    ),
    check("provider_usage_not_negative", sql`${table.tokens} >= 0 AND ${table.costUsd} >= 0`),
    index("provider_usage_occurred_at").on(table.occurredAt),
  ],
);

/**
 * Every ingested version of a supplemental document, identified by the SHA-256 of its original
 * bytes: its display title, type, size, private storage key, the owner's decision and the kinds and
 * lines of its sensitivity findings, never the detected values, and the conflicts its approved chunks
 * have with the structured portfolio facts. Private operational state; the
 * original stays in private storage and only an approved version's passages are indexed.
 */
export const documentVersions = retrievalSchema.table(
  "document_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seq: bigint("seq", { mode: "number" }).notNull().generatedAlwaysAsIdentity(),
    sourceId: text("source_id").notNull(),
    contentHash: text("content_hash").notNull().unique(),
    title: text("title").notNull(),
    mediaType: text("media_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    storageKey: text("storage_key"),
    status: text("status").notNull(),
    findings: jsonb("findings").$type<{ kind: string; line: number }[]>().notNull(),
    /** Chunks that contradict the structured portfolio facts; left out of search. */
    conflicts: jsonb("conflicts")
      .$type<
        { kind: string; chunkOrdinal: number; sourceId: string; claim: string; fact: string }[]
      >()
      .notNull()
      .default([]),
    sectionCount: integer("section_count").notNull(),
    chunkCount: integer("chunk_count").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (table) => [
    check("document_versions_hash_hex", sql`${table.contentHash} ~ '^[0-9a-f]{64}$'`),
    check(
      "document_versions_source_bounded",
      sql`char_length(${table.sourceId}) BETWEEN 1 AND 200`,
    ),
    check("document_versions_title_bounded", sql`char_length(${table.title}) BETWEEN 1 AND 300`),
    check(
      "document_versions_status_known",
      sql`${table.status} IN ('pending', 'blocked', 'approved', 'rejected', 'superseded', 'withdrawn')`,
    ),
    check(
      "document_versions_counts_not_negative",
      sql`${table.byteSize} >= 0 AND ${table.sectionCount} >= 0 AND ${table.chunkCount} >= 0`,
    ),
    index("document_versions_source").on(table.sourceId, table.status),
  ],
);
