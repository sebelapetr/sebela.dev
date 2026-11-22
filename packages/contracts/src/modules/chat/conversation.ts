/**
 * Placeholder of the visitor conversation contract; the implementation follows the failing tests.
 */
import { z } from "zod";

import type { ChatStreamEvent, ChatTerminal } from "./stream.js";

export const chatConversationPageLimit = 20;
export const chatHistoryExchangeLimit = 6;
export const chatChallengeTokenMaxLength = 2048;
export const chatGrantMaxLength = 200;
export const chatAnswerMaxLength = 32000;
export const chatRetentionDaysDefault = 730;
export const chatOperationStatuses = [
  "accepted",
  "running",
  "completed",
  "failed",
  "interrupted",
] as const;
export type ChatOperationStatus = (typeof chatOperationStatuses)[number];
export const chatAssistantStatuses = ["pending", "completed", "failed", "interrupted"] as const;
export type ChatAssistantStatus = (typeof chatAssistantStatuses)[number];
export const chatProgressStages = ["queued", "checking", "answering", "finishing"] as const;
export type ChatProgressStage = (typeof chatProgressStages)[number];
export const chatGenerationOutcomes = [
  "answered",
  "insufficient_evidence",
  "refused",
  "unavailable",
  "cancelled",
  "limit_reached",
] as const;
export type ChatGenerationOutcome = (typeof chatGenerationOutcomes)[number];

export const ChatMessageSubmissionSchema = z.never();
export type ChatMessageSubmission = z.infer<typeof ChatMessageSubmissionSchema>;
export const ChatConversationQuerySchema = z.never();
export type ChatConversationQuery = z.infer<typeof ChatConversationQuerySchema>;
export const ChatOperationSchema = z.never();
export type ChatOperation = z.infer<typeof ChatOperationSchema>;
export const ChatUserMessageSchema = z.never();
export type ChatUserMessage = z.infer<typeof ChatUserMessageSchema>;
export const ChatAssistantMessageSchema = z.never();
export type ChatAssistantMessage = z.infer<typeof ChatAssistantMessageSchema>;
export const ChatMessageSchema = z.never();
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export const ChatConversationSchema = z.never();
export type ChatConversation = z.infer<typeof ChatConversationSchema>;
export const ChatProgressSchema = z.never();
export type ChatProgress = z.infer<typeof ChatProgressSchema>;
export const ChatGrantClaimSchema = z.never();
export type ChatGrantClaim = z.infer<typeof ChatGrantClaimSchema>;
export const ChatGrantClaimedSchema = z.never();
export type ChatGrantClaimed = z.infer<typeof ChatGrantClaimedSchema>;
export const ChatGenerationResultSchema = z.never();
export type ChatGenerationResult = z.infer<typeof ChatGenerationResultSchema>;

export const chatTerminalForGeneration: (
  outcome: ChatGenerationOutcome,
  reason: string | null,
) => ChatTerminal = () => {
  throw new Error("not implemented");
};

export const chatReplayEvents: (
  requestId: string,
  message: ChatAssistantMessage,
) => ChatStreamEvent[] = () => {
  throw new Error("not implemented");
};
