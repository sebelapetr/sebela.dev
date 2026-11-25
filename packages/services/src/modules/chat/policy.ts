import type { ChatRestrictionReason } from "@sebela/contracts";
import type { ChatQuotaRule, ChatSpendWindow } from "@sebela/db";

import { siteverifyTimeoutMs } from "./siteverify.js";

/** The server's chat policy; changed only in code, never by a request. */
export interface ChatPolicy {
  /** The whole-attempt allowance reserved per question, in millionths of a US dollar. */
  readonly allowanceMicroUsd: number;
  readonly dailySpendLimitMicroUsd: number;
  readonly monthlySpendLimitMicroUsd: number;
  /** The absolute generation deadline after admission. */
  readonly deadlineMs: number;
  /**
   * How long a submission's request claim holds while its challenge is verified; longer than
   * Siteverify may take, so a crashed holder's claim lapses soon after.
   */
  readonly requestClaimMs: number;
  /** How often a concurrent equal submission looks again for the holder's outcome. */
  readonly requestClaimPollMs: number;
}

export const chatPolicy: ChatPolicy = {
  allowanceMicroUsd: 20_000,
  dailySpendLimitMicroUsd: 2_000_000,
  monthlySpendLimitMicroUsd: 20_000_000,
  deadlineMs: 60_000,
  requestClaimMs: siteverifyTimeoutMs + 2_000,
  requestClaimPollMs: 100,
};

const minute = 60_000;
const hour = 60 * minute;

const utcDay = (at: Date) =>
  new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
/** The UTC midnight after `at`. */
export const nextUtcDay = (at: Date) =>
  new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + 1));
const isoDay = (at: Date) => at.toISOString().slice(0, 10);

/**
 * The quotas one admission at `at` must fit: an identity 5 per rolling minute, 10 per rolling two
 * hours and 30 per UTC day; a client-address fingerprint 20 per rolling minute and 100 per UTC day.
 */
export function quotaRules(at: Date): ChatQuotaRule[] {
  return namedQuotaRules(at).map((named) => named.rule);
}

/**
 * The same quotas, each with the restriction it names when full: the identity's own minute, two
 * hours and day, and the shared network for both fingerprint quotas.
 */
export function namedQuotaRules(
  at: Date,
): { reason: ChatRestrictionReason; rule: ChatQuotaRule }[] {
  const since = (ms: number) => new Date(at.getTime() - ms);
  const day = { since: utcDay(at), resetsAt: nextUtcDay(at) };
  return [
    {
      reason: "minute",
      rule: { scope: "identity", since: since(minute), limit: 5, resetsAt: null },
    },
    {
      reason: "two_hours",
      rule: { scope: "identity", since: since(2 * hour), limit: 10, resetsAt: null },
    },
    { reason: "day", rule: { scope: "identity", ...day, limit: 30 } },
    {
      reason: "shared_network",
      rule: { scope: "fingerprint", since: since(minute), limit: 20, resetsAt: null },
    },
    { reason: "shared_network", rule: { scope: "fingerprint", ...day, limit: 100 } },
  ];
}

/** When a spend window ends: the next UTC midnight after a day, the first of the next month. */
export function windowEnd(window: ChatSpendWindow): Date {
  const [year = 0, month = 1, date = 1] = window.startsOn.split("-").map(Number);
  return window.kind === "day"
    ? new Date(Date.UTC(year, month - 1, date + 1))
    : new Date(Date.UTC(year, month, 1));
}

/** Every UTC day and then every UTC month the attempt from `at` to `deadline` touches. */
export function spendWindows(
  at: Date,
  deadline: Date,
  policy: ChatPolicy = chatPolicy,
): ChatSpendWindow[] {
  const days = new Set([isoDay(at), isoDay(deadline)]);
  const months = new Set([...days].map((day) => `${day.slice(0, 7)}-01`));
  return [
    ...[...days].map((startsOn) => ({
      kind: "day" as const,
      startsOn,
      limitMicroUsd: policy.dailySpendLimitMicroUsd,
    })),
    ...[...months].map((startsOn) => ({
      kind: "month" as const,
      startsOn,
      limitMicroUsd: policy.monthlySpendLimitMicroUsd,
    })),
  ];
}

/** When an admission's quota row may go: after its UTC day and its two-hour window have passed. */
export function admissionExpiry(at: Date): Date {
  const twoHours = at.getTime() + 2 * hour;
  return new Date(Math.max(nextUtcDay(at).getTime(), twoHours));
}

const pragueFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Prague",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The calendar date of `at` in the site's time zone, `YYYY-MM-DD`. */
export function pragueDate(at: Date): string {
  return pragueFormat.format(at);
}
