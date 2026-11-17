import { describe, expect, it } from "vitest";

import { validateChatStream, type ChatStreamEvent, type ChatSubmission } from "@sebela/contracts";

import { createMockChatAdapter } from "./mock-adapter";
import { askSuggestions, preparedAnswer } from "./prepared-answers";

const NAME = "Casey Morrow";

function submission(question: string): ChatSubmission {
  return {
    conversationId: "6f1c3a52-8f0b-4e1d-9a7c-2b4d5e6f7a80",
    requestId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
    question,
  };
}

function sequentialIds(): () => string {
  let next = 0;
  return () => `00000000-0000-4000-8000-${String(next++).padStart(12, "0")}`;
}

const noWait = () => Promise.resolve();

async function collect(iterable: AsyncIterable<unknown>): Promise<unknown[]> {
  const events: unknown[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

function adapter() {
  return createMockChatAdapter({ subjectName: NAME, wait: noWait, createId: sequentialIds() });
}

describe("createMockChatAdapter", () => {
  it("streams a complete, valid attempt for the submitted request", async () => {
    const sent = submission("What is Casey Morrow working on now?");
    const events = await collect(adapter().send(sent, { signal: new AbortController().signal }));

    const result = validateChatStream(sent.requestId, events);
    expect(result.status).toBe("complete");
  });

  it("starts, streams the prepared text in several deltas, links onward and completes", async () => {
    const [first] = askSuggestions(NAME);
    if (first === undefined) throw new Error("no suggestions");
    const question = first.question;
    const sent = submission(question);
    const events = (await collect(
      adapter().send(sent, { signal: new AbortController().signal }),
    )) as ChatStreamEvent[];
    const expected = preparedAnswer(NAME, question);

    expect(events[0]?.type).toBe("start");
    const deltas = events.filter((event) => event.type === "text_delta");
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.map((event) => event.text).join("")).toBe(expected.text);
    expect(events.find((event) => event.type === "related")).toMatchObject({
      links: expected.related,
    });
    expect(events.at(-1)).toMatchObject({ type: "complete", outcome: expected.outcome });
  });

  it("answers an unknown question with the not-connected reply as an unavailable outcome", async () => {
    const sent = submission("Which fictional planet is nicest?");
    const events = await collect(adapter().send(sent, { signal: new AbortController().signal }));

    const result = validateChatStream(sent.requestId, events);
    expect(result).toMatchObject({
      status: "complete",
      terminal: { type: "complete", outcome: "unavailable" },
    });
  });

  it("gives each attempt its own assistant message", async () => {
    const mock = adapter();
    const signal = new AbortController().signal;
    const first = (await collect(mock.send(submission("One?"), { signal }))) as ChatStreamEvent[];
    const second = (await collect(mock.send(submission("Two?"), { signal }))) as ChatStreamEvent[];

    expect(first[0]?.messageId).not.toBe(second[0]?.messageId);
  });

  it("waits between deltas so the answer streams", async () => {
    const waits: number[] = [];
    const mock = createMockChatAdapter({
      subjectName: NAME,
      chunkDelayMs: 30,
      wait: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
      createId: sequentialIds(),
    });

    await collect(mock.send(submission("One?"), { signal: new AbortController().signal }));

    expect(waits.length).toBeGreaterThan(1);
    expect(waits.every((ms) => ms === 30)).toBe(true);
  });

  it("stops yielding once the request is aborted, leaving an interrupted stream", async () => {
    const controller = new AbortController();
    const sent = submission("What is Casey Morrow working on now?");
    const events: unknown[] = [];
    for await (const event of adapter().send(sent, { signal: controller.signal })) {
      events.push(event);
      if (events.length === 2) controller.abort();
    }

    expect(events).toHaveLength(2);
    expect(validateChatStream(sent.requestId, events).status).toBe("interrupted");
  });
});
