import { z } from "zod";

import { ChatOperationSchema } from "./conversation.js";

const Instant = z.iso.datetime({ offset: true });

/**
 * Why an admission would be refused now. `minute`, `two_hours` and `day` are the caller's own
 * limits; `shared_network` is the limit of everyone on the caller's network, and `service_budget`
 * is the site-wide spend limit, neither of which is the caller's personal meter.
 */
export const chatRestrictionReasons = [
  "minute",
  "two_hours",
  "day",
  "shared_network",
  "service_budget",
] as const;

export type ChatRestrictionReason = (typeof chatRestrictionReasons)[number];

/** How full a meter is: strictly above 70 percent warns, strictly above 90 percent is critical. */
export type ChatUsageLevel = "neutral" | "warning" | "critical";

export function chatUsageLevel(used: number, limit: number): ChatUsageLevel {
  // Compare in integers, so a boundary such as 21 of 30 is never misread through rounding.
  if (used * 100 > limit * 90) return "critical";
  if (used * 100 > limit * 70) return "warning";
  return "neutral";
}

const counts = {
  used: z.int().nonnegative(),
  limit: z.int().positive(),
  percent: z.number().min(0).max(100),
};

const withinLimit = (value: { used: number; limit: number }) => value.used <= value.limit;
const beyondLimit = { path: ["used"], message: "A meter never counts beyond its limit." };

/** The caller's own meters and limits, read without consuming anything. */
export const ChatUsageSchema = z
  .strictObject({
    serverTime: Instant.meta({ description: "The server's time the snapshot was read at." }),
    model: z
      .strictObject({ name: z.string().min(1).max(100), effort: z.string().min(1).max(100) })
      .meta({ description: "The server-configured main model and effort; read-only." }),
    rollingTwoHours: z
      .strictObject({
        ...counts,
        nextReleaseAt: Instant.nullable().meta({
          description:
            "When the oldest counted operation leaves the rolling window; `null` when none counts.",
        }),
      })
      .refine(withinLimit, beyondLimit),
    utcDay: z
      .strictObject({
        ...counts,
        resetsAt: Instant.meta({ description: "The next UTC midnight, when the day resets." }),
      })
      .refine(withinLimit, beyondLimit),
    activeOperation: ChatOperationSchema.nullable(),
    restriction: z
      .strictObject({ reason: z.enum(chatRestrictionReasons), retryAt: Instant })
      .nullable()
      .meta({
        description:
          "Why a new question would be refused now and when it may pass again; `null` when it would pass these limits.",
      }),
    context: z
      .discriminatedUnion("status", [
        z.strictObject({
          status: z.literal("measured"),
          operationId: z.uuid(),
          measuredAt: Instant,
          estimatedInputTokens: z.int().nonnegative().meta({
            description: "The tokenizer estimate of the last main call's serialized input.",
          }),
          reportedInputTokens: z.int().nonnegative().nullable().meta({
            description: "The input tokens the provider reported for that call; `null` if none.",
          }),
          capTokens: z.int().positive().meta({
            description: "The input-token cap that call was sent under.",
          }),
        }),
        z.strictObject({ status: z.literal("unavailable") }),
      ])
      .meta({
        description:
          "The conversation's last main model call: its serialized input against the effective cap.",
      }),
    nextRequest: z
      .discriminatedUnion("status", [
        z.strictObject({
          status: z.literal("estimated"),
          historyTokens: z.int().nonnegative().meta({
            description:
              "The estimated tokens of the working context after the compaction: the summary and the kept exchanges, never the question, the instructions or tool results.",
          }),
          operationId: z.uuid().meta({ description: "The compaction that measured it." }),
          measuredAt: Instant,
        }),
        z.strictObject({ status: z.literal("unavailable") }),
      ])
      .meta({
        description:
          "A post-compaction estimate of the history the next request carries; future tool tokens are unknown and never claimed. `unavailable` unless the latest measured operation was a compaction.",
      }),
  })
  .meta({ id: "ChatUsage" });

export type ChatUsage = z.infer<typeof ChatUsageSchema>;
