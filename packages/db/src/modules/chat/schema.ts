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

/** The one conversation of an identity; `revision` grows with each completed exchange. */
export const conversations = chatSchema.table("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  identityId: uuid("identity_id")
    .notNull()
    .unique()
    .references(() => identities.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull().default(0),
  createdAt: at("created_at").notNull(),
  lastActivityAt: at("last_activity_at").notNull(),
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
  },
  (table) => [
    index("messages_conversation_position").on(table.conversationId, table.position),
    check("messages_role_known", sql`${table.role} IN ('user', 'assistant')`),
    check(
      "messages_status_known",
      sql`${table.status} IN ('pending', 'completed', 'failed', 'interrupted')`,
    ),
    check(
      "messages_user_has_text",
      sql`${table.role} <> 'user' OR (${table.text} IS NOT NULL AND ${table.status} = 'completed')`,
    ),
  ],
);

/**
 * One admitted question: bound to its identity, conversation, request id and canonical question,
 * with its absolute deadline, the bound model, pricing and allowance, and — after reconciling —
 * the non-content usage accounting. At most one is active per identity.
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
    questionHash: text("question_hash").notNull(),
    userMessageId: uuid("user_message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    assistantMessageId: uuid("assistant_message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    admittedAt: at("admitted_at").notNull(),
    deadlineAt: at("deadline_at").notNull(),
    finishedAt: at("finished_at"),
    model: text("model").notNull(),
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
  },
  (table) => [
    unique("operations_identity_request").on(table.identityId, table.requestId),
    uniqueIndex("operations_one_active_per_identity")
      .on(table.identityId)
      .where(sql`${table.status} IN ('accepted', 'running')`),
    index("operations_active_deadline")
      .on(table.deadlineAt)
      .where(sql`${table.status} IN ('accepted', 'running')`),
    check(
      "operations_status_known",
      sql`${table.status} IN ('accepted', 'running', 'completed', 'failed', 'interrupted')`,
    ),
    check("operations_allowance_positive", sql`${table.allowanceMicroUsd} > 0`),
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

/** A redeemed bot-challenge token (its SHA-256 hash), bound to the one operation it admitted. */
export const challengeRedemptions = chatSchema.table("challenge_redemptions", {
  /** The SHA-256 digest of the token; the token itself is never stored. */
  digest: text("digest").primaryKey(),
  operationId: uuid("operation_id")
    .notNull()
    .references(() => operations.id, { onDelete: "cascade" }),
  redeemedAt: at("redeemed_at").notNull(),
});

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

/** One admitted question for the quotas: the identity and the keyed address fingerprint. */
export const admissions = chatSchema.table(
  "admissions",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    identityId: uuid("identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    fingerprint: text("fingerprint").notNull(),
    admittedAt: at("admitted_at").notNull(),
    expiresAt: at("expires_at").notNull(),
  },
  (table) => [
    index("admissions_identity").on(table.identityId, table.admittedAt),
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
