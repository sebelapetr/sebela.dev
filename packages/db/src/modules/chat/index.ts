import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import type { Database } from "../../database.js";
import {
  admissions,
  challengeRedemptions,
  conversations,
  deletions,
  grants,
  identities,
  messages,
  operations,
  operationTombstones,
  requestClaims,
  spendReservations,
  spendWindows,
  telemetryDeletions,
  telemetryReferences,
} from "./schema.js";

/** The UTC window a spend reservation counts in. */
export type ChatSpendKind = "day" | "month";

export type ChatOperationState =
  "accepted" | "running" | "completed" | "failed" | "interrupted" | "cancelled";

export type ChatMessageState = "pending" | "completed" | "failed" | "interrupted" | "cancelled";

/** An identity's single conversation. */
export interface ChatConversationRecord {
  id: string;
  /** Grows by one with each completed exchange; binds a generation to the context it saw. */
  revision: number;
  lastActivityAt: Date;
}

/** The caller resolved from its cookie verifier. */
export interface ChatIdentityRecord {
  identityId: string;
  conversation: ChatConversationRecord;
}

/** A stored message; content columns are validated by the services before and after. */
export interface ChatMessageRecord {
  id: string;
  role: "user" | "assistant";
  requestId: string;
  status: ChatMessageState;
  text: string | null;
  outcome: string | null;
  errorCode: string | null;
  errorRetryable: boolean | null;
  language: string | null;
  blocks: unknown[];
  sources: unknown[];
  related: unknown[];
  createdAt: Date;
  /** The model and effort the answer's operation was admitted with; `null` on a question. */
  model: string | null;
  effort: string | null;
}

export interface ChatOperationRecord {
  id: string;
  conversationId: string;
  requestId: string;
  questionHash: string;
  /** What the operation does; a compaction has no question and no answer message. */
  kind: ChatOperationKind;
  /** The question an answer asks; `null` for a compaction. */
  userMessageId: string | null;
  /** The answer an answer fills; `null` for a compaction. */
  assistantMessageId: string | null;
  status: ChatOperationState;
  admittedAt: Date;
  deadlineAt: Date;
  model: string;
  /** The main-call effort it was admitted with; `null` for an operation stored before effort was. */
  effort: string | null;
  pricingVersion: string;
  allowanceMicroUsd: number;
  contextRevision: number;
  /** The attempt this one retries, or `null` for the first attempt of its request. */
  retryOf: string | null;
  /** How a compaction ended once its result was stored; `null` for an answer and before. */
  compaction: { outcome: ChatCompactionOutcome; reason: string | null } | null;
}

/** An answer of one question, or a compaction of the working context. */
export type ChatOperationKind = "answer" | "compaction";

/** How a stored compaction ended: only `compacted` installed a summary. */
export type ChatCompactionOutcome = "compacted" | "unchanged" | "failed";

/** One quota: at most `limit` admissions of the scope since `since`. */
export interface ChatQuotaRule {
  scope: "identity" | "fingerprint";
  since: Date;
  limit: number;
  /** When a fixed window resets; `null` for a rolling window (its oldest admission ages out). */
  resetsAt: Date | null;
}

/** One global spend window the reservation must fit in. */
export interface ChatSpendWindow {
  kind: ChatSpendKind;
  /** The window's first UTC day, `YYYY-MM-DD`. */
  startsOn: string;
  limitMicroUsd: number;
}

/** Everything one admission decides atomically; the services compute every value. */
export interface ChatAdmissionInput {
  identityId: string;
  conversationId: string;
  requestId: string;
  question: string;
  questionHash: string;
  challengeTokenHash: string;
  fingerprint: string;
  at: Date;
  deadlineAt: Date;
  grantVerifier: string;
  model: string;
  effort: string;
  pricingVersion: string;
  allowanceMicroUsd: number;
  quotas: readonly ChatQuotaRule[];
  /** When the admission's quota row (with its fingerprint) may be purged. */
  admissionExpiresAt: Date;
  /** Every window the attempt touches; the allowance is reserved in each one. */
  spend: readonly ChatSpendWindow[];
}

export type ChatAdmissionResult =
  | { status: "admitted"; operation: ChatOperationRecord }
  /** The identity already used this request id; `sameQuestion` tells a recovery from a conflict. */
  | { status: "duplicate"; operation: ChatOperationRecord; sameQuestion: boolean }
  | { status: "busy"; operation: ChatOperationRecord }
  | { status: "challenge_reused" }
  | { status: "quota_exceeded"; scope: ChatQuotaRule["scope"]; retryAt: Date }
  | { status: "budget_exhausted" };

/**
 * A short-lived claim on one request of an identity, taken before its challenge token is verified,
 * so concurrent equal submissions redeem the token once. Holds the digests only.
 */
export interface ChatRequestClaimInput {
  identityId: string;
  requestId: string;
  questionHash: string;
  challengeTokenHash: string;
  at: Date;
  /** When the claim lapses and another submission may take it over. */
  expiresAt: Date;
}

/** `pending` while the holder verifies; then whether its verification passed. */
export type ChatRequestClaimState = "pending" | "verified" | "failed";

export type ChatRequestClaimResult =
  | { status: "claimed" }
  /** An unexpired claim exists: its state, and whether it names the same question and token. */
  | {
      status: "held";
      state: ChatRequestClaimState;
      sameQuestion: boolean;
      sameToken: boolean;
    };

/** How many expired admissions and request claims one admission deletes, at most, of each. */
export const chatPruneBatch = 50;

/** A completed answered exchange, for the bounded history the AI service receives. */
export interface ChatExchangeRecord {
  question: string;
  answer: string;
  language: string | null;
  sources: unknown[];
}

/**
 * A conversation's working context: the installed summary (validated by the services before it is
 * stored and after it is read) and the latest answered exchanges after it, oldest first.
 */
export interface ChatWorkingContextRecord {
  revision: number;
  summary: unknown;
  exchanges: ChatExchangeRecord[];
}

/** One compaction's admission: the same gates as a question, but no message is appended. */
export type ChatCompactionAdmissionInput = Omit<ChatAdmissionInput, "question"> & {
  /** Fewer working-context exchanges than this is nothing to compact; nothing is admitted. */
  minimumExchanges: number;
  /** How many of the latest exchanges the working context holds at most. */
  exchangeLimit: number;
};

export type ChatCompactionAdmissionResult =
  /** The admitted compaction and the working context it compacts, read under the same lock. */
  | { status: "admitted"; operation: ChatOperationRecord; context: ChatWorkingContextRecord }
  | { status: "nothing_to_compact" }
  | Exclude<ChatAdmissionResult, { status: "admitted" }>;

/** The validated result of a compaction, as the services decided to store it. */
export interface ChatCompactionRecord {
  outcome: ChatCompactionOutcome;
  reason: string | null;
  /** The new summary; only a `compacted` result has one. */
  summary: unknown;
  /** How many of the compacted exchanges, newest first, stay verbatim after the summary. */
  kept: number;
  summaryTokens: number;
  /** The estimate of the working context after the compaction; `null` when not measured. */
  nextInputTokens: number | null;
  /** The reported cost; `null` when it is uncertain, which keeps the full reservation. */
  costMicroUsd: number | null;
  inputTokens: number;
  outputTokens: number;
  modelAttempts: number;
  latencyMs: number;
  versions: Record<string, string>;
  /** The working context's exchange limit the compaction was dispatched with. */
  exchangeLimit: number;
}

export type ChatClaimResult =
  | { status: "claimed"; operation: ChatOperationRecord }
  /** Already claimed, expired or no longer accepted. */
  | { status: "refused" }
  /** No such operation, or another grant. */
  | { status: "wrong_grant" };

/** The approved, mapped result of a generation, as the services decided to store it. */
export interface ChatResultRecord {
  status: "completed" | "failed";
  outcome: string | null;
  errorCode: string | null;
  errorRetryable: boolean | null;
  text: string | null;
  language: string | null;
  blocks: unknown[];
  sources: unknown[];
  related: unknown[];
  /** The generation outcome and reason as the AI service reported them. */
  resultOutcome: string;
  resultReason: string | null;
  /** The reported cost; `null` when it is uncertain, which keeps the full reservation. */
  costMicroUsd: number | null;
  inputTokens: number;
  outputTokens: number;
  modelAttempts: number;
  latencyMs: number;
  versions: Record<string, string>;
  /** The last main call's measured input against its cap; `null` when none was measured. */
  context: ChatContextMeasurement | null;
  /** Whether the exchange becomes context for later questions. */
  advancesRevision: boolean;
}

/** The serialized input of one main model call, measured against the cap it was sent under. */
export interface ChatContextMeasurement {
  /** The tokenizer estimate made before the call. */
  estimatedInputTokens: number;
  /** The input tokens the provider reported for the call; `null` when it reported none. */
  reportedInputTokens: number | null;
  capTokens: number;
}

/** What one usage read counts, all decided by the services. */
export interface ChatUsageInput {
  identityId: string;
  conversationId: string;
  fingerprint: string;
  at: Date;
  quotas: readonly ChatQuotaRule[];
  /** The windows an admission at `at` would reserve in. */
  spend: readonly ChatSpendWindow[];
  allowanceMicroUsd: number;
}

/** One quota as an admission at the read's time would count it. */
export interface ChatQuotaUsage {
  used: number;
  /** When it has room again; `null` while it has room. */
  retryAt: Date | null;
  /**
   * When the oldest counted admission ages out of a rolling window, or a fixed window resets;
   * `null` when nothing is counted.
   */
  nextReleaseAt: Date | null;
}

/** One consistent snapshot of an identity's limits; no spend amount leaves it. */
export interface ChatUsageRecord {
  /** In the order of the input's quotas. */
  quotas: ChatQuotaUsage[];
  /** Whether another allowance fits each spend window, in the input's order. */
  spendRoom: boolean[];
  activeOperation: ChatOperationRecord | null;
  /** The conversation's latest measured main call, with its operation and when it finished. */
  context: (ChatContextMeasurement & { operationId: string; measuredAt: Date }) | null;
  /**
   * The history estimate of the installed compaction, when it is the conversation's latest
   * measured operation; `null` otherwise.
   */
  nextRequest: { operationId: string; measuredAt: Date; historyTokens: number } | null;
}

export type ChatReconcileResult =
  | { status: "reconciled"; operation: ChatOperationRecord }
  | { status: "already"; operation: ChatOperationRecord }
  /** The operation's conversation was cleared; at most its measured cost was settled. */
  | { status: "deleted" }
  | { status: "not_claimed" }
  | { status: "wrong_grant" };

/**
 * An explicit retry of one failed attempt: the same gates as an admission, keyed by its own
 * `retryId`, for the attempt `operationId` of the identity's conversation.
 */
export type ChatRetryInput = Omit<ChatAdmissionInput, "requestId" | "question" | "questionHash"> & {
  operationId: string;
  retryId: string;
};

export type ChatRetryResult =
  /** The new attempt and the question it asks again. */
  | { status: "admitted"; operation: ChatOperationRecord; question: string }
  /** `retryId` was already used; `sameTarget` tells a recovery from a conflict. */
  | { status: "duplicate"; operation: ChatOperationRecord; sameTarget: boolean }
  /** The request's latest attempt is active or completed: recovered, never generated again. */
  | { status: "recovered"; operation: ChatOperationRecord }
  | { status: "not_found" }
  /** Not a retryable failure of the conversation's latest question. */
  | { status: "not_retryable" }
  | { status: "busy"; operation: ChatOperationRecord }
  | { status: "challenge_reused" }
  | { status: "quota_exceeded"; scope: ChatQuotaRule["scope"]; retryAt: Date }
  | { status: "budget_exhausted" };

export type ChatStopResult =
  /** `claimed` tells whether a generation may be running and so must be told to stop. */
  | { status: "stopped"; operation: ChatOperationRecord; claimed: boolean }
  /** It had already ended; returned as it is. */
  | { status: "finished"; operation: ChatOperationRecord };

export interface ChatClearInput {
  identityId: string;
  /** The conversation the visitor confirmed clearing; another one clears nothing. */
  conversationId: string;
  at: Date;
  /** The error a cancelled active answer ends with. */
  error: ChatStoredError;
  /** How long a deleted operation's tombstone refuses and settles late results. */
  tombstoneExpiresAt: Date;
}

export type ChatClearResult =
  | {
      status: "cleared";
      /** The fresh empty conversation of the same identity. */
      conversation: ChatConversationRecord;
      /** The operations that were active and were cancelled. */
      cancelled: string[];
      /** How many telemetry references were handed over for remote deletion. */
      telemetryPending: number;
    }
  | { status: "mismatch" };

/** A telemetry trace recorded for a conversation, so deleting it can delete the export too. */
export interface ChatTelemetryReferenceInput {
  traceId: string;
  conversationId: string;
  operationId: string | null;
  at: Date;
}

/** A remote telemetry deletion still to be done. */
export interface ChatTelemetryDeletion {
  traceId: string;
  requestedAt: Date;
  attempts: number;
}

/** A visitor's message error, as stored. */
export interface ChatStoredError {
  code: string;
  retryable: boolean;
}

/**
 * Persistence of the visitor chat in its private `chat` schema. Every read is scoped by the
 * identity or its conversation; nothing is looked up by an identifier a visitor supplies alone.
 */
export interface ChatPersistence {
  /** The identity with this cookie verifier and its conversation, marked seen; `null` if none. */
  resolveIdentity(verifier: string, at: Date): Promise<ChatIdentityRecord | null>;
  /** A new identity and its empty conversation. */
  createIdentity(verifier: string, at: Date): Promise<ChatIdentityRecord>;
  /**
   * One page of a conversation, oldest first: the newest `limit` messages, or those before the
   * message `before` of this conversation. A cursor from elsewhere gives an empty page.
   */
  listMessages(
    conversationId: string,
    page: { before?: string; limit: number },
  ): Promise<{ messages: ChatMessageRecord[]; hasMore: boolean }>;
  /**
   * The identity's operation and its assistant message (`null` for a compaction); `null` for
   * another identity's.
   */
  findOperation(
    identityId: string,
    operationId: string,
  ): Promise<{ operation: ChatOperationRecord; assistant: ChatMessageRecord | null } | null>;
  findActiveOperation(identityId: string): Promise<ChatOperationRecord | null>;
  findOperationByRequest(
    identityId: string,
    requestId: string,
  ): Promise<ChatOperationRecord | null>;
  /**
   * The conversation's working context: its installed summary and at most `limit` of the latest
   * completed answered exchanges after the summary, oldest first. Stored history is never cut.
   */
  workingContext(conversationId: string, limit: number): Promise<ChatWorkingContextRecord>;
  /**
   * Admits one compaction atomically, under the same per-identity lock and gates as a question:
   * the request id is unused, no operation is active, the working context has at least
   * `minimumExchanges` exchanges, then the challenge, quotas and spend. Creates the `accepted`
   * compaction with its grant and no message. Any refusal changes nothing.
   */
  admitCompaction(input: ChatCompactionAdmissionInput): Promise<ChatCompactionAdmissionResult>;
  /**
   * Stores the result of a claimed compaction once and settles its spend like `reconcile`. A
   * `compacted` result installs its summary only while the conversation is still at the
   * operation's context revision, then advances the revision; any other result, or a stale one,
   * keeps the prior working context and is stored as `unchanged` with reason `stale`. No message
   * is ever deleted. A cleared conversation's compaction settles only a measured cost.
   */
  reconcileCompaction(
    operationId: string,
    verifier: string,
    at: Date,
    result: ChatCompactionRecord,
  ): Promise<ChatReconcileResult>;
  /**
   * Admits one question atomically, serialised per identity and per fingerprint: the request id
   * is unused, no operation is active, the challenge token is unredeemed, every quota has room and
   * the allowance fits every spend window. Then appends the question and a pending answer, creates
   * the `accepted` operation with its grant, binds the token and records the admission. Any
   * refusal changes nothing.
   */
  admit(input: ChatAdmissionInput): Promise<ChatAdmissionResult>;
  /**
   * Claims a request atomically before its challenge is verified: `claimed` when no unexpired
   * claim exists (an expired one is taken over), otherwise what the holding claim says.
   */
  claimRequest(input: ChatRequestClaimInput): Promise<ChatRequestClaimResult>;
  /** Records the holder's verification on its pending claim; a settled claim stays as it is. */
  settleRequestClaim(
    claim: Pick<ChatRequestClaimInput, "identityId" | "requestId" | "challengeTokenHash">,
    state: "verified" | "failed",
  ): Promise<void>;
  /** Claims the grant once while it is unexpired and the operation `accepted`; moves it to `running`. */
  claimGrant(operationId: string, verifier: string, at: Date): Promise<ChatClaimResult>;
  /**
   * Stores the result of a claimed operation once and settles its spend: a known cost replaces
   * the reservations in the admission's windows; an uncertain one keeps them. A repeat changes
   * nothing.
   */
  reconcile(
    operationId: string,
    verifier: string,
    at: Date,
    result: ChatResultRecord,
  ): Promise<ChatReconcileResult>;
  /**
   * Fails an operation whose grant was never claimed (the dispatch was refused) and releases its
   * reservations. `false` when it was claimed or is no longer `accepted`.
   */
  failUnclaimed(operationId: string, at: Date, error: ChatStoredError): Promise<boolean>;
  /**
   * Interrupts every active operation whose deadline is before `cutoff`: a claimed one keeps its
   * reservations as uncertain, an unclaimed one releases them. Returns the interrupted ids.
   */
  interruptOverdue(cutoff: Date, at: Date, error: ChatStoredError): Promise<string[]>;
  /**
   * Deletes at most `limit` identities last seen before `cutoff` with their conversations, and
   * purges expired admissions and request claims; records the run. Spend accounting stays. Returns how many
   * conversations it deleted.
   */
  deleteInactive(cutoff: Date, at: Date, limit: number): Promise<number>;
  /** The identity's attempt with this request id or retry id; `null` when none. */
  findOperationByAttempt(
    identityId: string,
    attemptKey: string,
  ): Promise<ChatOperationRecord | null>;
  /**
   * Retries a failed attempt atomically, serialised per identity: recovers a used `retryId`, or
   * the request's active or completed attempt; otherwise only a retryable failure of the latest
   * question passes the admission gates. Then supersedes the failed answer with a pending one and
   * creates the new `accepted` attempt of the same request. Any refusal changes nothing.
   */
  retry(input: ChatRetryInput): Promise<ChatRetryResult>;
  /**
   * Stops the identity's active operation: it and its answer end `cancelled`; a claimed one keeps
   * its reservations as uncertain, an unclaimed one releases them. `null` for another identity's.
   */
  stop(
    identityId: string,
    operationId: string,
    at: Date,
    error: ChatStoredError,
  ): Promise<ChatStopResult | null>;
  /**
   * Clears the identity's conversation atomically: cancels active work, tombstones operations that
   * may still report, hands its telemetry references to pending deletion, deletes the
   * conversation with its messages and starts a fresh one. Quotas, spend and redeemed challenge
   * tokens stay.
   */
  clear(input: ChatClearInput): Promise<ChatClearResult>;
  /**
   * Records a telemetry trace of a conversation; one of a deleted conversation or operation goes
   * straight to pending deletion.
   */
  recordTelemetryReference(
    input: ChatTelemetryReferenceInput,
  ): Promise<"recorded" | "deletion_pending">;
  /** The oldest pending remote telemetry deletions, at most `limit`. */
  pendingTelemetryDeletions(limit: number): Promise<ChatTelemetryDeletion[]>;
  /** Records a remote deletion's outcome: `completed` ends it, `failed` keeps it pending. */
  settleTelemetryDeletion(
    traceId: string,
    outcome: "completed" | "failed",
    at: Date,
  ): Promise<void>;
  /**
   * Reads an identity's quotas, the room of the spend windows, its active operation and its
   * conversation's last context measurement in one read-only snapshot; changes nothing.
   */
  usage(input: ChatUsageInput): Promise<ChatUsageRecord>;
  /** The committed spend of one window in millionths of a US dollar; 0 when it has none. */
  committedSpend(kind: ChatSpendKind, startsOn: string): Promise<number>;
}

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type OperationRow = typeof operations.$inferSelect;
type MessageRow = typeof messages.$inferSelect;

const active = ["accepted", "running"] as const;
const terminal = new Set<string>(["completed", "failed", "interrupted", "cancelled"]);
/** Ended without a result, so a late result of a claimed one may still settle its cost. */
const unreported = new Set<string>(["interrupted", "cancelled"]);
const retryable = new Set<string>(["failed", "interrupted", "cancelled"]);

/** Ends an admission transaction with a refusal, rolling back whatever it wrote. */
class Refusal extends Error {
  constructor(readonly result: GateRefusal) {
    super(result.status);
  }
}

/** A refusal an admission and a retry share. */
type GateRefusal = Extract<
  ChatAdmissionResult,
  { status: "challenge_reused" | "quota_exceeded" | "budget_exhausted" }
>;

/** What an admission and a retry both decide and record. */
type GateInput = Omit<ChatAdmissionInput, "requestId" | "question" | "questionHash">;

/**
 * Counts one quota's admissions of the identity or the fingerprint as an admission at `at` would:
 * a rolling window after its start, a fixed one from its start. A full quota has room again when
 * enough of its oldest admissions age out of a rolling window, or when a fixed one resets.
 */
async function countQuota(
  tx: Transaction,
  owner: { identityId: string; fingerprint: string; at: Date },
  quota: ChatQuotaRule,
): Promise<ChatQuotaUsage> {
  const whose =
    quota.scope === "identity"
      ? eq(admissions.identityId, owner.identityId)
      : eq(admissions.fingerprint, owner.fingerprint);
  const window =
    quota.resetsAt === null
      ? gt(admissions.admittedAt, quota.since)
      : gte(admissions.admittedAt, quota.since);
  const counted = await tx
    .select({ admittedAt: admissions.admittedAt })
    .from(admissions)
    .where(and(whose, window))
    .orderBy(asc(admissions.admittedAt));
  const span = owner.at.getTime() - quota.since.getTime();
  const ageingOut = (index: number) => {
    const admittedAt = counted[index]?.admittedAt ?? owner.at;
    return quota.resetsAt ?? new Date(admittedAt.getTime() + span);
  };
  return {
    used: counted.length,
    retryAt: counted.length < quota.limit ? null : ageingOut(counted.length - quota.limit),
    nextReleaseAt: counted.length === 0 ? null : ageingOut(0),
  };
}

/**
 * Passes the gates an admission and a retry share, in the identity's locked transaction: the
 * challenge token is unredeemed, every quota has room and the allowance fits every spend window,
 * which it reserves. Throws a `Refusal` otherwise, rolling the transaction back. Returns the
 * windows in their locking order.
 */
async function passGates(tx: Transaction, input: GateInput) {
  const [redeemed] = await tx
    .select({ digest: challengeRedemptions.digest })
    .from(challengeRedemptions)
    .where(eq(challengeRedemptions.digest, input.challengeTokenHash));
  if (redeemed !== undefined) throw new Refusal({ status: "challenge_reused" });

  // Serialise the admissions of one fingerprint across identities while its quota is counted.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.fingerprint}, 0))`);
  for (const quota of input.quotas) {
    const { retryAt } = await countQuota(tx, input, quota);
    if (retryAt !== null) {
      throw new Refusal({ status: "quota_exceeded", scope: quota.scope, retryAt });
    }
  }

  // Reserve in a fixed order, so concurrent admissions lock the windows without deadlocking.
  const windows = [...input.spend].sort((a, b) =>
    a.kind === b.kind ? a.startsOn.localeCompare(b.startsOn) : a.kind.localeCompare(b.kind),
  );
  for (const window of windows) {
    await tx
      .insert(spendWindows)
      .values({ kind: window.kind, startsOn: window.startsOn })
      .onConflictDoNothing();
    const reserved = await tx
      .update(spendWindows)
      .set({
        committedMicroUsd: sql`${spendWindows.committedMicroUsd} + ${input.allowanceMicroUsd}`,
      })
      .where(
        and(
          eq(spendWindows.kind, window.kind),
          eq(spendWindows.startsOn, window.startsOn),
          sql`${spendWindows.committedMicroUsd} + ${input.allowanceMicroUsd} <= ${window.limitMicroUsd}`,
        ),
      )
      .returning({ kind: spendWindows.kind });
    if (reserved.length === 0) throw new Refusal({ status: "budget_exhausted" });
  }
  return windows;
}

/**
 * Records what an admitted attempt holds: binds the challenge token, issues the grant, stores the
 * reservations and the quota admission, and marks the conversation and identity active.
 */
async function recordAdmission(
  tx: Transaction,
  input: GateInput,
  operationId: string,
  windows: readonly ChatSpendWindow[],
) {
  // A token redeemed concurrently elsewhere waits on its key, then conflicts and refuses here.
  const bound = await tx
    .insert(challengeRedemptions)
    .values({
      digest: input.challengeTokenHash,
      operationId,
      redeemedAt: input.at,
      expiresAt: input.admissionExpiresAt,
    })
    .onConflictDoNothing()
    .returning({ digest: challengeRedemptions.digest });
  if (bound.length === 0) throw new Refusal({ status: "challenge_reused" });
  await tx.insert(grants).values({
    operationId,
    verifier: input.grantVerifier,
    expiresAt: input.deadlineAt,
  });
  if (windows.length > 0) {
    await tx.insert(spendReservations).values(
      windows.map((window) => ({
        operationId,
        kind: window.kind,
        startsOn: window.startsOn,
        amountMicroUsd: input.allowanceMicroUsd,
        state: "reserved",
        reservedAt: input.at,
      })),
    );
  }
  await tx.insert(admissions).values({
    identityId: input.identityId,
    fingerprint: input.fingerprint,
    operationId,
    admittedAt: input.at,
    expiresAt: input.admissionExpiresAt,
  });
  await tx
    .update(conversations)
    .set({ lastActivityAt: input.at })
    .where(eq(conversations.id, input.conversationId));
  await tx
    .update(identities)
    .set({ lastSeenAt: input.at })
    .where(eq(identities.id, input.identityId));
}

/**
 * The attempts of an identity's request or with this attempt key, latest first: a later attempt's
 * answer always comes after an earlier one's.
 */
async function attemptsOf(
  tx: Transaction | Database,
  identityId: string,
  where: SQL | undefined,
): Promise<OperationRow[]> {
  const rows = await tx
    .select({ operation: operations })
    .from(operations)
    .innerJoin(messages, eq(messages.id, operations.assistantMessageId))
    .where(and(eq(operations.identityId, identityId), where))
    .orderBy(desc(messages.position));
  return rows.map((row) => row.operation);
}

function operationOf(row: OperationRow): ChatOperationRecord {
  return {
    id: row.id,
    conversationId: row.conversationId,
    requestId: row.requestId,
    questionHash: row.questionHash,
    kind: "answer",
    userMessageId: row.userMessageId,
    assistantMessageId: row.assistantMessageId,
    status: row.status as ChatOperationState,
    admittedAt: row.admittedAt,
    deadlineAt: row.deadlineAt,
    model: row.model,
    effort: row.effort,
    pricingVersion: row.pricingVersion,
    allowanceMicroUsd: row.allowanceMicroUsd,
    contextRevision: row.contextRevision,
    retryOf: row.retryOf,
    compaction: null,
  };
}

/** The main-call measurement an operation stored, with when it finished; `null` without one. */
function contextOf(row: OperationRow | undefined): ChatUsageRecord["context"] {
  if (
    row?.contextEstimatedInputTokens == null ||
    row.contextCapTokens === null ||
    row.finishedAt === null
  ) {
    return null;
  }
  return {
    operationId: row.id,
    measuredAt: row.finishedAt,
    estimatedInputTokens: row.contextEstimatedInputTokens,
    reportedInputTokens: row.contextReportedInputTokens,
    capTokens: row.contextCapTokens,
  };
}

/** A message with the model and effort of the operation that answers it, if any. */
function messageOf(
  row: MessageRow,
  answeredBy: { model: string; effort: string | null } | null = null,
): ChatMessageRecord {
  return {
    id: row.id,
    role: row.role as ChatMessageRecord["role"],
    requestId: row.requestId,
    status: row.status as ChatMessageState,
    text: row.text,
    outcome: row.outcome,
    errorCode: row.errorCode,
    errorRetryable: row.errorRetryable,
    language: row.language,
    blocks: row.blocks,
    sources: row.sources,
    related: row.related,
    createdAt: row.createdAt,
    model: answeredBy?.model ?? null,
    effort: answeredBy?.effort ?? null,
  };
}

/** Moves a window's committed spend by `delta` millionths of a US dollar. */
async function adjustWindow(tx: Transaction, kind: string, startsOn: string, delta: number) {
  if (delta === 0) return;
  await tx
    .update(spendWindows)
    .set({ committedMicroUsd: sql`${spendWindows.committedMicroUsd} + ${delta}` })
    .where(and(eq(spendWindows.kind, kind), eq(spendWindows.startsOn, startsOn)));
}

/** Gives back every reservation of an operation still held for its unknown cost. */
async function releaseReservations(tx: Transaction, operationId: string) {
  const reserved = await tx
    .update(spendReservations)
    .set({ state: "released" })
    .where(
      and(eq(spendReservations.operationId, operationId), eq(spendReservations.state, "reserved")),
    )
    .returning();
  for (const row of reserved) {
    await adjustWindow(tx, row.kind, row.startsOn, -row.amountMicroUsd);
  }
}

/** Stops counting the quota admission of an operation that never started any work. */
async function releaseAdmission(tx: Transaction, operationId: string) {
  await tx.delete(admissions).where(eq(admissions.operationId, operationId));
}

/** Keeps every open reservation of an operation in full, because its cost is unknown. */
async function retainReservations(tx: Transaction, operationId: string) {
  await tx
    .update(spendReservations)
    .set({ state: "uncertain" })
    .where(
      and(eq(spendReservations.operationId, operationId), eq(spendReservations.state, "reserved")),
    );
}

/**
 * Replaces an operation's open or uncertain reservations with its known cost: the cost counts in
 * the earliest window of each kind (the admission's day and month), every other reservation is
 * given back. Settled ones stay, so a repeated cost settles nothing.
 */
async function settleReservations(tx: Transaction, operationId: string, costMicroUsd: number) {
  const reserved = await tx
    .select()
    .from(spendReservations)
    .where(
      and(
        eq(spendReservations.operationId, operationId),
        inArray(spendReservations.state, ["reserved", "uncertain"]),
      ),
    )
    .orderBy(asc(spendReservations.startsOn));
  const settledKinds = new Set<string>();
  for (const row of reserved) {
    const settles = !settledKinds.has(row.kind);
    settledKinds.add(row.kind);
    const amount = settles ? costMicroUsd : 0;
    await adjustWindow(tx, row.kind, row.startsOn, amount - row.amountMicroUsd);
    await tx
      .update(spendReservations)
      .set({ state: settles ? "settled" : "released", amountMicroUsd: amount })
      .where(
        and(
          eq(spendReservations.operationId, operationId),
          eq(spendReservations.kind, row.kind),
          eq(spendReservations.startsOn, row.startsOn),
        ),
      );
  }
}

/** Ends an active operation and its pending answer with an error and no text. */
async function endWithError(
  tx: Transaction,
  row: OperationRow,
  status: "failed" | "interrupted" | "cancelled",
  at: Date,
  error: ChatStoredError,
  costUncertain: boolean,
) {
  await tx
    .update(operations)
    .set({ status, finishedAt: at, costUncertain })
    .where(eq(operations.id, row.id));
  await tx
    .update(messages)
    .set({ status, errorCode: error.code, errorRetryable: error.retryable })
    .where(eq(messages.id, row.assistantMessageId));
}

/** Ends an active operation as cancelled: a claimed one keeps its reservations as uncertain. */
async function cancelActive(tx: Transaction, row: OperationRow, at: Date, error: ChatStoredError) {
  const [grant] = await tx
    .select({ claimedAt: grants.claimedAt })
    .from(grants)
    .where(eq(grants.operationId, row.id));
  const claimed = grant !== undefined && grant.claimedAt !== null;
  await endWithError(tx, row, "cancelled", at, error, claimed);
  if (claimed) await retainReservations(tx, row.id);
  else await releaseReservations(tx, row.id);
  return claimed;
}

/**
 * Moves every telemetry reference of these conversations to pending remote deletion; returns how
 * many it moved.
 */
async function handOverTelemetry(tx: Transaction, conversationIds: readonly string[], at: Date) {
  if (conversationIds.length === 0) return 0;
  const moved = await tx
    .delete(telemetryReferences)
    .where(inArray(telemetryReferences.conversationId, [...conversationIds]))
    .returning({ traceId: telemetryReferences.traceId });
  if (moved.length > 0) {
    await tx
      .insert(telemetryDeletions)
      .values(moved.map((row) => ({ traceId: row.traceId, requestedAt: at })))
      .onConflictDoNothing();
  }
  return moved.length;
}

export function createChatPersistence(db: Database): ChatPersistence {
  const conversationOf = async (identityId: string): Promise<ChatConversationRecord> => {
    const [row] = await db
      .select({
        id: conversations.id,
        revision: conversations.revision,
        lastActivityAt: conversations.lastActivityAt,
      })
      .from(conversations)
      .where(eq(conversations.identityId, identityId));
    if (row === undefined) throw new Error("A chat identity has no conversation.");
    return row;
  };

  /** Locks an operation and checks the grant against it; `null` for no such operation or grant. */
  const lockWithGrant = async (tx: Transaction, operationId: string, verifier: string) => {
    const [row] = await tx
      .select()
      .from(operations)
      .where(eq(operations.id, operationId))
      .for("update");
    if (row === undefined) return null;
    const [grant] = await tx.select().from(grants).where(eq(grants.operationId, operationId));
    if (grant?.verifier !== verifier) return null;
    return { row, grant };
  };

  /**
   * Deletes up to `chatPruneBatch` expired admissions and as many expired request claims, rows a
   * concurrent admission holds skipped, so fingerprints do not outlive their quota windows.
   */
  const pruneExpired = async (at: Date) => {
    const now = at.toISOString();
    await db.execute(sql`
      DELETE FROM ${admissions} WHERE ${admissions.id} IN (
        SELECT ${admissions.id} FROM ${admissions}
        WHERE ${admissions.expiresAt} < ${now}::timestamptz
        ORDER BY ${admissions.expiresAt}
        LIMIT ${chatPruneBatch}
        FOR UPDATE SKIP LOCKED
      )`);
    await db.execute(sql`
      DELETE FROM ${requestClaims}
      WHERE (${requestClaims.identityId}, ${requestClaims.requestId}) IN (
        SELECT ${requestClaims.identityId}, ${requestClaims.requestId} FROM ${requestClaims}
        WHERE ${requestClaims.expiresAt} < ${now}::timestamptz
        ORDER BY ${requestClaims.expiresAt}
        LIMIT ${chatPruneBatch}
        FOR UPDATE SKIP LOCKED
      )`);
  };

  const admitWithin = async (
    tx: Transaction,
    input: ChatAdmissionInput,
  ): Promise<ChatAdmissionResult> => {
    // Serialise every admission of this identity on its row.
    const [identity] = await tx
      .select({ id: identities.id })
      .from(identities)
      .where(eq(identities.id, input.identityId))
      .for("update");
    const [conversation] = await tx
      .select({ id: conversations.id, revision: conversations.revision })
      .from(conversations)
      .where(
        and(
          eq(conversations.id, input.conversationId),
          eq(conversations.identityId, input.identityId),
        ),
      );
    if (identity === undefined || conversation === undefined) {
      throw new Error("The chat identity or its conversation does not exist.");
    }

    // A request id names its first attempt; a retry id of this identity cannot be reused as one.
    const [previous] = await attemptsOf(
      tx,
      input.identityId,
      or(eq(operations.requestId, input.requestId), eq(operations.attemptKey, input.requestId)),
    );
    if (previous !== undefined) {
      return {
        status: "duplicate",
        operation: operationOf(previous),
        sameQuestion:
          previous.requestId === input.requestId && previous.questionHash === input.questionHash,
      };
    }
    const [busy] = await tx
      .select()
      .from(operations)
      .where(and(eq(operations.identityId, input.identityId), inArray(operations.status, active)));
    if (busy !== undefined) return { status: "busy", operation: operationOf(busy) };

    const windows = await passGates(tx, input);

    const [question] = await tx
      .insert(messages)
      .values({
        conversationId: input.conversationId,
        role: "user",
        requestId: input.requestId,
        status: "completed",
        text: input.question,
        createdAt: input.at,
      })
      .returning({ id: messages.id });
    const [answer] = await tx
      .insert(messages)
      .values({
        conversationId: input.conversationId,
        role: "assistant",
        requestId: input.requestId,
        status: "pending",
        createdAt: input.at,
      })
      .returning({ id: messages.id });
    if (question === undefined || answer === undefined) throw new Error("No message was stored.");
    const [operation] = await tx
      .insert(operations)
      .values({
        identityId: input.identityId,
        conversationId: input.conversationId,
        requestId: input.requestId,
        attemptKey: input.requestId,
        questionHash: input.questionHash,
        userMessageId: question.id,
        assistantMessageId: answer.id,
        status: "accepted",
        admittedAt: input.at,
        deadlineAt: input.deadlineAt,
        model: input.model,
        effort: input.effort,
        pricingVersion: input.pricingVersion,
        allowanceMicroUsd: input.allowanceMicroUsd,
        contextRevision: conversation.revision,
      })
      .returning();
    if (operation === undefined) throw new Error("No operation was stored.");
    await recordAdmission(tx, input, operation.id, windows);
    return { status: "admitted", operation: operationOf(operation) };
  };

  const retryWithin = async (tx: Transaction, input: ChatRetryInput): Promise<ChatRetryResult> => {
    // Serialise with every admission of this identity on its row.
    const [identity] = await tx
      .select({ id: identities.id })
      .from(identities)
      .where(eq(identities.id, input.identityId))
      .for("update");
    const [conversation] = await tx
      .select({ id: conversations.id, revision: conversations.revision })
      .from(conversations)
      .where(
        and(
          eq(conversations.id, input.conversationId),
          eq(conversations.identityId, input.identityId),
        ),
      );
    if (identity === undefined || conversation === undefined) {
      throw new Error("The chat identity or its conversation does not exist.");
    }

    const [used] = await attemptsOf(
      tx,
      input.identityId,
      or(eq(operations.attemptKey, input.retryId), eq(operations.requestId, input.retryId)),
    );
    if (used !== undefined) {
      return {
        status: "duplicate",
        operation: operationOf(used),
        sameTarget: used.retryOf === input.operationId,
      };
    }
    const [target] = await tx
      .select()
      .from(operations)
      .where(
        and(
          eq(operations.id, input.operationId),
          eq(operations.identityId, input.identityId),
          eq(operations.conversationId, input.conversationId),
        ),
      );
    if (target === undefined) return { status: "not_found" };
    const [latest] = await attemptsOf(
      tx,
      input.identityId,
      eq(operations.requestId, target.requestId),
    );
    if (latest !== undefined && (latest.status === "completed" || !terminal.has(latest.status))) {
      return { status: "recovered", operation: operationOf(latest) };
    }
    const [answer] = await tx
      .select({ errorRetryable: messages.errorRetryable })
      .from(messages)
      .where(eq(messages.id, target.assistantMessageId));
    const [lastQuestion] = await tx
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.conversationId, input.conversationId), eq(messages.role, "user")))
      .orderBy(desc(messages.position))
      .limit(1);
    if (
      latest?.id !== target.id ||
      !retryable.has(target.status) ||
      answer?.errorRetryable !== true ||
      lastQuestion?.id !== target.userMessageId
    ) {
      return { status: "not_retryable" };
    }
    const [busy] = await tx
      .select()
      .from(operations)
      .where(and(eq(operations.identityId, input.identityId), inArray(operations.status, active)));
    if (busy !== undefined) return { status: "busy", operation: operationOf(busy) };

    const windows = await passGates(tx, input);

    const [question] = await tx
      .select({ text: messages.text })
      .from(messages)
      .where(eq(messages.id, target.userMessageId));
    if (question?.text == null) throw new Error("The retried question has no text.");
    const [pending] = await tx
      .insert(messages)
      .values({
        conversationId: input.conversationId,
        role: "assistant",
        requestId: target.requestId,
        status: "pending",
        createdAt: input.at,
      })
      .returning({ id: messages.id });
    if (pending === undefined) throw new Error("No message was stored.");
    await tx
      .update(messages)
      .set({ supersededAt: input.at })
      .where(eq(messages.id, target.assistantMessageId));
    const [operation] = await tx
      .insert(operations)
      .values({
        identityId: input.identityId,
        conversationId: input.conversationId,
        requestId: target.requestId,
        attemptKey: input.retryId,
        retryOf: target.id,
        questionHash: target.questionHash,
        userMessageId: target.userMessageId,
        assistantMessageId: pending.id,
        status: "accepted",
        admittedAt: input.at,
        deadlineAt: input.deadlineAt,
        model: input.model,
        effort: input.effort,
        pricingVersion: input.pricingVersion,
        allowanceMicroUsd: input.allowanceMicroUsd,
        contextRevision: conversation.revision,
      })
      .returning();
    if (operation === undefined) throw new Error("No operation was stored.");
    await recordAdmission(tx, input, operation.id, windows);
    return { status: "admitted", operation: operationOf(operation), question: question.text };
  };

  /** Runs a transaction that may end with a shared gate refusal. */
  const refusable = async <T>(work: (tx: Transaction) => Promise<T>): Promise<T | GateRefusal> => {
    try {
      return await db.transaction(work);
    } catch (error) {
      if (error instanceof Refusal) return error.result;
      throw error;
    }
  };

  return {
    async resolveIdentity(verifier, at) {
      const [identity] = await db
        .update(identities)
        .set({ lastSeenAt: at })
        .where(eq(identities.verifier, verifier))
        .returning({ id: identities.id });
      if (identity === undefined) return null;
      return { identityId: identity.id, conversation: await conversationOf(identity.id) };
    },

    async createIdentity(verifier, at) {
      return db.transaction(async (tx) => {
        const [identity] = await tx
          .insert(identities)
          .values({ verifier, createdAt: at, lastSeenAt: at })
          .returning({ id: identities.id });
        if (identity === undefined) throw new Error("No chat identity was stored.");
        const [conversation] = await tx
          .insert(conversations)
          .values({ identityId: identity.id, createdAt: at, lastActivityAt: at })
          .returning({
            id: conversations.id,
            revision: conversations.revision,
            lastActivityAt: conversations.lastActivityAt,
          });
        if (conversation === undefined) throw new Error("No chat conversation was stored.");
        return { identityId: identity.id, conversation };
      });
    },

    async listMessages(conversationId, page) {
      let bound: SQL | undefined;
      if (page.before !== undefined) {
        const [cursor] = await db
          .select({ position: messages.position })
          .from(messages)
          .where(and(eq(messages.id, page.before), eq(messages.conversationId, conversationId)));
        if (cursor === undefined) return { messages: [], hasMore: false };
        bound = lt(messages.position, cursor.position);
      }
      const rows = await db
        .select({ message: messages, model: operations.model, effort: operations.effort })
        .from(messages)
        .leftJoin(operations, eq(operations.assistantMessageId, messages.id))
        .where(
          and(eq(messages.conversationId, conversationId), isNull(messages.supersededAt), bound),
        )
        .orderBy(desc(messages.position))
        .limit(page.limit + 1);
      return {
        messages: rows
          .slice(0, page.limit)
          .reverse()
          .map((row) =>
            messageOf(
              row.message,
              row.model === null ? null : { model: row.model, effort: row.effort },
            ),
          ),
        hasMore: rows.length > page.limit,
      };
    },

    async findOperation(identityId, operationId) {
      const [row] = await db
        .select({ operation: operations, assistant: messages })
        .from(operations)
        .innerJoin(messages, eq(messages.id, operations.assistantMessageId))
        .where(and(eq(operations.id, operationId), eq(operations.identityId, identityId)));
      if (row === undefined) return null;
      return {
        operation: operationOf(row.operation),
        assistant: messageOf(row.assistant, row.operation),
      };
    },

    async findActiveOperation(identityId) {
      const [row] = await db
        .select()
        .from(operations)
        .where(and(eq(operations.identityId, identityId), inArray(operations.status, active)));
      return row === undefined ? null : operationOf(row);
    },

    async findOperationByRequest(identityId, requestId) {
      const [row] = await attemptsOf(db, identityId, eq(operations.requestId, requestId));
      return row === undefined ? null : operationOf(row);
    },

    async findOperationByAttempt(identityId, attemptKey) {
      const [row] = await attemptsOf(
        db,
        identityId,
        or(eq(operations.attemptKey, attemptKey), eq(operations.requestId, attemptKey)),
      );
      return row === undefined ? null : operationOf(row);
    },

    workingContext() {
      return Promise.reject(new Error("Not implemented."));
    },

    admitCompaction() {
      return Promise.reject(new Error("Not implemented."));
    },

    reconcileCompaction() {
      return Promise.reject(new Error("Not implemented."));
    },

    async admit(input) {
      await pruneExpired(input.at);
      return refusable((tx) => admitWithin(tx, input));
    },

    async claimRequest(input) {
      // A claim pruned between the insert and the read is simply claimed again.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const taken = await db
          .insert(requestClaims)
          .values({
            identityId: input.identityId,
            requestId: input.requestId,
            questionHash: input.questionHash,
            challengeDigest: input.challengeTokenHash,
            state: "pending",
            claimedAt: input.at,
            expiresAt: input.expiresAt,
          })
          .onConflictDoUpdate({
            target: [requestClaims.identityId, requestClaims.requestId],
            set: {
              questionHash: input.questionHash,
              challengeDigest: input.challengeTokenHash,
              state: "pending",
              claimedAt: input.at,
              expiresAt: input.expiresAt,
            },
            // Only a lapsed claim is taken over; the row lock makes one claimant win.
            setWhere: lte(requestClaims.expiresAt, input.at),
          })
          .returning({ state: requestClaims.state });
        if (taken.length > 0) return { status: "claimed" };
        const [held] = await db
          .select()
          .from(requestClaims)
          .where(
            and(
              eq(requestClaims.identityId, input.identityId),
              eq(requestClaims.requestId, input.requestId),
              gt(requestClaims.expiresAt, input.at),
            ),
          );
        if (held !== undefined) {
          return {
            status: "held",
            state: held.state as ChatRequestClaimState,
            sameQuestion: held.questionHash === input.questionHash,
            sameToken: held.challengeDigest === input.challengeTokenHash,
          };
        }
      }
      throw new Error("A chat request claim could not be taken or read.");
    },

    async settleRequestClaim(claim, state) {
      await db
        .update(requestClaims)
        .set({ state })
        .where(
          and(
            eq(requestClaims.identityId, claim.identityId),
            eq(requestClaims.requestId, claim.requestId),
            eq(requestClaims.challengeDigest, claim.challengeTokenHash),
            eq(requestClaims.state, "pending"),
          ),
        );
    },

    async claimGrant(operationId, verifier, at) {
      return db.transaction(async (tx): Promise<ChatClaimResult> => {
        const locked = await lockWithGrant(tx, operationId, verifier);
        if (locked === null) return { status: "wrong_grant" };
        const { row, grant } = locked;
        if (row.status !== "accepted" || grant.claimedAt !== null || grant.expiresAt <= at) {
          return { status: "refused" };
        }
        await tx
          .update(grants)
          .set({ claimedAt: at })
          .where(and(eq(grants.operationId, operationId), isNull(grants.claimedAt)));
        const [running] = await tx
          .update(operations)
          .set({ status: "running" })
          .where(eq(operations.id, operationId))
          .returning();
        if (running === undefined) throw new Error("The claimed operation disappeared.");
        return { status: "claimed", operation: operationOf(running) };
      });
    },

    async reconcile(operationId, verifier, at, result) {
      return db.transaction(async (tx): Promise<ChatReconcileResult> => {
        const locked = await lockWithGrant(tx, operationId, verifier);
        if (locked === null) {
          // A cleared conversation's operation: nothing is stored, only a measured cost settles.
          const [tombstone] = await tx
            .select()
            .from(operationTombstones)
            .where(eq(operationTombstones.operationId, operationId))
            .for("update");
          if (tombstone?.verifier !== verifier) return { status: "wrong_grant" };
          if (result.costMicroUsd !== null) {
            await settleReservations(tx, operationId, result.costMicroUsd);
          }
          return { status: "deleted" };
        }
        const { row, grant } = locked;
        if (terminal.has(row.status)) {
          // A stopped or interrupted generation that reports late settles its measured cost once.
          if (
            unreported.has(row.status) &&
            grant.claimedAt !== null &&
            row.costMicroUsd === null &&
            result.costMicroUsd !== null
          ) {
            await tx
              .update(operations)
              .set({
                resultOutcome: result.resultOutcome,
                resultReason: result.resultReason,
                costMicroUsd: result.costMicroUsd,
                costUncertain: false,
                inputTokens: result.inputTokens,
                outputTokens: result.outputTokens,
                modelAttempts: result.modelAttempts,
                latencyMs: result.latencyMs,
                versions: result.versions,
              })
              .where(eq(operations.id, operationId));
            await settleReservations(tx, operationId, result.costMicroUsd);
          }
          return { status: "already", operation: operationOf(row) };
        }
        if (grant.claimedAt === null) return { status: "not_claimed" };
        await tx
          .update(messages)
          .set({
            status: result.status,
            outcome: result.outcome,
            errorCode: result.errorCode,
            errorRetryable: result.errorRetryable,
            text: result.text,
            language: result.language,
            blocks: result.blocks,
            sources: result.sources,
            related: result.related,
          })
          .where(eq(messages.id, row.assistantMessageId));
        const [finished] = await tx
          .update(operations)
          .set({
            status: result.status,
            finishedAt: at,
            resultOutcome: result.resultOutcome,
            resultReason: result.resultReason,
            costMicroUsd: result.costMicroUsd,
            costUncertain: result.costMicroUsd === null,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            modelAttempts: result.modelAttempts,
            latencyMs: result.latencyMs,
            versions: result.versions,
            contextEstimatedInputTokens: result.context?.estimatedInputTokens ?? null,
            contextReportedInputTokens: result.context?.reportedInputTokens ?? null,
            contextCapTokens: result.context?.capTokens ?? null,
          })
          .where(eq(operations.id, operationId))
          .returning();
        if (finished === undefined) throw new Error("The reconciled operation disappeared.");
        if (result.costMicroUsd === null) await retainReservations(tx, operationId);
        else await settleReservations(tx, operationId, result.costMicroUsd);
        // A failure before any model call did no work, so it does not count against the quotas.
        if (result.status === "failed" && result.modelAttempts === 0 && result.costMicroUsd === 0) {
          await releaseAdmission(tx, operationId);
        }
        await tx
          .update(conversations)
          .set({
            lastActivityAt: at,
            ...(result.advancesRevision ? { revision: sql`${conversations.revision} + 1` } : {}),
          })
          .where(eq(conversations.id, row.conversationId));
        return { status: "reconciled", operation: operationOf(finished) };
      });
    },

    async failUnclaimed(operationId, at, error) {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(operations)
          .where(eq(operations.id, operationId))
          .for("update");
        if (row?.status !== "accepted") return false;
        const [grant] = await tx
          .select({ claimedAt: grants.claimedAt })
          .from(grants)
          .where(eq(grants.operationId, operationId));
        if (grant !== undefined && grant.claimedAt !== null) return false;
        await endWithError(tx, row, "failed", at, error, false);
        await releaseReservations(tx, operationId);
        await releaseAdmission(tx, operationId);
        return true;
      });
    },

    async interruptOverdue(cutoff, at, error) {
      return db.transaction(async (tx) => {
        const overdue = await tx
          .select()
          .from(operations)
          .where(and(inArray(operations.status, active), lt(operations.deadlineAt, cutoff)))
          .for("update", { skipLocked: true });
        for (const operation of overdue) {
          const [grant] = await tx
            .select({ claimedAt: grants.claimedAt })
            .from(grants)
            .where(eq(grants.operationId, operation.id));
          const claimed = grant !== undefined && grant.claimedAt !== null;
          await endWithError(tx, operation, "interrupted", at, error, claimed);
          if (claimed) await retainReservations(tx, operation.id);
          else {
            await releaseReservations(tx, operation.id);
            await releaseAdmission(tx, operation.id);
          }
        }
        return overdue.map((operation) => operation.id);
      });
    },

    async deleteInactive(cutoff, at, limit) {
      return db.transaction(async (tx) => {
        const expired = await tx
          .select({ id: identities.id })
          .from(identities)
          .where(lt(identities.lastSeenAt, cutoff))
          .orderBy(asc(identities.lastSeenAt))
          .limit(limit)
          .for("update", { skipLocked: true });
        const expiredIds = expired.map((row) => row.id);
        let deleted: { id: string }[] = [];
        if (expiredIds.length > 0) {
          // Lock the conversations so no telemetry reference is recorded after the hand-over.
          const owned = await tx
            .select({ id: conversations.id })
            .from(conversations)
            .where(inArray(conversations.identityId, expiredIds))
            .for("update");
          await handOverTelemetry(
            tx,
            owned.map((row) => row.id),
            at,
          );
          deleted = await tx
            .delete(identities)
            .where(inArray(identities.id, expiredIds))
            .returning({ id: identities.id });
        }
        await tx.delete(admissions).where(lt(admissions.expiresAt, at));
        await tx.delete(requestClaims).where(lt(requestClaims.expiresAt, at));
        await tx.delete(challengeRedemptions).where(lt(challengeRedemptions.expiresAt, at));
        await tx.delete(operationTombstones).where(lt(operationTombstones.expiresAt, at));
        await tx.insert(deletions).values({ deletedAt: at, conversations: deleted.length });
        return deleted.length;
      });
    },

    async retry(input) {
      await pruneExpired(input.at);
      return refusable((tx) => retryWithin(tx, input));
    },

    async stop(identityId, operationId, at, error) {
      return db.transaction(async (tx): Promise<ChatStopResult | null> => {
        const [row] = await tx
          .select()
          .from(operations)
          .where(and(eq(operations.id, operationId), eq(operations.identityId, identityId)))
          .for("update");
        if (row === undefined) return null;
        if (terminal.has(row.status)) return { status: "finished", operation: operationOf(row) };
        const claimed = await cancelActive(tx, row, at, error);
        return {
          status: "stopped",
          operation: { ...operationOf(row), status: "cancelled" },
          claimed,
        };
      });
    },

    async clear(input) {
      return db.transaction(async (tx): Promise<ChatClearResult> => {
        await tx
          .select({ id: identities.id })
          .from(identities)
          .where(eq(identities.id, input.identityId))
          .for("update");
        const [conversation] = await tx
          .select({ id: conversations.id })
          .from(conversations)
          .where(
            and(
              eq(conversations.id, input.conversationId),
              eq(conversations.identityId, input.identityId),
            ),
          )
          .for("update");
        if (conversation === undefined) return { status: "mismatch" };

        const running = await tx
          .select()
          .from(operations)
          .where(
            and(eq(operations.conversationId, conversation.id), inArray(operations.status, active)),
          )
          .for("update");
        for (const row of running) await cancelActive(tx, row, input.at, input.error);

        // A claimed generation that never reported may still do so; its tombstone answers it.
        const reporting = await tx
          .select({ operationId: operations.id, verifier: grants.verifier })
          .from(operations)
          .innerJoin(grants, eq(grants.operationId, operations.id))
          .where(
            and(
              eq(operations.conversationId, conversation.id),
              inArray(operations.status, [...unreported]),
              isNotNull(grants.claimedAt),
              isNull(operations.costMicroUsd),
            ),
          );
        if (reporting.length > 0) {
          await tx
            .insert(operationTombstones)
            .values(
              reporting.map((row) => ({
                operationId: row.operationId,
                verifier: row.verifier,
                deletedAt: input.at,
                expiresAt: input.tombstoneExpiresAt,
              })),
            )
            .onConflictDoNothing();
        }
        const telemetryPending = await handOverTelemetry(tx, [conversation.id], input.at);
        await tx.delete(conversations).where(eq(conversations.id, conversation.id));
        const [fresh] = await tx
          .insert(conversations)
          .values({ identityId: input.identityId, createdAt: input.at, lastActivityAt: input.at })
          .returning({
            id: conversations.id,
            revision: conversations.revision,
            lastActivityAt: conversations.lastActivityAt,
          });
        if (fresh === undefined) throw new Error("No chat conversation was stored.");
        await tx
          .update(identities)
          .set({ lastSeenAt: input.at })
          .where(eq(identities.id, input.identityId));
        return {
          status: "cleared",
          conversation: fresh,
          cancelled: running.map((row) => row.id),
          telemetryPending,
        };
      });
    },

    async recordTelemetryReference(input) {
      return db.transaction(async (tx) => {
        // A share lock keeps the conversation from being cleared until the reference is stored.
        const [conversation] = await tx
          .select({ id: conversations.id })
          .from(conversations)
          .where(eq(conversations.id, input.conversationId))
          .for("share");
        const tombstoned =
          input.operationId === null
            ? []
            : await tx
                .select({ operationId: operationTombstones.operationId })
                .from(operationTombstones)
                .where(eq(operationTombstones.operationId, input.operationId));
        if (conversation === undefined || tombstoned.length > 0) {
          await tx
            .insert(telemetryDeletions)
            .values({ traceId: input.traceId, requestedAt: input.at })
            .onConflictDoNothing();
          return "deletion_pending";
        }
        await tx
          .insert(telemetryReferences)
          .values({
            traceId: input.traceId,
            conversationId: input.conversationId,
            operationId: input.operationId,
            recordedAt: input.at,
          })
          .onConflictDoNothing();
        return "recorded";
      });
    },

    async pendingTelemetryDeletions(limit) {
      return db
        .select({
          traceId: telemetryDeletions.traceId,
          requestedAt: telemetryDeletions.requestedAt,
          attempts: telemetryDeletions.attempts,
        })
        .from(telemetryDeletions)
        .where(eq(telemetryDeletions.state, "pending"))
        .orderBy(asc(telemetryDeletions.requestedAt), asc(telemetryDeletions.traceId))
        .limit(limit);
    },

    async settleTelemetryDeletion(traceId, outcome, at) {
      const pending = and(
        eq(telemetryDeletions.traceId, traceId),
        eq(telemetryDeletions.state, "pending"),
      );
      if (outcome === "completed") {
        await db
          .update(telemetryDeletions)
          .set({ state: "completed", settledAt: at })
          .where(pending);
      } else {
        await db
          .update(telemetryDeletions)
          .set({ attempts: sql`${telemetryDeletions.attempts} + 1` })
          .where(pending);
      }
    },

    async usage(input) {
      return db.transaction(
        async (tx): Promise<ChatUsageRecord> => {
          const quotas: ChatQuotaUsage[] = [];
          for (const quota of input.quotas) quotas.push(await countQuota(tx, input, quota));
          const spendRoom: boolean[] = [];
          for (const window of input.spend) {
            const [row] = await tx
              .select({ committed: spendWindows.committedMicroUsd })
              .from(spendWindows)
              .where(
                and(eq(spendWindows.kind, window.kind), eq(spendWindows.startsOn, window.startsOn)),
              );
            spendRoom.push((row?.committed ?? 0) + input.allowanceMicroUsd <= window.limitMicroUsd);
          }
          const [running] = await tx
            .select()
            .from(operations)
            .where(
              and(eq(operations.identityId, input.identityId), inArray(operations.status, active)),
            )
            .orderBy(desc(operations.admittedAt))
            .limit(1);
          const [measured] = await tx
            .select()
            .from(operations)
            .where(
              and(
                eq(operations.identityId, input.identityId),
                eq(operations.conversationId, input.conversationId),
                isNotNull(operations.contextEstimatedInputTokens),
                isNotNull(operations.finishedAt),
              ),
            )
            .orderBy(desc(operations.finishedAt))
            .limit(1);
          return {
            quotas,
            spendRoom,
            activeOperation: running === undefined ? null : operationOf(running),
            context: contextOf(measured),
            nextRequest: null,
          };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    },

    async committedSpend(kind, startsOn) {
      const [row] = await db
        .select({ committed: spendWindows.committedMicroUsd })
        .from(spendWindows)
        .where(and(eq(spendWindows.kind, kind), eq(spendWindows.startsOn, startsOn)));
      return row?.committed ?? 0;
    },
  };
}
