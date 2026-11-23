import { describe, expect, it } from "vitest";

import type { ChatUsage } from "@sebela/contracts";

import {
  answeredWith,
  chatUsageRefreshAt,
  describeChatUsage,
  parseChatUsage,
  readChatUsageState,
  type ChatUsageState,
} from "./usage";

const SERVER = "2026-11-22T14:00:00.000Z";
const serverMs = Date.parse(SERVER);
/** The browser's clock runs 5 s behind the server's. */
const LOCAL = serverMs - 5_000;
const OPERATION = "22222222-0000-4000-8000-000000000001";

function usage(fields: Partial<ChatUsage> = {}): ChatUsage {
  return {
    serverTime: SERVER,
    model: { name: "fictional-model", effort: "medium" },
    rollingTwoHours: { used: 6, limit: 10, percent: 60, nextReleaseAt: "2026-11-22T14:25:00.000Z" },
    utcDay: { used: 6, limit: 30, percent: 20, resetsAt: "2026-11-23T00:00:00.000Z" },
    activeOperation: null,
    restriction: null,
    context: { status: "unavailable" },
    nextRequest: { status: "unavailable" },
    ...fields,
  };
}

function ready(fields: Partial<ChatUsage> = {}, stale = false): ChatUsageState {
  return { status: "ready", usage: usage(fields), offsetMs: 5_000, readAt: LOCAL, stale };
}

describe("parseChatUsage", () => {
  it("reads a snapshot the contract allows", () => {
    expect(parseChatUsage(usage())).toEqual(usage());
  });

  it("refuses one it does not, such as a meter beyond its limit", () => {
    expect(
      parseChatUsage({
        ...usage(),
        rollingTwoHours: { used: 11, limit: 10, percent: 100, nextReleaseAt: null },
      }),
    ).toBeNull();
    expect(parseChatUsage({ used: 0 })).toBeNull();
  });
});

describe("readChatUsageState", () => {
  it("keeps the server's clock against the browser's, so timings count from the server's time", () => {
    expect(readChatUsageState(usage(), LOCAL)).toEqual({
      status: "ready",
      usage: usage(),
      offsetMs: 5_000,
      readAt: LOCAL,
      stale: false,
    });
  });
});

describe("describeChatUsage", () => {
  it("shows both meters with counts, percentages and when capacity comes back, from the server's clock", () => {
    const view = describeChatUsage(ready(), LOCAL);

    expect(view.status).toBe("ready");
    expect(view.meters).toEqual([
      {
        id: "two_hours",
        label: "Last 2 hours",
        value: "6 of 10 questions",
        percent: 60,
        percentText: "60%",
        level: "neutral",
        state: null,
        timing: "Next one frees up at 14:25 UTC (in 25 min)",
      },
      {
        id: "day",
        label: "Today (UTC)",
        value: "6 of 30 questions",
        percent: 20,
        percentText: "20%",
        level: "neutral",
        state: null,
        timing: "Resets at 00:00 UTC (in 10 h)",
      },
    ]);
    expect(view.summary).toEqual({ text: "2 h 6/10 · today 6/30", note: null, level: "neutral" });
  });

  it("warns strictly above 70% and is critical strictly above 90%, said in words", () => {
    const at = (used: number) =>
      describeChatUsage(
        ready({
          rollingTwoHours: { used, limit: 10, percent: used * 10, nextReleaseAt: null },
        }),
        LOCAL,
      ).meters[0];

    expect(at(7)).toMatchObject({ level: "neutral", state: null, timing: null });
    expect(at(8)).toMatchObject({ level: "warning", state: "Over 70% used" });
    expect(at(9)).toMatchObject({ level: "warning", state: "Over 70% used" });
    expect(at(10)).toMatchObject({ level: "critical", state: "Limit reached" });

    const day = (used: number) =>
      describeChatUsage(
        ready({
          utcDay: {
            used,
            limit: 30,
            percent: (used * 100) / 30,
            resetsAt: "2026-11-23T00:00:00.000Z",
          },
        }),
        LOCAL,
      );
    expect(day(21).meters[1]).toMatchObject({ level: "neutral", percentText: "70%" });
    expect(day(22).meters[1]).toMatchObject({ level: "warning", percentText: "73%" });
    expect(day(28).meters[1]).toMatchObject({
      level: "critical",
      state: "Over 90% used",
      percentText: "93%",
    });
    expect(day(28).summary).toEqual({
      text: "2 h 6/10 · today 28/30",
      note: "Over 90% used",
      level: "critical",
    });
    expect(day(22).summary.note).toBe("Over 70% used");
  });

  it("names the visitor's own limit, when it may pass again, without another model call", () => {
    const view = describeChatUsage(
      ready({
        rollingTwoHours: {
          used: 10,
          limit: 10,
          percent: 100,
          nextReleaseAt: "2026-11-22T14:25:00.000Z",
        },
        restriction: { reason: "two_hours", retryAt: "2026-11-22T14:25:00.000Z" },
      }),
      LOCAL,
    );

    expect(view.restriction).toEqual({
      text: "You reached 10 questions in 2 hours. You can ask again at 14:25 UTC (in 25 min).",
      personal: true,
      contact: false,
    });
    expect(view.summary).toEqual({
      text: "2 h 10/10 · today 6/30",
      note: "Limit reached",
      level: "critical",
    });
  });

  it("names each personal limit and offers contact for the day's", () => {
    const restricted = (reason: "minute" | "day", retryAt: string) =>
      describeChatUsage(ready({ restriction: { reason, retryAt } }), LOCAL).restriction;

    expect(restricted("minute", "2026-11-22T14:00:40.000Z")).toEqual({
      text: "You asked several questions in a short time. You can ask again at 14:00 UTC (in under a minute).",
      personal: true,
      contact: false,
    });
    expect(restricted("day", "2026-11-23T00:00:00.000Z")).toEqual({
      text: "You reached 30 questions today (UTC). You can ask again at 00:00 UTC (in 10 h).",
      personal: true,
      contact: true,
    });
  });

  it("tells a shared or site-wide limit apart from the visitor's own meter, without amounts", () => {
    const restricted = (reason: "shared_network" | "service_budget", retryAt: string) =>
      describeChatUsage(ready({ restriction: { reason, retryAt } }), LOCAL);

    const network = restricted("shared_network", "2026-11-22T15:30:00.000Z");
    expect(network.restriction).toEqual({
      text: "Many questions came from your network, so the assistant is paused for it. This is not your own usage. You can ask again at 15:30 UTC (in 1 h 30 min).",
      personal: false,
      contact: true,
    });
    expect(network.summary).toEqual({
      text: "2 h 6/10 · today 6/30",
      note: "Paused",
      level: "neutral",
    });

    const budget = restricted("service_budget", "2026-12-01T00:00:00.000Z");
    expect(budget.restriction).toEqual({
      text: "The assistant reached its spending limit for now. This is not your own usage. You can ask again on 1 Dec at 00:00 UTC.",
      personal: false,
      contact: true,
    });
    expect(JSON.stringify(budget)).not.toMatch(/\$|USD/);
  });

  it("says an answer in progress already counts", () => {
    const view = describeChatUsage(
      ready({
        activeOperation: {
          operationId: OPERATION,
          requestId: "11111111-0000-4000-8000-000000000001",
          status: "running",
          deadlineAt: "2026-11-22T14:02:00.000Z",
          assistantMessageId: "33333333-0000-4000-8000-000000000001",
          kind: "answer",
          compaction: null,
        },
      }),
      LOCAL,
    );

    expect(view.active).toBe("An answer is being prepared. Its question already counts.");
    expect(describeChatUsage(ready(), LOCAL).active).toBeNull();
  });

  it("says a compaction in progress already counts as a question", () => {
    const view = describeChatUsage(
      ready({
        activeOperation: {
          operationId: OPERATION,
          requestId: "11111111-0000-4000-8000-000000000001",
          status: "running",
          deadlineAt: "2026-11-22T14:02:00.000Z",
          assistantMessageId: null,
          kind: "compaction",
          compaction: null,
        },
      }),
      LOCAL,
    );

    expect(view.active).toBe(
      "The working context is being compacted. It already counts as a question.",
    );
  });

  it("shows the read-only model and effort the server is configured with", () => {
    expect(describeChatUsage(ready(), LOCAL).model).toBe("fictional-model, medium effort");
  });

  it("labels context as the last main call's input against its cap, the provider's count first", () => {
    const view = describeChatUsage(
      ready({
        context: {
          status: "measured",
          operationId: OPERATION,
          measuredAt: "2026-11-22T13:58:00.000Z",
          estimatedInputTokens: 12_345,
          reportedInputTokens: 12_400,
          capTokens: 16_000,
        },
      }),
      LOCAL,
    );

    expect(view.context).toEqual({
      status: "measured",
      value: "12,400 of 16,000 input tokens",
      kind: "Reported by the model provider",
      percent: 78,
      percentText: "78%",
      level: "warning",
      details: [
        { label: "Reported by the model provider", value: "12,400 tokens" },
        { label: "Tokenizer estimate", value: "12,345 tokens" },
        { label: "Input cap", value: "16,000 tokens" },
        { label: "Measured", value: "13:58 UTC" },
      ],
    });
  });

  it("marks an estimate as one when the provider reported nothing", () => {
    const view = describeChatUsage(
      ready({
        context: {
          status: "measured",
          operationId: OPERATION,
          measuredAt: "2026-11-22T13:58:00.000Z",
          estimatedInputTokens: 15_500,
          reportedInputTokens: null,
          capTokens: 16_000,
        },
      }),
      LOCAL,
    );

    expect(view.context).toMatchObject({
      value: "About 15,500 of 16,000 input tokens",
      kind: "Tokenizer estimate",
      percentText: "97%",
      level: "critical",
    });
    expect(view.context.details[0]).toEqual({
      label: "Reported by the model provider",
      value: "Not reported",
    });
  });

  it("shows missing measurements as unavailable, never as zero", () => {
    const view = describeChatUsage(ready(), LOCAL);

    expect(view.context).toEqual({
      status: "unavailable",
      value: "Unavailable",
      kind: null,
      percent: null,
      percentText: null,
      level: null,
      details: [],
    });
    expect(view.nextRequest).toEqual({
      status: "unavailable",
      value: "Unavailable",
      note: "Shown after /compact has summarized the working context.",
      measured: null,
    });
  });

  it("labels the post-compaction estimate as history only, never claiming future tool tokens", () => {
    const view = describeChatUsage(
      ready({
        nextRequest: {
          status: "estimated",
          historyTokens: 1234,
          operationId: OPERATION,
          measuredAt: "2026-11-22T13:58:00.000Z",
        },
      }),
      LOCAL,
    );

    expect(view.nextRequest).toEqual({
      status: "estimated",
      value: "About 1,234 tokens of history",
      note: "The summary and the exchanges kept word for word. Your next question, the instructions, tool results and evidence come on top; they are not known yet.",
      measured: "Measured at 13:58 UTC",
    });
  });

  it("labels a snapshot that could not be read again as not up to date, keeping its numbers", () => {
    const view = describeChatUsage(ready({}, true), LOCAL);

    expect(view.stale).toBe("Not up to date. Last read at 14:00 UTC; it could not be read again.");
    expect(view.meters[0]?.value).toBe("6 of 10 questions");
    expect(describeChatUsage(ready(), LOCAL).stale).toBeNull();
  });

  it("shows nothing it does not know while loading or when the usage cannot be read", () => {
    for (const status of ["loading", "unavailable"] as const) {
      const view = describeChatUsage({ status }, LOCAL);
      expect(view).toMatchObject({
        status,
        meters: [],
        model: null,
        restriction: null,
        active: null,
        stale: null,
      });
      expect(JSON.stringify(view)).not.toMatch(/\b0\b/);
    }
    expect(describeChatUsage({ status: "loading" }, LOCAL).summary).toEqual({
      text: "Usage",
      note: "Loading",
      level: "neutral",
    });
    expect(describeChatUsage({ status: "unavailable" }, LOCAL).summary).toEqual({
      text: "Usage",
      note: "Unavailable",
      level: "neutral",
    });
  });
});

describe("chatUsageRefreshAt", () => {
  it("reads again when the earliest of release, reset and retry comes, on the browser's clock", () => {
    expect(chatUsageRefreshAt(ready(), LOCAL)).toBe(Date.parse("2026-11-22T14:25:00.000Z") - 5_000);
    expect(
      chatUsageRefreshAt(
        ready({ restriction: { reason: "minute", retryAt: "2026-11-22T14:00:40.000Z" } }),
        LOCAL,
      ),
    ).toBe(Date.parse("2026-11-22T14:00:40.000Z") - 5_000);
    expect(
      chatUsageRefreshAt(
        ready({ rollingTwoHours: { used: 0, limit: 10, percent: 0, nextReleaseAt: null } }),
        LOCAL,
      ),
    ).toBe(Date.parse("2026-11-23T00:00:00.000Z") - 5_000);
  });

  it("never schedules a read without a snapshot", () => {
    expect(chatUsageRefreshAt({ status: "loading" }, LOCAL)).toBeNull();
    expect(chatUsageRefreshAt({ status: "unavailable" }, LOCAL)).toBeNull();
  });
});

describe("answeredWith", () => {
  const current = { name: "fictional-model", effort: "medium" };

  it("names the model of an answer produced under another configuration", () => {
    expect(answeredWith({ name: "older-fictional-model", effort: "low" }, current)).toBe(
      "Answered with older-fictional-model, low effort",
    );
    expect(answeredWith({ name: "fictional-model", effort: "high" }, current)).toBe(
      "Answered with fictional-model, high effort",
    );
    expect(answeredWith({ name: "older-fictional-model", effort: null }, current)).toBe(
      "Answered with older-fictional-model",
    );
  });

  it("says nothing for the current configuration, an unrecorded model or an unknown one", () => {
    expect(answeredWith({ name: "fictional-model", effort: "medium" }, current)).toBeNull();
    expect(answeredWith(null, current)).toBeNull();
    expect(answeredWith({ name: "older-fictional-model", effort: "low" }, null)).toBeNull();
  });
});
