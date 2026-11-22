import type { Database } from "../../database.js";

/** The UTC window a spend reservation counts in. */
export type ChatSpendKind = "day" | "month";

export type ChatOperationState = "accepted" | "running" | "completed" | "failed" | "interrupted";

export type ChatMessageState = "pending" | "completed" | "failed" | "interrupted";

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
  | { status: "not_claimed" }
  | { status: "wrong_grant" };

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
   * purges expired admissions; records the run. Spend accounting stays. Returns how many
   * conversations it deleted.
   */
  deleteInactive(cutoff: Date, at: Date, limit: number): Promise<number>;
  /** The committed spend of one window in millionths of a US dollar; 0 when it has none. */
  committedSpend(kind: ChatSpendKind, startsOn: string): Promise<number>;
}

export function createChatPersistence(db: Database): ChatPersistence {
  const notImplemented = () => Promise.reject(new Error(`not implemented over ${typeof db}`));
  return {
    resolveIdentity: notImplemented,
    createIdentity: notImplemented,
    listMessages: notImplemented,
    findOperation: notImplemented,
    findActiveOperation: notImplemented,
    findOperationByRequest: notImplemented,
    recentExchanges: notImplemented,
    admit: notImplemented,
    claimGrant: notImplemented,
    reconcile: notImplemented,
    failUnclaimed: notImplemented,
    interruptOverdue: notImplemented,
    deleteInactive: notImplemented,
    committedSpend: notImplemented,
  };
}
