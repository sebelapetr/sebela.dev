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
      announcement: "Answering…",
    });
  });

  it("shows a streaming answer as answering, apart from a pending one", () => {
    expect(describeChatTurn(turnFrom([start, partial]))).toMatchObject({
      state: "streaming",
      tag: "Answering",
      note: null,
      retry: false,
    });
  });

  it("shows an answered turn without a tag and announces its text", () => {
    expect(describeChatTurn(completed("answered"))).toEqual({
      state: "answered",
      tag: null,
      note: null,
      retry: false,
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
      announcement: "Partial",
    });
  });

  it("labels an interrupted partial answer as incomplete and offers a retry", () => {
    expect(describeChatTurn(endChatStream(turnFrom([start, partial])))).toEqual({
      state: "interrupted",
      tag: "Incomplete",
      note: "The answer stopped before it finished.",
      retry: true,
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
  ])("explains a retryable %s error and offers a retry", (code, note) => {
    expect(describeChatTurn(failed(code, true))).toEqual({
      state: "failed",
      tag: "Incomplete",
      note,
      retry: true,
      announcement: `${note} You can try again.`,
    });
  });

  it("offers no retry where the error says it cannot help, and says what to do instead", () => {
    expect(describeChatTurn(failed("invalid_request", false, false))).toEqual({
      state: "failed",
      tag: "Not answered",
      note: "This question could not be sent. Try asking something else.",
      retry: false,
      announcement: "This question could not be sent. Try asking something else.",
    });
  });
});
