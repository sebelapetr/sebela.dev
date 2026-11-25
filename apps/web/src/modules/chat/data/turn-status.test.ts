import { describe, expect, it } from "vitest";

import { endChatStream, receiveChatEvent, startChatTurn, type ChatTurn } from "./conversation";
import { describeChatTurn } from "./turn-status";

const REQUEST = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const MESSAGE = "9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f";

function event(eventId: number, fields: Record<string, unknown>) {
  return { requestId: REQUEST, messageId: MESSAGE, eventId, ...fields };
}

function turnFrom(events: unknown[]): ChatTurn {
  return events.reduce<ChatTurn>(
    (current, raw) => receiveChatEvent(current, raw),
    startChatTurn(REQUEST, "Q?"),
  );
}

const start = event(0, { type: "start" });
const partial = event(1, { type: "text_delta", text: "Partial" });

function completed(outcome: string): ChatTurn {
  return turnFrom([start, partial, event(2, { type: "complete", outcome })]);
}

function failed(code: string, retryable: boolean, withText = true): ChatTurn {
  return turnFrom(
    withText
      ? [start, partial, event(2, { type: "error", code, retryable })]
      : [event(0, { type: "error", code, retryable })],
  );
}

describe("describeChatTurn", () => {
  it("shows a pending answer without a tag (its placeholder says it is answering)", () => {
    expect(describeChatTurn(startChatTurn(REQUEST, "Q?"))).toEqual({
      state: "pending",
      tag: null,
      note: null,
      retry: false,
      showsEvidence: true,
      contact: false,
      announcement: "Answering…",
    });
  });

  it("shows a streaming answer as answering, apart from a pending one", () => {
    expect(describeChatTurn(turnFrom([start, partial]))).toMatchObject({
      state: "streaming",
      tag: "Answering",
      note: null,
      retry: false,
      showsEvidence: true,
    });
  });

  it("shows an answered turn without a tag and announces its text", () => {
    expect(describeChatTurn(completed("answered"))).toEqual({
      state: "answered",
      tag: null,
      note: null,
      retry: false,
      showsEvidence: true,
      contact: false,
      announcement: "Partial",
    });
  });

  it.each([
    ["insufficient_evidence", "Not enough evidence"],
    ["refused", "Declined"],
    ["unavailable", "Unavailable"],
  ])("labels a %s completion, which is a final answer and never retried", (outcome, tag) => {
    expect(describeChatTurn(completed(outcome))).toMatchObject({
      state: outcome,
      tag,
      note: null,
      retry: false,
      showsEvidence: true,
      announcement: "Partial",
    });
  });

  it("labels an interrupted partial answer as incomplete and offers a retry", () => {
    expect(describeChatTurn(endChatStream(turnFrom([start, partial])))).toEqual({
      state: "interrupted",
      tag: "Incomplete",
      note: "The answer stopped before it finished.",
      retry: true,
      showsEvidence: false,
      contact: false,
      announcement: "The answer stopped before it finished. You can try again.",
    });
  });

  it("labels an answer that ended before any text as not answered", () => {
    expect(describeChatTurn(endChatStream(startChatTurn(REQUEST, "Q?")))).toMatchObject({
      state: "interrupted",
      tag: "Not answered",
      retry: true,
    });
  });

  it.each([
    ["timeout", "The answer took too long."],
    ["rate_limited", "Too many questions in a short time."],
    ["unavailable", "The assistant is unavailable right now."],
    ["invalid_stream", "The answer could not be read."],
    ["internal", "Something went wrong while answering."],
    ["cancelled", "The answer was stopped."],
  ])("explains a retryable %s error and offers a retry", (code, note) => {
    expect(describeChatTurn(failed(code, true))).toEqual({
      state: "failed",
      tag: "Incomplete",
      note,
      retry: true,
      showsEvidence: false,
      contact: false,
      announcement: `${note} You can try again.`,
    });
  });

  it("offers no retry where the error says it cannot help, and says what to do instead", () => {
    expect(describeChatTurn(failed("invalid_request", false, false))).toEqual({
      state: "failed",
      tag: "Not answered",
      note: "This question could not be sent. Try asking something else.",
      retry: false,
      showsEvidence: false,
      contact: false,
      announcement: "This question could not be sent. Try asking something else.",
    });
  });

  it("hides the cards, sources and related pages that arrived before a failure or an interruption", () => {
    const block = event(2, {
      type: "block",
      block: {
        type: "ServiceCard",
        title: "Fictional automation",
        summary: "Made up.",
        href: "/services#service-automation",
      },
    });
    const sources = event(3, {
      type: "sources",
      sources: [
        {
          record: { kind: "experience", id: "harbor-logistics" },
          title: "Harbor Logistics",
          href: "/experience#experience-harbor-logistics",
        },
      ],
    });
    const related = event(4, { type: "related", links: [{ label: "CV", href: "/cv" }] });
    const streamed = turnFrom([start, partial, block, sources, related]);
    expect(streamed.blocks).toHaveLength(1);
    expect(streamed.sources).toHaveLength(1);
    expect(describeChatTurn(streamed).showsEvidence).toBe(true);
    expect(describeChatTurn(endChatStream(streamed))).toMatchObject({
      state: "interrupted",
      showsEvidence: false,
    });
    const failed = receiveChatEvent(
      streamed,
      event(5, { type: "error", code: "internal", retryable: true }),
    );
    expect(describeChatTurn(failed)).toMatchObject({ state: "failed", showsEvidence: false });
  });

  it("tells a refusal apart from an unavailable assistant", () => {
    expect(describeChatTurn(completed("refused")).tag).toBe("Declined");
    expect(describeChatTurn(failed("unavailable", true)).note).toBe(
      "The assistant is unavailable right now.",
    );
    expect(describeChatTurn(completed("refused")).tag).not.toBe(
      describeChatTurn(completed("unavailable")).tag,
    );
  });
});

/** A question the API did not admit, as the store keeps it. */
function rejected(code: string, retryable: boolean, retryAfterSeconds?: number): ChatTurn {
  return {
    ...startChatTurn(REQUEST, "Q?"),
    status: "failed",
    error: {
      code,
      retryable,
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    } as ChatTurn["error"],
  };
}

describe("describeChatTurn for a question that was not admitted", () => {
  it("offers a safe retry and the contact link after a failed person check, with no answer", () => {
    expect(describeChatTurn(rejected("challenge_failed", true))).toEqual({
      state: "failed",
      tag: "Not answered",
      note: "We could not confirm that a person sent this question.",
      retry: true,
      showsEvidence: false,
      contact: true,
      announcement: "We could not confirm that a person sent this question. You can try again.",
    });
  });

  it("says another question is still being answered", () => {
    expect(describeChatTurn(rejected("busy", true))).toMatchObject({
      note: "Another question is still being answered.",
      retry: true,
      contact: false,
    });
  });

  it.each([
    [120, "You have asked many questions. Try again in 2 minutes."],
    [61, "You have asked many questions. Try again in 2 minutes."],
    [30, "You have asked many questions. Try again in 1 minute."],
    [undefined, "You have asked many questions. Try again later."],
  ])("says when the visitor's allowance comes back (%s s)", (seconds, note) => {
    expect(describeChatTurn(rejected("quota_exceeded", true, seconds))).toMatchObject({
      note,
      retry: true,
    });
  });

  it("says the site's budget is spent, offers the contact link and no retry", () => {
    expect(describeChatTurn(rejected("budget_exhausted", false))).toMatchObject({
      note: "The assistant cannot answer more questions today.",
      retry: false,
      contact: true,
      announcement: "The assistant cannot answer more questions today.",
    });
  });

  it("says a conflicting request could not be sent and offers no retry", () => {
    expect(describeChatTurn(rejected("conflict", false))).toMatchObject({
      note: "This question could not be sent. Try asking something else.",
      retry: false,
      contact: false,
    });
  });

  it("says an answer can no longer be asked again and offers no retry", () => {
    expect(describeChatTurn(rejected("not_retryable", false))).toMatchObject({
      note: "This answer can no longer be asked again. Try asking something else.",
      retry: false,
      contact: false,
    });
  });
});
