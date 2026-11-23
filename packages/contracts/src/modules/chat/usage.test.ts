import { describe, expect, it } from "vitest";

import { ChatUsageSchema, chatRestrictionReasons, chatUsageLevel } from "./index.js";

// Fictional identifiers only.
const operationId = "7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c21";
const requestId = "5f1d2a33-1c4b-4b8e-8d3f-2b9e6a7c4d21";
const messageId = "c2e4f6a8-0b1d-4c3e-9f5a-7b9d1f3e5a70";

const usage = {
  serverTime: "2031-03-10T12:00:00.000Z",
  model: { name: "fictional-model", effort: "medium" },
  rollingTwoHours: {
    used: 8,
    limit: 10,
    percent: 80,
    nextReleaseAt: "2031-03-10T12:30:00.000Z",
  },
  utcDay: { used: 8, limit: 30, percent: (8 * 100) / 30, resetsAt: "2031-03-11T00:00:00.000Z" },
  activeOperation: {
    operationId,
    requestId,
    kind: "answer",
    status: "running",
    deadlineAt: "2031-03-10T12:01:00.000Z",
    assistantMessageId: messageId,
    compaction: null,
  },
  restriction: null,
  context: {
    status: "measured",
    operationId,
    measuredAt: "2031-03-10T11:58:00.000Z",
    estimatedInputTokens: 6400,
    reportedInputTokens: 6512,
    capTokens: 16000,
  },
  nextRequest: { status: "unavailable" },
};

describe("ChatUsageSchema", () => {
  it("describes the caller's meters, the effective model and the last main-call context", () => {
    expect(ChatUsageSchema.parse(usage)).toEqual(usage);
  });

  it("labels a missing context measurement as unavailable instead of zero", () => {
    const unavailable = { ...usage, context: { status: "unavailable" } };
    expect(ChatUsageSchema.parse(unavailable)).toEqual(unavailable);
    expect(
      ChatUsageSchema.safeParse({
        ...usage,
        context: { status: "unavailable", estimatedInputTokens: 0 },
      }).success,
    ).toBe(false);
  });

  it("labels the next request's history after a compaction as an estimate", () => {
    const estimated = {
      ...usage,
      nextRequest: {
        status: "estimated",
        historyTokens: 1800,
        operationId,
        measuredAt: "2031-03-10T11:59:00.000Z",
      },
    };
    expect(ChatUsageSchema.parse(estimated)).toEqual(estimated);
  });

  it("names the limiting reason and when an admission may pass again", () => {
    for (const reason of chatRestrictionReasons) {
      const restricted = {
        ...usage,
        restriction: { reason, retryAt: "2031-03-10T12:30:00.000Z" },
      };
      expect(ChatUsageSchema.parse(restricted)).toEqual(restricted);
    }
    expect(chatRestrictionReasons).toEqual([
      "minute",
      "two_hours",
      "day",
      "shared_network",
      "service_budget",
    ]);
  });

  it.each([
    ["a global spend balance", { ...usage, globalSpendUsd: 1.2 }],
    ["another visitor's counts", { ...usage, fingerprint: { used: 40, limit: 100 } }],
    [
      "a restriction carrying a budget amount",
      {
        ...usage,
        restriction: {
          reason: "service_budget",
          retryAt: "2031-03-11T00:00:00.000Z",
          remainingUsd: 0.01,
        },
      },
    ],
    [
      "a meter over its limit",
      { ...usage, rollingTwoHours: { ...usage.rollingTwoHours, used: 11, percent: 110 } },
    ],
    ["a measured context without a cap", { ...usage, context: { ...usage.context, capTokens: 0 } }],
    [
      "a next-request estimate without its history tokens",
      { ...usage, nextRequest: { status: "estimated" } },
    ],
    [
      "a next-request estimate claiming future tool tokens",
      {
        ...usage,
        nextRequest: {
          status: "estimated",
          historyTokens: 1800,
          toolTokens: 900,
          operationId,
          measuredAt: "2031-03-10T11:59:00.000Z",
        },
      },
    ],
    [
      "a next-request estimate of the whole input",
      {
        ...usage,
        nextRequest: {
          status: "estimated",
          historyTokens: 1800,
          inputTokens: 6000,
          operationId,
          measuredAt: "2031-03-10T11:59:00.000Z",
        },
      },
    ],
  ])("refuses %s", (_name, body) => {
    expect(ChatUsageSchema.safeParse(body).success).toBe(false);
  });
});

describe("chatUsageLevel", () => {
  it.each([
    [0, 10, "neutral"],
    [7, 10, "neutral"],
    [21, 30, "neutral"],
    [22, 30, "warning"],
    [8, 10, "warning"],
    [9, 10, "warning"],
    [28, 30, "critical"],
    [10, 10, "critical"],
  ] as const)(
    "%i of %i is %s: strictly above 70 percent warns, above 90 percent is critical",
    (used, limit, level) => {
      expect(chatUsageLevel(used, limit)).toBe(level);
    },
  );
});
