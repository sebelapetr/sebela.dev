import { z } from "zod";

import type { ChatOperation } from "./conversation.js";

/** Why an admission would be refused now. Placeholder until the snapshot is implemented. */
export const chatRestrictionReasons = [
  "minute",
  "two_hours",
  "day",
  "shared_network",
  "service_budget",
] as const;

export type ChatRestrictionReason = (typeof chatRestrictionReasons)[number];

export type ChatUsageLevel = "neutral" | "warning" | "critical";

export interface ChatUsage {
  serverTime: string;
  model: { name: string; effort: string };
  rollingTwoHours: { used: number; limit: number; percent: number; nextReleaseAt: string | null };
  utcDay: { used: number; limit: number; percent: number; resetsAt: string };
  activeOperation: ChatOperation | null;
  restriction: { reason: ChatRestrictionReason; retryAt: string } | null;
  context:
    | {
        status: "measured";
        operationId: string;
        measuredAt: string;
        estimatedInputTokens: number;
        reportedInputTokens: number | null;
        capTokens: number;
      }
    | { status: "unavailable" };
  nextRequest: { status: "unavailable" };
}

export const ChatUsageSchema: z.ZodType<ChatUsage> = z.custom<ChatUsage>(() => false);

export const chatUsageLevel: (used: number, limit: number) => ChatUsageLevel = () => "neutral";
