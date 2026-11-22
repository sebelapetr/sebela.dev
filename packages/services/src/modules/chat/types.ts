import type {
  ChatAssistantMessage,
  ChatConversation,
  ChatConversationClear,
  ChatConversationCleared,
  ChatConversationQuery,
  ChatGrantClaim,
  ChatGrantClaimed,
  ChatMessageSubmission,
  ChatOperation,
  ChatProgressStage,
  ChatRetrySubmission,
  ChatSourceKind,
  ChatStreamEvent,
  ChatUsage,
} from "@sebela/contracts";

import type { ChatPolicy } from "./policy.js";

/**
 * Checks one bot-challenge token server-side; `false` for any failure, never throws. The visitor's
 * address is `null` when the API could not establish it.
 */
export interface ChallengeVerifier {
  verify(token: string, remoteAddress: string | null): Promise<boolean>;
}

export interface ChatConfig {
  readonly fingerprintKey: string;
  readonly retentionDays: number;
  readonly model: string;
  /** The main model's reasoning effort, bound to each admitted operation. */
  readonly effort: string;
  readonly pricingVersion: string;
}

export interface ChatOptions {
  readonly config: ChatConfig;
  readonly verifier: ChallengeVerifier;
}

export interface ChatServiceOptions extends ChatOptions {
  readonly now?: () => Date;
  readonly policy?: ChatPolicy;
}

/** The visitor a cookie resolved to; never taken from a request field. */
export interface ChatCaller {
  readonly identityId: string;
  readonly conversationId: string;
}

export interface ChatOpened {
  readonly caller: ChatCaller;
  /** A new cookie value to set, or `null` when the presented cookie resolved. */
  readonly cookie: string | null;
}

/**
 * A completed answered exchange as the AI service receives it for context: one with a language, a
 * question and an answer; any other stored exchange is left out.
 */
export interface ChatHistoryExchange {
  readonly question: string;
  readonly answer: string;
  readonly language: "en" | "cs";
  readonly sources: readonly { kind: ChatSourceKind; recordId: string; title: string }[];
}

/** Everything the AI service needs for one admitted question, grant included. */
export interface ChatDispatch {
  readonly operationId: string;
  readonly grant: string;
  readonly question: string;
  readonly history: readonly ChatHistoryExchange[];
  /** The question's date in the site's time zone, `YYYY-MM-DD`. */
  readonly today: string;
  readonly deadlineAt: string;
  readonly contextRevision: number;
  readonly model: string;
  /** The main model's reasoning effort bound at admission. */
  readonly effort: string;
  readonly pricingVersion: string;
  readonly allowanceUsd: number;
}

export type ChatSubmitResult =
  | { status: "admitted"; operation: ChatOperation; dispatch: ChatDispatch }
  | { status: "existing"; operation: ChatOperation }
  | { status: "conflict" }
  | { status: "busy"; operation: ChatOperation }
  | { status: "challenge_failed" }
  | { status: "quota_exceeded"; retryAt: Date }
  | { status: "budget_exhausted" };

/** A retry is a submission keyed by its own id, of an attempt that must exist and have failed. */
export type ChatRetryOutcome =
  | ChatSubmitResult
  | { status: "not_found" }
  /** Not a retryable failure of the conversation's latest question. */
  | { status: "not_retryable" };

export type ChatStopOutcome =
  /** `running` tells whether a generation claimed the grant and must be told to stop. */
  | { status: "stopped"; operation: ChatOperation; running: boolean }
  /** It had already ended; returned unchanged. */
  | { status: "finished"; operation: ChatOperation };

export interface ChatClearOutcome {
  readonly cleared: ChatConversationCleared;
  /** The operations that were active and are cancelled; the AI service is told to stop them. */
  readonly cancelled: readonly string[];
}

export interface ChatObservation {
  readonly operation: ChatOperation;
  readonly assistant: ChatAssistantMessage;
  /** The stored answer as stream events, identical on every call. */
  readonly events: ChatStreamEvent[];
  readonly stage: ChatProgressStage;
  readonly elapsedMs: number;
  readonly terminal: boolean;
}

export type ChatClaimOutcome =
  | { status: "claimed"; claimed: ChatGrantClaimed }
  | { status: "refused" }
  | { status: "wrong_grant" };

export type ChatReconcileOutcome =
  | { status: "reconciled" | "already"; operation: ChatOperation }
  /** Its conversation was cleared; nothing was stored but the measured cost. */
  | { status: "deleted" }
  | { status: "not_claimed" }
  | { status: "wrong_grant" }
  | { status: "invalid" };

export interface ChatService {
  readonly retentionDays: number;
  open(cookie: string | null): Promise<ChatOpened>;
  conversation(caller: ChatCaller, query: ChatConversationQuery): Promise<ChatConversation>;
  submit(
    caller: ChatCaller,
    submission: ChatMessageSubmission,
    context: { clientAddress: string | null },
  ): Promise<ChatSubmitResult>;
  /**
   * Retries a failed attempt as a new attempt of the same request: a used `retryId` and an
   * active or completed attempt are recovered before the challenge; then the same gates as a
   * submission apply.
   */
  retry(
    caller: ChatCaller,
    operationId: string,
    submission: ChatRetrySubmission,
    context: { clientAddress: string | null },
  ): Promise<ChatRetryOutcome>;
  /** Stops the caller's active operation; `null` for another identity's or an unknown one. */
  stop(caller: ChatCaller, operationId: string): Promise<ChatStopOutcome | null>;
  /**
   * Clears the caller's conversation when `conversationId` names it: cancels active work, deletes
   * the messages and starts a fresh conversation; quotas and spend stay. Another id clears nothing.
   */
  clear(caller: ChatCaller, request: ChatConversationClear): Promise<ChatClearOutcome>;
  operation(caller: ChatCaller, operationId: string): Promise<ChatOperation | null>;
  observe(caller: ChatCaller, operationId: string): Promise<ChatObservation | null>;
  claim(claim: ChatGrantClaim): Promise<ChatClaimOutcome>;
  reconcile(operationId: string, body: unknown): Promise<ChatReconcileOutcome>;
  dispatchRefused(operationId: string): Promise<boolean>;
  interruptOverdue(graceMs: number): Promise<string[]>;
  deleteExpired(limit: number): Promise<number>;
  /** The caller's own usage and policy snapshot; never another visitor's or the global spend. */
  usage(caller: ChatCaller, context: { clientAddress: string | null }): Promise<ChatUsage>;
}
