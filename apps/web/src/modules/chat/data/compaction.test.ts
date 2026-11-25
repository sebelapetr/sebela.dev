import { describe, expect, it } from "vitest";

import type { ChatOperation } from "@sebela/contracts";

import { compactionEnd, describeCompaction, type ChatCompactionState } from "./compaction";

const REQUEST = "11111111-0000-4000-8000-000000000001";
const OPERATION = "22222222-0000-4000-8000-000000000001";

function operation(fields: Partial<ChatOperation>): ChatOperation {
  return {
    operationId: OPERATION,
    requestId: REQUEST,
    kind: "compaction",
    status: "completed",
    deadlineAt: "2026-11-22T14:02:00.000Z",
    assistantMessageId: null,
    compaction: null,
    ...fields,
  };
}

describe("compactionEnd", () => {
  it("has no end while the compaction is still admitted or running", () => {
    expect(compactionEnd(operation({ status: "accepted" }))).toBeNull();
    expect(compactionEnd(operation({ status: "running" }))).toBeNull();
  });

  it.each([
    [{ status: "completed", compaction: { outcome: "compacted", reason: null } }, "compacted"],
    [{ status: "completed", compaction: { outcome: "unchanged", reason: "stale" } }, "stale"],
    [{ status: "completed", compaction: { outcome: "unchanged", reason: "small" } }, "unchanged"],
    [{ status: "completed", compaction: null }, "unchanged"],
    [{ status: "failed", compaction: { outcome: "failed", reason: "provider" } }, "failed"],
    [{ status: "interrupted" }, "interrupted"],
    [{ status: "cancelled" }, "cancelled"],
  ] as const)("maps the operation %o to %s", (fields, kind) => {
    expect(compactionEnd(operation(fields))).toEqual({ kind });
  });
});

function ended(end: Extract<ChatCompactionState, { status: "ended" }>["end"]): ChatCompactionState {
  return { status: "ended", requestId: REQUEST, end };
}

const kept = "The assistant keeps its prior context.";

describe("describeCompaction", () => {
  it("shows progress while it is checked, sent and running, and while it is being stopped", () => {
    expect(describeCompaction({ status: "preparing", requestId: REQUEST })).toEqual({
      tone: "progress",
      text: "Compacting the working context…",
    });
    const running: ChatCompactionState = {
      status: "running",
      requestId: REQUEST,
      operationId: OPERATION,
      deadlineAt: "2026-11-22T14:02:00.000Z",
      stopping: false,
      stopFailed: false,
    };
    expect(describeCompaction(running)).toEqual({
      tone: "progress",
      text: "Compacting the working context…",
    });
    expect(describeCompaction({ ...running, stopping: true })).toEqual({
      tone: "progress",
      text: "Stopping the compaction…",
    });
    expect(describeCompaction({ ...running, stopFailed: true })).toEqual({
      tone: "problem",
      text: "Compacting could not be stopped. It is still running.",
    });
  });

  it("says a compaction kept the visible conversation, with no claim about future tool tokens", () => {
    expect(describeCompaction(ended({ kind: "compacted" }))).toEqual({
      tone: "result",
      text: "The working context was compacted. Earlier exchanges are now a summary for the assistant; your visible conversation is unchanged.",
    });
  });

  it.each([
    [
      { kind: "nothing" },
      "result",
      "There is nothing to compact yet. The working context is still small, so nothing was counted.",
    ],
    [
      { kind: "stale" },
      "problem",
      `The conversation changed while compacting, so the summary was not used. ${kept}`,
    ],
    [{ kind: "unchanged" }, "result", `The working context was left as it was. ${kept}`],
    [
      { kind: "failed" },
      "problem",
      `The working context could not be compacted. ${kept} Your visible conversation is unchanged.`,
    ],
    [
      { kind: "interrupted" },
      "problem",
      `The working context could not be compacted. ${kept} Your visible conversation is unchanged.`,
    ],
    [{ kind: "cancelled" }, "result", `Compacting was stopped. ${kept}`],
  ] as const)("describes the end %o calmly", (end, tone, text) => {
    expect(describeCompaction(ended(end))).toEqual({ tone, text });
  });

  it.each([
    [
      "busy",
      null,
      "A question or a compaction is still in progress. Try again when it has finished.",
    ],
    [
      "challenge_failed",
      null,
      "The person check did not pass, so nothing was compacted. Try again.",
    ],
    [
      "quota_exceeded",
      90,
      "You have asked many questions, and compacting counts as one. Try again in 2 minutes.",
    ],
    [
      "quota_exceeded",
      null,
      "You have asked many questions, and compacting counts as one. Try again later.",
    ],
    [
      "budget_exhausted",
      null,
      "The assistant reached its spending limit for now, so nothing was compacted.",
    ],
    ["rate_limited", null, "Too many requests came in a short time. Try again in a moment."],
    ["unavailable", null, `The working context could not be compacted right now. ${kept}`],
  ] as const)("describes a %s refusal", (code, retryAfterSeconds, text) => {
    expect(describeCompaction(ended({ kind: "refused", code, retryAfterSeconds }))).toEqual({
      tone: "problem",
      text,
    });
  });
});
