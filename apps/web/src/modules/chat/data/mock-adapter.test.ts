import { describe, expect, it } from "vitest";

import { validateChatStream, type ChatStreamEvent, type ChatSubmission } from "@sebela/contracts";

import type { AskEvidence } from "./evidence";
import {
  createMockChatAdapter,
  parseMockChatScenarios,
  type MockChatScenario,
} from "./mock-adapter";
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
  learning: [],
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

/** An adapter that plays the given scenarios, one per question, then answers normally. */
function scripted(...scenarios: MockChatScenario[]) {
  const queue = [...scenarios];
  return createMockChatAdapter({
    evidence: EVIDENCE,
    wait: noWait,
    createId: sequentialIds(),
    nextScenario: () => queue.shift() ?? null,
  });
}

const QUESTION = "What is Casey Morrow working on now?";

async function played(scenario: MockChatScenario) {
  const sent = submission(QUESTION);
  const events = await collect(
    scripted(scenario).send(sent, { signal: new AbortController().signal }),
  );
  return { events, result: validateChatStream(sent.requestId, events) };
}

describe("createMockChatAdapter's failure scenarios", () => {
  it("fails before the first event with an error that may pass", async () => {
    const { events, result } = await played("error-before-start");

    expect(events).toHaveLength(1);
    expect(result).toMatchObject({
      status: "complete",
      terminal: { type: "error", code: "unavailable", retryable: true },
    });
  });

  it("fails the transport before the first event", async () => {
    const sent = submission(QUESTION);
    const events: unknown[] = [];
    await expect(async () => {
      for await (const event of scripted("transport-failure").send(sent, {
        signal: new AbortController().signal,
      })) {
        events.push(event);
      }
    }).rejects.toThrow();
    expect(events).toHaveLength(0);
  });

  it("stalls after a partial answer until the request is aborted", async () => {
    const controller = new AbortController();
    const sent = submission(QUESTION);
    const stream = scripted("stall").send(sent, { signal: controller.signal });
    const iterator = stream[Symbol.asyncIterator]();
    const events = [(await iterator.next()).value, (await iterator.next()).value];
    let settled = false;
    const next = iterator.next().then((step) => {
      settled = true;
      return step;
    });
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);

    controller.abort();

    expect(await next).toMatchObject({ done: true });
    expect(validateChatStream(sent.requestId, events)).toMatchObject({ status: "interrupted" });
    expect(events[1]).toMatchObject({ type: "text_delta" });
  });

  it("ends the stream early, after a partial answer, without a terminal event", async () => {
    const { events, result } = await played("interrupt");

    expect(result.status).toBe("interrupted");
    expect(events.filter((event) => (event as ChatStreamEvent).type === "text_delta").length).toBe(
      2,
    );
  });

  it("fails after a partial answer with an internal error that may pass", async () => {
    const { events, result } = await played("error-after-start");

    expect(events.some((event) => (event as ChatStreamEvent).type === "text_delta")).toBe(true);
    expect(result).toMatchObject({
      status: "complete",
      terminal: { type: "error", code: "internal", retryable: true },
    });
  });

  it("fails with an error a retry cannot help", async () => {
    const { result } = await played("not-retryable");

    expect(result).toMatchObject({
      status: "complete",
      terminal: { type: "error", code: "invalid_request", retryable: false },
    });
  });

  it("declines the question as a refused outcome, with text and no sources", async () => {
    const { events, result } = await played("refused");

    expect(result).toMatchObject({
      status: "complete",
      terminal: { type: "complete", outcome: "refused" },
    });
    expect(events.some((event) => (event as ChatStreamEvent).type === "text_delta")).toBe(true);
    expect(events.some((event) => (event as ChatStreamEvent).type === "sources")).toBe(false);
  });

  it("delivers every event twice, which a client must accept once", async () => {
    const { events, result } = await played("duplicates");

    expect(result.status).toBe("complete");
    if (result.status !== "complete") return;
    expect(events).toHaveLength(result.events.length * 2);
  });

  it("sends an unsupported payload after a partial answer", async () => {
    const { result } = await played("invalid-payload");

    expect(result).toMatchObject({ status: "invalid", reason: "malformed_event" });
  });

  it("plays one scenario per question and answers normally once none is left", async () => {
    const mock = scripted("interrupt");
    const signal = new AbortController().signal;
    const sent = submission(QUESTION);

    const first = await collect(mock.send(sent, { signal }));
    const second = await collect(mock.send(sent, { signal }));

    expect(validateChatStream(sent.requestId, first).status).toBe("interrupted");
    expect(validateChatStream(sent.requestId, second)).toMatchObject({
      status: "complete",
      terminal: { type: "complete", outcome: "answered" },
    });
  });
});

describe("parseMockChatScenarios", () => {
  it("keeps the known scenario names in order", () => {
    expect(parseMockChatScenarios(["stall", "refused", "duplicates"])).toEqual([
      "stall",
      "refused",
      "duplicates",
    ]);
  });

  it.each([[undefined], [null], ["stall"], [42], [{ 0: "stall" }]])(
    "reads %j as no scenarios",
    (value) => {
      expect(parseMockChatScenarios(value)).toEqual([]);
    },
  );

  it("drops names it does not know", () => {
    expect(parseMockChatScenarios(["stall", "drop-database", 7])).toEqual(["stall"]);
  });
});
