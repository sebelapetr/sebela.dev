// The visitor's usage snapshot as the composer's usage panel shows it: both meters with counts,
// percentages and when capacity comes back, the limit that would refuse a question now, the
// read-only model and effort, and the last main call's context against its cap. Every time is
// counted from the server's clock; nothing unknown is ever shown as zero.
import {
  chatUsageLevel,
  ChatUsageSchema,
  type ChatUsage,
  type ChatUsageLevel,
} from "@sebela/contracts";

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
  const parsed = ChatUsageSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** A snapshot just read at the browser's time `nowMs`. */
export function readChatUsageState(usage: ChatUsage, nowMs: number): ChatUsageState {
  return {
    status: "ready",
    usage,
    offsetMs: Date.parse(usage.serverTime) - nowMs,
    readAt: nowMs,
    stale: false,
  };
}

const minuteMs = 60_000;
const dayMs = 24 * 60 * minuteMs;
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const count = new Intl.NumberFormat("en-US");

/** "14:25 UTC". */
function clock(ms: number): string {
  return `${new Date(ms).toISOString().slice(11, 16)} UTC`;
}

/** "in 25 min", "in 1 h 30 min", "in 10 h", "in under a minute". */
function within(ms: number): string {
  if (ms < minuteMs) return "in under a minute";
  const minutes = Math.ceil(ms / minuteMs);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `in ${String(rest)} min`;
  return rest === 0 ? `in ${String(hours)} h` : `in ${String(hours)} h ${String(rest)} min`;
}

/** "at 14:25 UTC (in 25 min)" within a day of the server's time; "on 1 Dec at 00:00 UTC" later. */
function when(at: string, serverNow: number): string {
  const target = Date.parse(at);
  const ahead = target - serverNow;
  if (ahead >= dayMs) {
    const date = new Date(target);
    return `on ${String(date.getUTCDate())} ${months[date.getUTCMonth()] ?? ""} at ${clock(target)}`;
  }
  return `at ${clock(target)} (${within(Math.max(0, ahead))})`;
}

function rounded(used: number, limit: number): number {
  return Math.min(100, Math.round((used * 100) / limit));
}

function meterState(used: number, limit: number, level: ChatUsageLevel): string | null {
  if (used >= limit) return "Limit reached";
  if (level === "critical") return "Over 90% used";
  if (level === "warning") return "Over 70% used";
  return null;
}

function meter(
  id: ChatUsageMeterView["id"],
  label: string,
  used: number,
  limit: number,
  timing: string | null,
): ChatUsageMeterView {
  const level = chatUsageLevel(used, limit);
  const percent = rounded(used, limit);
  return {
    id,
    label,
    value: `${count.format(used)} of ${count.format(limit)} questions`,
    percent,
    percentText: `${String(percent)}%`,
    level,
    state: meterState(used, limit, level),
    timing,
  };
}

const unavailableContext: ChatContextView = {
  status: "unavailable",
  value: "Unavailable",
  kind: null,
  percent: null,
  percentText: null,
  level: null,
  details: [],
};

const reported = "Reported by the model provider";
const estimated = "Tokenizer estimate";

function contextView(context: ChatUsage["context"]): ChatContextView {
  if (context.status === "unavailable") return unavailableContext;
  const { estimatedInputTokens, reportedInputTokens, capTokens } = context;
  const tokens = reportedInputTokens ?? estimatedInputTokens;
  const percent = rounded(tokens, capTokens);
  const of = `${count.format(tokens)} of ${count.format(capTokens)} input tokens`;
  return {
    status: "measured",
    value: reportedInputTokens === null ? `About ${of}` : of,
    kind: reportedInputTokens === null ? estimated : reported,
    percent,
    percentText: `${String(percent)}%`,
    level: chatUsageLevel(Math.min(tokens, capTokens), capTokens),
    details: [
      {
        label: reported,
        value:
          reportedInputTokens === null
            ? "Not reported"
            : `${count.format(reportedInputTokens)} tokens`,
      },
      { label: estimated, value: `${count.format(estimatedInputTokens)} tokens` },
      { label: "Input cap", value: `${count.format(capTokens)} tokens` },
      { label: "Measured", value: clock(Date.parse(context.measuredAt)) },
    ],
  };
}

function restrictionView(usage: ChatUsage, serverNow: number): ChatRestrictionView | null {
  const { restriction } = usage;
  if (restriction === null) return null;
  const again = `You can ask again ${when(restriction.retryAt, serverNow)}.`;
  const notYours = "This is not your own usage.";
  switch (restriction.reason) {
    case "minute":
      return {
        text: `You asked several questions in a short time. ${again}`,
        personal: true,
        contact: false,
      };
    case "two_hours":
      return {
        text: `You reached ${count.format(usage.rollingTwoHours.limit)} questions in 2 hours. ${again}`,
        personal: true,
        contact: false,
      };
    case "day":
      return {
        text: `You reached ${count.format(usage.utcDay.limit)} questions today (UTC). ${again}`,
        personal: true,
        contact: true,
      };
    case "shared_network":
      return {
        text: `Many questions came from your network, so the assistant is paused for it. ${notYours} ${again}`,
        personal: false,
        contact: true,
      };
    case "service_budget":
      return {
        text: `The assistant reached its spending limit for now. ${notYours} ${again}`,
        personal: false,
        contact: true,
      };
  }
}

const levels: readonly ChatUsageLevel[] = ["neutral", "warning", "critical"];

/** The panel's view of the state at the browser's time `nowMs`. Pure. */
export function describeChatUsage(state: ChatUsageState, nowMs: number): ChatUsageView {
  if (state.status !== "ready") {
    return {
      status: state.status,
      summary: {
        text: "Usage",
        note: state.status === "loading" ? "Loading" : "Unavailable",
        level: "neutral",
      },
      meters: [],
      context: unavailableContext,
      nextRequest: "Unavailable",
      model: null,
      active: null,
      restriction: null,
      stale: null,
    };
  }
  const { usage } = state;
  const serverNow = nowMs + state.offsetMs;
  const { rollingTwoHours: twoHours, utcDay: day } = usage;
  const meters = [
    meter(
      "two_hours",
      "Last 2 hours",
      twoHours.used,
      twoHours.limit,
      twoHours.nextReleaseAt === null
        ? null
        : `Next one frees up ${when(twoHours.nextReleaseAt, serverNow)}`,
    ),
    meter("day", "Today (UTC)", day.used, day.limit, `Resets ${when(day.resetsAt, serverNow)}`),
  ];
  const restriction = restrictionView(usage, serverNow);
  const level = meters.reduce<ChatUsageLevel>(
    (worst, item) => (levels.indexOf(item.level) > levels.indexOf(worst) ? item.level : worst),
    "neutral",
  );
  const pressing =
    meters.find((item) => item.state === "Limit reached") ??
    meters.find((item) => item.level === level && item.state !== null);
  const note =
    restriction === null
      ? (pressing?.state ?? null)
      : restriction.personal
        ? "Limit reached"
        : "Paused";
  return {
    status: "ready",
    summary: {
      text: `2 h ${String(twoHours.used)}/${String(twoHours.limit)} · today ${String(day.used)}/${String(day.limit)}`,
      note,
      level: restriction?.personal === true ? "critical" : level,
    },
    meters,
    context: contextView(usage.context),
    nextRequest: "Unavailable",
    model: `${usage.model.name}, ${usage.model.effort} effort`,
    active:
      usage.activeOperation === null
        ? null
        : "An answer is being prepared. Its question already counts.",
    restriction,
    stale: state.stale
      ? `Not up to date. Last read at ${clock(state.readAt + state.offsetMs)}; it could not be read again.`
      : null,
  };
}

/**
 * When, on the browser's clock, the snapshot changes by itself: the earliest of the next release,
 * the day's reset and the restriction's retry still ahead of `nowMs`; null when none is.
 */
export function chatUsageRefreshAt(state: ChatUsageState, nowMs: number): number | null {
  if (state.status !== "ready") return null;
  const { usage } = state;
  const moments = [
    usage.rollingTwoHours.nextReleaseAt,
    usage.utcDay.resetsAt,
    usage.restriction?.retryAt ?? null,
  ]
    .flatMap((at) => (at === null ? [] : [Date.parse(at) - state.offsetMs]))
    .filter((at) => at > nowMs);
  return moments.length === 0 ? null : Math.min(...moments);
}

/**
 * "Answered with …" for an answer produced with another model or effort than the server's
 * configured one; null when it is the same, or either is unknown.
 */
export function answeredWith(
  model: ChatTurnModel | null,
  current: { readonly name: string; readonly effort: string } | null,
): string | null {
  if (model === null || current === null) return null;
  if (model.name === current.name && model.effort === current.effort) return null;
  return model.effort === null
    ? `Answered with ${model.name}`
    : `Answered with ${model.name}, ${model.effort} effort`;
}
