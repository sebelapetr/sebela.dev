import { z } from "zod";

// A typed stub so the contract's tests compile and fail; the implementation follows.

export const chatQuestionMaxLength = 1000;
export const chatOutcomes = [] as unknown as readonly [
  "answered",
  "insufficient_evidence",
  "refused",
  "unavailable",
];
export const chatErrorCodes = [] as unknown as readonly [
  "invalid_request",
  "rate_limited",
  "unavailable",
  "timeout",
  "invalid_stream",
  "internal",
];
export const chatBlockTypes = [] as unknown as readonly [
  "ContactCard",
  "ExperienceCard",
  "ServiceCard",
  "ExplorationCard",
  "RoadmapCard",
];

export type ChatOutcome = (typeof chatOutcomes)[number];
export type ChatErrorCode = (typeof chatErrorCodes)[number];

export interface ChatSubmission {
  conversationId: string;
  requestId: string;
  question: string;
}
export interface ChatSource {
  record: { kind: string; id: string };
  title: string;
  href: string;
}
export interface ChatRelatedLink {
  label: string;
  href: string;
}
export type ChatBlock = Record<string, unknown> & { type: (typeof chatBlockTypes)[number] };
interface Ids {
  requestId: string;
  messageId: string;
  eventId: number;
}
export type ChatStreamEvent =
  | (Ids & { type: "start" })
  | (Ids & { type: "text_delta"; text: string })
  | (Ids & { type: "block"; block: ChatBlock })
  | (Ids & { type: "sources"; sources: ChatSource[] })
  | (Ids & { type: "related"; links: ChatRelatedLink[] })
  | (Ids & { type: "complete"; outcome: ChatOutcome })
  | (Ids & { type: "error"; code: ChatErrorCode; retryable: boolean });

const never = <T>() => z.custom<T>(() => false);
export const ChatSubmissionSchema = never<ChatSubmission>();
export const ChatSourceSchema = never<ChatSource>();
export const ChatSourcesSchema = never<ChatSource[]>();
export const ChatRelatedLinkSchema = never<ChatRelatedLink>();
export const ChatBlockSchema = never<ChatBlock>();
export const ChatStreamEventSchema = never<ChatStreamEvent>();

export type ChatTerminal =
  | { type: "complete"; outcome: ChatOutcome }
  | { type: "error"; code: ChatErrorCode; retryable: boolean };
export interface ChatAttempt {
  requestId: string;
  messageId: string | null;
  lastEventId: number;
  sources: boolean;
  related: boolean;
  terminal: ChatTerminal | null;
}
export type ChatOrderViolation = string;
export type ChatEventStep =
  | { status: "accepted"; attempt: ChatAttempt }
  | { status: "duplicate" }
  | { status: "invalid"; reason: ChatOrderViolation };
export type ChatStreamValidation =
  | { status: "complete"; events: ChatStreamEvent[]; terminal: ChatTerminal }
  | { status: "interrupted"; events: ChatStreamEvent[] }
  | { status: "invalid"; index: number; reason: string };

export function startChatAttempt(requestId: string): ChatAttempt {
  throw new Error(`Not implemented: ${requestId}`);
}
export function advanceChatAttempt(attempt: ChatAttempt, event: ChatStreamEvent): ChatEventStep {
  throw new Error(`Not implemented: ${attempt.requestId} ${event.type}`);
}
export function validateChatStream(
  requestId: string,
  events: readonly unknown[],
): ChatStreamValidation {
  throw new Error(`Not implemented: ${requestId} ${String(events.length)}`);
}
