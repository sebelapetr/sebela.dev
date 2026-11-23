// What a compaction of the working context shows: its progress while it runs and its end, read from
// the operation the API reports. A compaction never changes the visible conversation.
import type { ChatOperation } from "@sebela/contracts";

import type { ChatAdmissionCode } from "./admission";

/** How a compaction ended, as the visitor is told. */
export type ChatCompactionEnd =
  | { readonly kind: "compacted" }
  | { readonly kind: "stale" }
  | { readonly kind: "unchanged" }
  | { readonly kind: "failed" }
  | { readonly kind: "interrupted" }
  | { readonly kind: "cancelled" }
  /** The API had nothing to compact; nothing was counted. */
  | { readonly kind: "nothing" }
  /** The API did not admit it. */
  | {
      readonly kind: "refused";
      readonly code: ChatAdmissionCode;
      readonly retryAfterSeconds: number | null;
    };

/** The compaction a tab shows: being checked and asked for, running, or ended. */
export type ChatCompactionState =
  | { readonly status: "preparing"; readonly requestId: string }
  | {
      readonly status: "running";
      readonly requestId: string;
      readonly operationId: string;
      readonly deadlineAt: string;
      /** This tab asked the API to stop it and waits for the answer. */
      readonly stopping: boolean;
      /** The API could not be asked to stop it; it still runs. */
      readonly stopFailed: boolean;
    }
  | { readonly status: "ended"; readonly requestId: string; readonly end: ChatCompactionEnd };

/** The line the composer shows for a compaction. */
export interface ChatCompactionNotice {
  readonly tone: "progress" | "result" | "problem";
  readonly text: string;
}

/** How a compaction operation ended; null while it is still admitted or running. */
export function compactionEnd(operation: ChatOperation): ChatCompactionEnd | null {
  switch (operation.status) {
    case "accepted":
    case "running":
      return null;
    case "completed":
      if (operation.compaction?.outcome === "compacted") return { kind: "compacted" };
      if (operation.compaction?.reason === "stale") return { kind: "stale" };
      return { kind: "unchanged" };
    case "failed":
      return { kind: "failed" };
    case "interrupted":
      return { kind: "interrupted" };
    case "cancelled":
      return { kind: "cancelled" };
  }
}

const kept = "The assistant keeps its prior context.";
const notCompacted = `The working context could not be compacted. ${kept} Your visible conversation is unchanged.`;

function minutes(seconds: number | null): string {
  if (seconds === null) return "later";
  const count = Math.max(1, Math.ceil(seconds / 60));
  return count === 1 ? "in 1 minute" : `in ${String(count)} minutes`;
}

function refusal(code: ChatAdmissionCode, retryAfterSeconds: number | null): string {
  switch (code) {
    case "busy":
      return "A question or a compaction is still in progress. Try again when it has finished.";
    case "challenge_failed":
      return "The person check did not pass, so nothing was compacted. Try again.";
    case "quota_exceeded":
      return `You have asked many questions, and compacting counts as one. Try again ${minutes(retryAfterSeconds)}.`;
    case "budget_exhausted":
      return "The assistant reached its spending limit for now, so nothing was compacted.";
    case "rate_limited":
      return "Too many requests came in a short time. Try again in a moment.";
    default:
      return `The working context could not be compacted right now. ${kept}`;
  }
}

/** The line the composer shows for a compaction's state. */
export function describeCompaction(state: ChatCompactionState): ChatCompactionNotice {
  if (state.status === "preparing") {
    return { tone: "progress", text: "Compacting the working context…" };
  }
  if (state.status === "running") {
    if (state.stopFailed) {
      return { tone: "problem", text: "Compacting could not be stopped. It is still running." };
    }
    return {
      tone: "progress",
      text: state.stopping ? "Stopping the compaction…" : "Compacting the working context…",
    };
  }
  const { end } = state;
  switch (end.kind) {
    case "compacted":
      return {
        tone: "result",
        text: "The working context was compacted. Earlier exchanges are now a summary for the assistant; your visible conversation is unchanged.",
      };
    case "nothing":
      return {
        tone: "result",
        text: "There is nothing to compact yet. The working context is still small, so nothing was counted.",
      };
    case "stale":
      return {
        tone: "problem",
        text: `The conversation changed while compacting, so the summary was not used. ${kept}`,
      };
    case "unchanged":
      return { tone: "result", text: `The working context was left as it was. ${kept}` };
    case "failed":
    case "interrupted":
      return { tone: "problem", text: notCompacted };
    case "cancelled":
      return { tone: "result", text: `Compacting was stopped. ${kept}` };
    case "refused":
      return { tone: "problem", text: refusal(end.code, end.retryAfterSeconds) };
  }
}
