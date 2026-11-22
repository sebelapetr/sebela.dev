import type {
  ChatAssistantMessage,
  ChatConversation,
  ChatConversationQuery,
  ChatGrantClaim,
  ChatGrantClaimed,
  ChatMessageSubmission,
  ChatOperation,
  ChatProgressStage,
  ChatSourceKind,
  ChatStreamEvent,
} from "@sebela/contracts";
import type { ChatPersistence } from "@sebela/db";

import { chatPolicy, type ChatPolicy } from "./policy.js";

export { chatPolicy };
export type { ChatPolicy };

/** Cloudflare's Siteverify endpoint, the only verification address production accepts. */
export const siteverifyUrl = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Checks one bot-challenge token server-side; `false` for any failure, never throws. */
export interface ChallengeVerifier {
  verify(token: string, remoteAddress: string): Promise<boolean>;
}

export interface ChatConfig {
  readonly fingerprintKey: string;
  readonly retentionDays: number;
  readonly model: string;
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

/** A completed answered exchange as the AI service receives it for context. */
export interface ChatHistoryExchange {
  readonly question: string;
  readonly answer: string;
  readonly language: "en" | "cs" | null;
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
    context: { clientAddress: string },
  ): Promise<ChatSubmitResult>;
  operation(caller: ChatCaller, operationId: string): Promise<ChatOperation | null>;
  observe(caller: ChatCaller, operationId: string): Promise<ChatObservation | null>;
  claim(claim: ChatGrantClaim): Promise<ChatClaimOutcome>;
  reconcile(operationId: string, body: unknown): Promise<ChatReconcileOutcome>;
  dispatchRefused(operationId: string): Promise<boolean>;
  interruptOverdue(graceMs: number): Promise<string[]>;
  deleteExpired(limit: number): Promise<number>;
}

const notYet = (what: string): never => {
  throw new Error(`Not implemented: ${what}`);
};

export function createChatService(
  persistence: ChatPersistence,
  options: ChatServiceOptions,
): ChatService {
  return notYet(`createChatService ${typeof persistence} ${typeof options}`);
}

export function createSiteverifyVerifier(options: {
  secret: string;
  expectedHostname: string;
  url: string;
  production: boolean;
  timeoutMs?: number;
  fetch?: typeof fetch;
  now?: () => Date;
}): ChallengeVerifier {
  return notYet(`createSiteverifyVerifier ${typeof options}`);
}

export function readChatOptions(
  env: Readonly<Record<string, string | undefined>>,
): ChatOptions | null {
  return notYet(`readChatOptions ${typeof env}`);
}
