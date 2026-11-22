import type { ChatQuotaRule, ChatSpendWindow } from "@sebela/db";

/** The server's chat policy; changed only in code, never by a request. */
export interface ChatPolicy {
  /** The whole-attempt allowance reserved per question, in millionths of a US dollar. */
  readonly allowanceMicroUsd: number;
  readonly dailySpendLimitMicroUsd: number;
  readonly monthlySpendLimitMicroUsd: number;
  /** The absolute generation deadline after admission. */
  readonly deadlineMs: number;
}

export const chatPolicy: ChatPolicy = {
  allowanceMicroUsd: 20_000,
  dailySpendLimitMicroUsd: 2_000_000,
  monthlySpendLimitMicroUsd: 20_000_000,
  deadlineMs: 60_000,
};

const notYet = (what: string): never => {
  throw new Error(`Not implemented: ${what}`);
};

export function quotaRules(at: Date): ChatQuotaRule[] {
  return notYet(`quotaRules ${at.toISOString()}`);
}

export function spendWindows(
  at: Date,
  deadline: Date,
  policy: ChatPolicy = chatPolicy,
): ChatSpendWindow[] {
  return notYet(`spendWindows ${at.toISOString()} ${deadline.toISOString()} ${typeof policy}`);
}

export function admissionExpiry(at: Date): Date {
  return notYet(`admissionExpiry ${at.toISOString()}`);
}

export function pragueDate(at: Date): string {
  return notYet(`pragueDate ${at.toISOString()}`);
}
