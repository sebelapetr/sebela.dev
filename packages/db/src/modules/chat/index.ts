import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, sql, type SQL } from "drizzle-orm";

import { alias } from "drizzle-orm/pg-core";

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
  requestClaims,
  spendReservations,
  spendWindows,
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
}

export interface ChatOperationRecord {
  id: string;
  conversationId: string;
  requestId: string;
  questionHash: string;
  userMessageId: string;
  assistantMessageId: string;
  status: ChatOperationState;
  admittedAt: Date;
  deadlineAt: Date;
  model: string;
  pricingVersion: string;
  allowanceMicroUsd: number;
  contextRevision: number;
  /** The attempt this one retries, or `null` for the first attempt of its request. */
  retryOf: string | null;
}

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
  /** Whether the exchange becomes context for later questions. */
  advancesRevision: boolean;
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
  /** The identity's operation and its assistant message; `null` for another identity's. */
  findOperation(
    identityId: string,
    operationId: string,
  ): Promise<{ operation: ChatOperationRecord; assistant: ChatMessageRecord } | null>;
  findActiveOperation(identityId: string): Promise<ChatOperationRecord | null>;
  findOperationByRequest(
    identityId: string,
    requestId: string,
  ): Promise<ChatOperationRecord | null>;
  /** The latest completed answered exchanges, at most `limit`, oldest first. */
  recentExchanges(conversationId: string, limit: number): Promise<ChatExchangeRecord[]>;
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
  /** The committed spend of one window in millionths of a US dollar; 0 when it has none. */
  committedSpend(kind: ChatSpendKind, startsOn: string): Promise<number>;
}

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type OperationRow = typeof operations.$inferSelect;
type MessageRow = typeof messages.$inferSelect;

const active = ["accepted", "running"] as const;
const terminal = new Set<string>(["completed", "failed", "interrupted"]);

/** Ends an admission transaction with a refusal, rolling back whatever it wrote. */
class Refusal extends Error {
  constructor(readonly result: ChatAdmissionResult) {
    super(result.status);
  }
}

function operationOf(row: OperationRow): ChatOperationRecord {
  return {
    id: row.id,
    conversationId: row.conversationId,
    requestId: row.requestId,
    questionHash: row.questionHash,
    userMessageId: row.userMessageId,
    assistantMessageId: row.assistantMessageId,
    status: row.status as ChatOperationState,
    admittedAt: row.admittedAt,
    deadlineAt: row.deadlineAt,
    model: row.model,
    pricingVersion: row.pricingVersion,
    allowanceMicroUsd: row.allowanceMicroUsd,
    contextRevision: row.contextRevision,
    retryOf: null,
  };
}

function messageOf(row: MessageRow): ChatMessageRecord {
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

/** Gives back every open reservation of an operation. */
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
 * Replaces an operation's reservations with its known cost: the cost counts in the earliest window
 * of each kind (the admission's day and month), every other reservation is given back.
 */
async function settleReservations(tx: Transaction, operationId: string, costMicroUsd: number) {
  const reserved = await tx
    .select()
    .from(spendReservations)
    .where(
      and(eq(spendReservations.operationId, operationId), eq(spendReservations.state, "reserved")),
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
  status: "failed" | "interrupted",
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

const notYet = (): never => {
  throw new Error("Not implemented yet.");
};

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

    const [previous] = await tx
      .select()
      .from(operations)
      .where(
        and(eq(operations.identityId, input.identityId), eq(operations.requestId, input.requestId)),
      );
    if (previous !== undefined) {
      return {
        status: "duplicate",
        operation: operationOf(previous),
        sameQuestion: previous.questionHash === input.questionHash,
      };
    }
    const [busy] = await tx
      .select()
      .from(operations)
      .where(and(eq(operations.identityId, input.identityId), inArray(operations.status, active)));
    if (busy !== undefined) return { status: "busy", operation: operationOf(busy) };

    const [redeemed] = await tx
      .select({ digest: challengeRedemptions.digest })
      .from(challengeRedemptions)
      .where(eq(challengeRedemptions.digest, input.challengeTokenHash));
    if (redeemed !== undefined) return { status: "challenge_reused" };

    // Serialise the admissions of one fingerprint across identities while its quota is counted.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.fingerprint}, 0))`);
    for (const quota of input.quotas) {
      const owner =
        quota.scope === "identity"
          ? eq(admissions.identityId, input.identityId)
          : eq(admissions.fingerprint, input.fingerprint);
      const window =
        quota.resetsAt === null
          ? gt(admissions.admittedAt, quota.since)
          : gte(admissions.admittedAt, quota.since);
      const counted = await tx
        .select({ admittedAt: admissions.admittedAt })
        .from(admissions)
        .where(and(owner, window))
        .orderBy(asc(admissions.admittedAt));
      if (counted.length < quota.limit) continue;
      // A rolling window has room again when enough of its oldest admissions age out.
      const ageingOut = counted[counted.length - quota.limit]?.admittedAt ?? input.at;
      const retryAt =
        quota.resetsAt ??
        new Date(ageingOut.getTime() + (input.at.getTime() - quota.since.getTime()));
      return { status: "quota_exceeded", scope: quota.scope, retryAt };
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
        questionHash: input.questionHash,
        userMessageId: question.id,
        assistantMessageId: answer.id,
        status: "accepted",
        admittedAt: input.at,
        deadlineAt: input.deadlineAt,
        model: input.model,
        pricingVersion: input.pricingVersion,
        allowanceMicroUsd: input.allowanceMicroUsd,
        contextRevision: conversation.revision,
      })
      .returning();
    if (operation === undefined) throw new Error("No operation was stored.");
    // A token redeemed concurrently elsewhere waits on its key, then conflicts and refuses here.
    const bound = await tx
      .insert(challengeRedemptions)
      .values({ digest: input.challengeTokenHash, operationId: operation.id, redeemedAt: input.at })
      .onConflictDoNothing()
      .returning({ digest: challengeRedemptions.digest });
    if (bound.length === 0) throw new Refusal({ status: "challenge_reused" });
    await tx.insert(grants).values({
      operationId: operation.id,
      verifier: input.grantVerifier,
      expiresAt: input.deadlineAt,
    });
    if (windows.length > 0) {
      await tx.insert(spendReservations).values(
        windows.map((window) => ({
          operationId: operation.id,
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
    return { status: "admitted", operation: operationOf(operation) };
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
        .select()
        .from(messages)
        .where(and(eq(messages.conversationId, conversationId), bound))
        .orderBy(desc(messages.position))
        .limit(page.limit + 1);
      return {
        messages: rows.slice(0, page.limit).reverse().map(messageOf),
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
      return { operation: operationOf(row.operation), assistant: messageOf(row.assistant) };
    },

    async findActiveOperation(identityId) {
      const [row] = await db
        .select()
        .from(operations)
        .where(and(eq(operations.identityId, identityId), inArray(operations.status, active)));
      return row === undefined ? null : operationOf(row);
    },

    async findOperationByRequest(identityId, requestId) {
      const [row] = await db
        .select()
        .from(operations)
        .where(and(eq(operations.identityId, identityId), eq(operations.requestId, requestId)));
      return row === undefined ? null : operationOf(row);
    },

    async recentExchanges(conversationId, limit) {
      const asked = alias(messages, "asked");
      const rows = await db
        .select({
          question: asked.text,
          answer: messages.text,
          language: messages.language,
          sources: messages.sources,
        })
        .from(operations)
        .innerJoin(messages, eq(messages.id, operations.assistantMessageId))
        .innerJoin(asked, eq(asked.id, operations.userMessageId))
        .where(
          and(
            eq(operations.conversationId, conversationId),
            eq(messages.status, "completed"),
            eq(messages.outcome, "answered"),
          ),
        )
        .orderBy(desc(messages.position))
        .limit(limit);
      return rows.reverse().map((row) => ({
        question: row.question ?? "",
        answer: row.answer ?? "",
        language: row.language,
        sources: row.sources,
      }));
    },

    async admit(input) {
      await pruneExpired(input.at);
      try {
        return await db.transaction((tx) => admitWithin(tx, input));
      } catch (error) {
        if (error instanceof Refusal) return error.result;
        throw error;
      }
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
        if (locked === null) return { status: "wrong_grant" };
        const { row, grant } = locked;
        if (terminal.has(row.status)) return { status: "already", operation: operationOf(row) };
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
          })
          .where(eq(operations.id, operationId))
          .returning();
        if (finished === undefined) throw new Error("The reconciled operation disappeared.");
        if (result.costMicroUsd === null) await retainReservations(tx, operationId);
        else await settleReservations(tx, operationId, result.costMicroUsd);
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
          else await releaseReservations(tx, operation.id);
        }
        return overdue.map((operation) => operation.id);
      });
    },

    async deleteInactive(cutoff, at, limit) {
      return db.transaction(async (tx) => {
        const expired = tx
          .select({ id: identities.id })
          .from(identities)
          .where(lt(identities.lastSeenAt, cutoff))
          .orderBy(asc(identities.lastSeenAt))
          .limit(limit)
          .for("update", { skipLocked: true });
        const deleted = await tx
          .delete(identities)
          .where(inArray(identities.id, expired))
          .returning({ id: identities.id });
        await tx.delete(admissions).where(lt(admissions.expiresAt, at));
        await tx.delete(requestClaims).where(lt(requestClaims.expiresAt, at));
        await tx.insert(deletions).values({ deletedAt: at, conversations: deleted.length });
        return deleted.length;
      });
    },

    findOperationByAttempt: notYet,
    retry: notYet,
    stop: notYet,
    clear: notYet,
    recordTelemetryReference: notYet,
    pendingTelemetryDeletions: notYet,
    settleTelemetryDeletion: notYet,

    async committedSpend(kind, startsOn) {
      const [row] = await db
        .select({ committed: spendWindows.committedMicroUsd })
        .from(spendWindows)
        .where(and(eq(spendWindows.kind, kind), eq(spendWindows.startsOn, startsOn)));
      return row?.committed ?? 0;
    },
  };
}
