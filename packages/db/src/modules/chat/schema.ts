import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * The visitor chat: private operational data, never content and never public. No client address,
 * cookie value, grant or challenge token is stored — only one-way verifiers and keyed fingerprints.
 * Everything a visitor owns cascades from the identity, so retention deletes it in one statement;
 * spend and deletion accounting have no reference to it and survive.
 */
export const chatSchema = pgSchema("chat");

const at = (name: string) => timestamp(name, { withTimezone: true });

/** A first-party cookie identity; only the SHA-256 verifier of the cookie value is stored. */
export const identities = chatSchema.table("identities", {
  id: uuid("id").primaryKey().defaultRandom(),
  verifier: text("verifier").notNull().unique(),
  createdAt: at("created_at").notNull(),
  lastSeenAt: at("last_seen_at").notNull(),
});

/**
 * The one conversation of an identity; `revision` grows with each completed exchange and each
 * installed compaction. `summary` is the installed compaction summary of the working context
 * (untrusted history, validated on every read) and `summary_through_position` the last message it
 * folds: the working context is the summary and the answered exchanges after that position.
 */
export const conversations = chatSchema.table("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  identityId: uuid("identity_id")
    .notNull()
    .unique()
    .references(() => identities.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull().default(0),
  createdAt: at("created_at").notNull(),
  lastActivityAt: at("last_activity_at").notNull(),
  summary: jsonb("summary"),
  summaryThroughPosition: bigint("summary_through_position", { mode: "number" }),
});

/** The questions and approved answers of a conversation, in `position` order. */
export const messages = chatSchema.table(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    position: bigint("position", { mode: "number" }).notNull().generatedAlwaysAsIdentity(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    requestId: uuid("request_id").notNull(),
    status: text("status").notNull(),
    text: text("text"),
    outcome: text("outcome"),
    errorCode: text("error_code"),
    errorRetryable: boolean("error_retryable"),
    language: text("language"),
    blocks: jsonb("blocks").$type<unknown[]>().notNull().default([]),
    sources: jsonb("sources").$type<unknown[]>().notNull().default([]),
    related: jsonb("related").$type<unknown[]>().notNull().default([]),
    createdAt: at("created_at").notNull(),
    /** Set on a failed answer an explicit retry replaced; the conversation no longer shows it. */
    supersededAt: at("superseded_at"),
  },
  (table) => [
    index("messages_conversation_position").on(table.conversationId, table.position),
    check("messages_role_known", sql`${table.role} IN ('user', 'assistant')`),
    check(
      "messages_status_known",
      sql`${table.status} IN ('pending', 'completed', 'failed', 'interrupted', 'cancelled')`,
    ),
    check(
      "messages_user_has_text",
      sql`${table.role} <> 'user' OR (${table.text} IS NOT NULL AND ${table.status} = 'completed')`,
    ),
  ],
);

/**
 * One admitted attempt at a question: bound to its identity, conversation, request id and
 * canonical question, with its absolute deadline, the bound model, pricing and allowance, and —
 * after reconciling — the non-content usage accounting. At most one is active per identity. The
 * first attempt of a request has `attempt_key` = `request_id`; an explicit retry has its own retry
 * id as `attempt_key` and names the attempt it retries in `retry_of`.
 */
export const operations = chatSchema.table(
  "operations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identityId: uuid("identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    requestId: uuid("request_id").notNull(),
    attemptKey: uuid("attempt_key").notNull(),
    retryOf: uuid("retry_of"),
    questionHash: text("question_hash").notNull(),
    /** `answer` asks one question; `compaction` summarizes the working context, with no message. */
    kind: text("kind").notNull().default("answer"),
    userMessageId: uuid("user_message_id").references(() => messages.id, { onDelete: "cascade" }),
    assistantMessageId: uuid("assistant_message_id").references(() => messages.id, {
      onDelete: "cascade",
    }),
    status: text("status").notNull(),
    admittedAt: at("admitted_at").notNull(),
    deadlineAt: at("deadline_at").notNull(),
    finishedAt: at("finished_at"),
    model: text("model").notNull(),
    /** The main call's reasoning effort; `NULL` for an operation admitted before it was bound. */
    effort: text("effort"),
    pricingVersion: text("pricing_version").notNull(),
    allowanceMicroUsd: bigint("allowance_micro_usd", { mode: "number" }).notNull(),
    contextRevision: integer("context_revision").notNull(),
    resultOutcome: text("result_outcome"),
    resultReason: text("result_reason"),
    costMicroUsd: bigint("cost_micro_usd", { mode: "number" }),
    costUncertain: boolean("cost_uncertain"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    modelAttempts: integer("model_attempts"),
    latencyMs: integer("latency_ms"),
    versions: jsonb("versions").$type<Record<string, string>>(),
    /**
     * The last main call's serialized input: the tokenizer estimate, the provider-reported count
     * when known, and the input cap it was measured against. `NULL` when nothing was measured.
     */
    contextEstimatedInputTokens: integer("context_estimated_input_tokens"),
    contextReportedInputTokens: integer("context_reported_input_tokens"),
    contextCapTokens: integer("context_cap_tokens"),
    /**
     * A compaction's result: how many compacted exchanges stay verbatim, the summary's tokens, and
     * the estimate of the next working context (only when the summary was installed). Its outcome
     * and reason are `result_outcome` and `result_reason`.
     */
    compactionKept: integer("compaction_kept"),
    compactionSummaryTokens: integer("compaction_summary_tokens"),
    compactionNextInputTokens: integer("compaction_next_input_tokens"),
  },
  (table) => [
    unique("operations_identity_attempt").on(table.identityId, table.attemptKey),
    index("operations_identity_request").on(table.identityId, table.requestId),
    uniqueIndex("operations_one_active_per_identity")
      .on(table.identityId)
      .where(sql`${table.status} IN ('accepted', 'running')`),
    index("operations_active_deadline")
      .on(table.deadlineAt)
      .where(sql`${table.status} IN ('accepted', 'running')`),
    check(
      "operations_status_known",
      sql`${table.status} IN ('accepted', 'running', 'completed', 'failed', 'interrupted', 'cancelled')`,
    ),
    check("operations_allowance_positive", sql`${table.allowanceMicroUsd} > 0`),
    check(
      "operations_kind_messages",
      sql`(${table.kind} = 'answer' AND ${table.userMessageId} IS NOT NULL AND ${table.assistantMessageId} IS NOT NULL) OR (${table.kind} = 'compaction' AND ${table.userMessageId} IS NULL AND ${table.assistantMessageId} IS NULL)`,
    ),
  ],
);

/** The one-use generation grant of an operation; only its SHA-256 verifier is stored. */
export const grants = chatSchema.table("grants", {
  operationId: uuid("operation_id")
    .primaryKey()
    .references(() => operations.id, { onDelete: "cascade" }),
  verifier: text("verifier").notNull(),
  expiresAt: at("expires_at").notNull(),
  claimedAt: at("claimed_at"),
});

/**
 * A redeemed bot-challenge token (its SHA-256 hash), bound to the operation it admitted. It
 * outlives a cleared conversation (the reference becomes `NULL`), so a token is never redeemed
 * twice, and retention purges it after `expires_at`.
 */
export const challengeRedemptions = chatSchema.table(
  "challenge_redemptions",
  {
    /** The SHA-256 digest of the token; the token itself is never stored. */
    digest: text("digest").primaryKey(),
    operationId: uuid("operation_id").references(() => operations.id, { onDelete: "set null" }),
    redeemedAt: at("redeemed_at").notNull(),
    expiresAt: at("expires_at").notNull(),
  },
  (table) => [index("challenge_redemptions_expiry").on(table.expiresAt)],
);

/**
 * An operation of a cleared conversation that may still report: the grant's verifier only, so a
 * late result recreates nothing yet settles its measured cost once. Retention purges it after
 * `expires_at`. No reference to the deleted operation.
 */
export const operationTombstones = chatSchema.table(
  "operation_tombstones",
  {
    operationId: uuid("operation_id").primaryKey(),
    verifier: text("verifier").notNull(),
    deletedAt: at("deleted_at").notNull(),
    expiresAt: at("expires_at").notNull(),
  },
  (table) => [index("operation_tombstones_expiry").on(table.expiresAt)],
);

/**
 * A telemetry trace registered for export, so deleting the conversation, or its 30-day expiry,
 * can delete the remote copy too. Identifiers and times only: the exporter may still export it
 * until `export_until`; it moves to `telemetry_deletions` when the conversation goes or at
 * `expires_at`.
 */
export const telemetryReferences = chatSchema.table(
  "telemetry_references",
  {
    traceId: text("trace_id").primaryKey(),
    conversationId: uuid("conversation_id").notNull(),
    operationId: uuid("operation_id"),
    recordedAt: at("recorded_at").notNull(),
    exportUntil: at("export_until").notNull(),
    expiresAt: at("expires_at").notNull(),
  },
  (table) => [
    index("telemetry_references_conversation").on(table.conversationId),
    index("telemetry_references_expiry").on(table.expiresAt, table.traceId),
  ],
);

/**
 * A remote telemetry deletion the API owes: `pending` until the trace store confirms it, with the
 * failed attempts counted and the next attempt never before the trace's last possible export;
 * `completed` after. No content and no reference to the conversation.
 */
export const telemetryDeletions = chatSchema.table(
  "telemetry_deletions",
  {
    traceId: text("trace_id").primaryKey(),
    requestedAt: at("requested_at").notNull(),
    state: text("state").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: at("next_attempt_at").notNull().defaultNow(),
    settledAt: at("settled_at"),
  },
  (table) => [
    index("telemetry_deletions_due")
      .on(table.nextAttemptAt, table.traceId)
      .where(sql`${table.state} = 'pending'`),
    check("telemetry_deletions_state_known", sql`${table.state} IN ('pending', 'completed')`),
  ],
);

/**
 * A short-lived claim on one request of an identity, taken before its bot-challenge token is
 * verified, so concurrent equal submissions call the verifier once. Digests only; it lapses at
 * `expires_at` and admissions prune it.
 */
export const requestClaims = chatSchema.table(
  "request_claims",
  {
    identityId: uuid("identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    requestId: uuid("request_id").notNull(),
    questionHash: text("question_hash").notNull(),
    /** The SHA-256 digest of the challenge token the holder verifies. */
    challengeDigest: text("challenge_digest").notNull(),
    state: text("state").notNull(),
    claimedAt: at("claimed_at").notNull(),
    expiresAt: at("expires_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.identityId, table.requestId] }),
    index("request_claims_expiry").on(table.expiresAt),
    check("request_claims_state_known", sql`${table.state} IN ('pending', 'verified', 'failed')`),
  ],
);

/**
 * One admitted question for the quotas: the identity and the keyed address fingerprint. It names
 * its operation without a reference, so it outlives a cleared conversation and keeps counting;
 * only work that never started gives it back.
 */
export const admissions = chatSchema.table(
  "admissions",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    identityId: uuid("identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    fingerprint: text("fingerprint").notNull(),
    /** `NULL` for an admission recorded before operations were named. */
    operationId: uuid("operation_id"),
    admittedAt: at("admitted_at").notNull(),
    expiresAt: at("expires_at").notNull(),
  },
  (table) => [
    index("admissions_identity").on(table.identityId, table.admittedAt),
    index("admissions_operation").on(table.operationId),
    index("admissions_fingerprint").on(table.fingerprint, table.admittedAt),
    index("admissions_expiry").on(table.expiresAt),
  ],
);

/** The chat's global spend per UTC day or month, in millionths of a US dollar. */
export const spendWindows = chatSchema.table(
  "spend_windows",
  {
    kind: text("kind").notNull(),
    startsOn: date("starts_on").notNull(),
    committedMicroUsd: bigint("committed_micro_usd", { mode: "number" }).notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.kind, table.startsOn] }),
    check("spend_windows_kind_known", sql`${table.kind} IN ('day', 'month')`),
    check("spend_windows_committed_nonnegative", sql`${table.committedMicroUsd} >= 0`),
  ],
);

/**
 * What an operation reserved in each window. No reference to the operation, so the accounting
 * survives its deletion. `uncertain` keeps the full reservation.
 */
export const spendReservations = chatSchema.table(
  "spend_reservations",
  {
    operationId: uuid("operation_id").notNull(),
    kind: text("kind").notNull(),
    startsOn: date("starts_on").notNull(),
    amountMicroUsd: bigint("amount_micro_usd", { mode: "number" }).notNull(),
    state: text("state").notNull(),
    reservedAt: at("reserved_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.operationId, table.kind, table.startsOn] }),
    check(
      "spend_reservations_state_known",
      sql`${table.state} IN ('reserved', 'settled', 'released', 'uncertain')`,
    ),
  ],
);

/** A retention run's record: when and how many conversations it deleted; no content. */
export const deletions = chatSchema.table("deletions", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  deletedAt: at("deleted_at").notNull(),
  conversations: integer("conversations").notNull(),
});
