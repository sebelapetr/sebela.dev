// The visitor's usage snapshot as the composer's usage panel shows it: both meters with counts,
// percentages and when capacity comes back, the limit that would refuse a question now, the
// read-only model and effort, and the last main call's context against its cap. Every time is
// counted from the server's clock; nothing unknown is ever shown as zero.
import type { ChatUsage, ChatUsageLevel } from "@sebela/contracts";

import type { ChatTurnModel } from "./conversation";

/**
 * Where the usage panel's data stands: being read for the first time, never read (so nothing is
 * shown as a number), or read, with the server's clock ahead of the browser's by `offsetMs`, the
 * browser's time it was read at, and `stale` once a later read failed.
 */
export type ChatUsageState =
  | { readonly status: "loading" }
  | { readonly status: "unavailable" }
  | {
      readonly status: "ready";
      readonly usage: ChatUsage;
      readonly offsetMs: number;
      readonly readAt: number;
      readonly stale: boolean;
    };

/** One meter of the visitor's own allowance. */
export interface ChatUsageMeterView {
  readonly id: "two_hours" | "day";
  readonly label: string;
  /** "6 of 10 questions". */
  readonly value: string;
  /** Rounded, 0 to 100, for the bar. */
  readonly percent: number;
  readonly percentText: string;
  /** The colour's level only; `state` says it in words. */
  readonly level: ChatUsageLevel;
  readonly state: string | null;
  readonly timing: string | null;
}

/** The last main call's serialized input against its cap, or unavailable. */
export interface ChatContextView {
  readonly status: "measured" | "unavailable";
  readonly value: string;
  /** Whether `value` is the provider's count or the tokenizer's estimate. */
  readonly kind: string | null;
  readonly percent: number | null;
  readonly percentText: string | null;
  readonly level: ChatUsageLevel | null;
  readonly details: readonly { readonly label: string; readonly value: string }[];
}

/** Why a question would be refused now, and whether the limit is the visitor's own. */
export interface ChatRestrictionView {
  readonly text: string;
  readonly personal: boolean;
  readonly contact: boolean;
}

export interface ChatUsageView {
  readonly status: ChatUsageState["status"];
  /** The collapsed panel's line: compact counts and the most pressing state in words. */
  readonly summary: {
    readonly text: string;
    readonly note: string | null;
    readonly level: ChatUsageLevel;
  };
  readonly meters: readonly ChatUsageMeterView[];
  readonly context: ChatContextView;
  readonly nextRequest: string;
  readonly model: string | null;
  readonly active: string | null;
  readonly restriction: ChatRestrictionView | null;
  readonly stale: string | null;
}

/** The snapshot, or null when it is not one the contract allows. */
export function parseChatUsage(raw: unknown): ChatUsage | null {
  throw new Error("not implemented", { cause: raw });
}

/** A snapshot just read at the browser's time `nowMs`. */
export function readChatUsageState(usage: ChatUsage, nowMs: number): ChatUsageState {
  throw new Error("not implemented", { cause: [usage, nowMs] });
}

/** The panel's view of the state at the browser's time `nowMs`. Pure. */
export function describeChatUsage(state: ChatUsageState, nowMs: number): ChatUsageView {
  throw new Error("not implemented", { cause: [state, nowMs] });
}

/**
 * When, on the browser's clock, the snapshot changes by itself: the earliest of the next release,
 * the day's reset and the restriction's retry; null without a snapshot.
 */
export function chatUsageRefreshAt(state: ChatUsageState, nowMs: number): number | null {
  throw new Error("not implemented", { cause: [state, nowMs] });
}

/**
 * "Answered with …" for an answer produced with another model or effort than the server's
 * configured one; null when it is the same, or either is unknown.
 */
export function answeredWith(
  model: ChatTurnModel | null,
  current: { readonly name: string; readonly effort: string } | null,
): string | null {
  throw new Error("not implemented", { cause: [model, current] });
}
