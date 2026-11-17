import { describe, expect, it } from "vitest";

import { validateChatStream, type ChatStreamEvent, type ChatSubmission } from "@sebela/contracts";

import type { AskEvidence } from "./evidence";
import { createMockChatAdapter } from "./mock-adapter";
import { askSuggestions, preparedAnswer } from "./prepared-answers";

const NAME = "Casey Morrow";

const EVIDENCE: AskEvidence = {
  name: NAME,
  contact: { email: "casey@morrow.example.test", links: [] },
  experiences: [
    {
      slug: "lead-engineer",
      title: "Lead engineer",
      organization: "Fictional Freight",
      startedOn: "2022-03-01",
      endedOn: null,
      summary: "Leads a fictional team.",
      technologies: ["TypeScript"],
      projects: [{ slug: "route-planner", name: "Route planner", caseStudy: true }],
    },
  ],
  services: [{ slug: "process-automation", name: "Process automation", summary: "Automates." }],
  explorations: [
    { slug: "answer-checker", name: "Answer checker", summary: "Checks.", status: "built" },
    { slug: "tool-scopes", name: "Tool scopes", summary: "Plans.", status: "designed" },
  ],
  technologyGroups: ["core", "ai-engineering-focus"],
};

const QUESTIONS = [...askSuggestions(NAME).map((suggestion) => suggestion.question), "Unknown?"];

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
  return createMockChatAdapter({ evidence: EVIDENCE, wait: noWait, createId: sequentialIds() });
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
    const expected = preparedAnswer(EVIDENCE, question);

    expect(events[0]?.type).toBe("start");
    const deltas = events.filter((event) => event.type === "text_delta");
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.map((event) => event.text).join("")).toBe(expected.text);
    expect(events.find((event) => event.type === "related")).toMatchObject({
      links: expected.related,
    });
    expect(events.at(-1)).toMatchObject({ type: "complete", outcome: expected.outcome });
  });

  it.each(QUESTIONS)("streams a complete, valid attempt for %s", async (question) => {
    const sent = submission(question);
    const events = await collect(adapter().send(sent, { signal: new AbortController().signal }));

    expect(validateChatStream(sent.requestId, events).status).toBe("complete");
  });

  it("streams the text, then each block, the sources and the related links, in that order", async () => {
    const question = `What is ${NAME} working on now?`;
    const sent = submission(question);
    const events = (await collect(
      adapter().send(sent, { signal: new AbortController().signal }),
    )) as ChatStreamEvent[];
    const expected = preparedAnswer(EVIDENCE, question);

    const order = events.map((event) => event.type).filter((type) => type !== "text_delta");
    expect(order).toEqual([
      "start",
      ...expected.blocks.map(() => "block"),
      "sources",
      "related",
      "complete",
    ]);
    const lastDelta = events.findLastIndex((event) => event.type === "text_delta");
    expect(lastDelta).toBeLessThan(events.findIndex((event) => event.type === "block"));
    expect(events.flatMap((event) => (event.type === "block" ? [event.block] : []))).toEqual(
      expected.blocks,
    );
    expect(events.find((event) => event.type === "sources")).toMatchObject({
      sources: expected.sources,
    });
  });

  it("sends no sources at all for an answer that rests on none", async () => {
    const sent = submission(`What are ${NAME}'s strongest engineering skills?`);
    const events = (await collect(
      adapter().send(sent, { signal: new AbortController().signal }),
    )) as ChatStreamEvent[];

    expect(events.map((event) => event.type)).not.toContain("sources");
    expect(events.filter((event) => event.type === "block")).toMatchObject([
      { block: { type: "ContactCard", email: "casey@morrow.example.test" } },
    ]);
    expect(events.at(-1)).toMatchObject({ type: "complete", outcome: "insufficient_evidence" });
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
      evidence: EVIDENCE,
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
