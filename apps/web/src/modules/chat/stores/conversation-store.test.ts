import { describe, expect, it } from "vitest";

import type { ChatSubmission } from "@sebela/contracts";

import type { ChatAdapter } from "../types/adapter";
import {
  createConversationStore,
  createMemoryStorage,
  handOffQuestion,
  type ChatStorage,
} from "./conversation-store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MESSAGE = "9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f";

function sequentialIds(): () => string {
  let next = 0;
  return () => `00000000-0000-4000-8000-${String(next++).padStart(12, "0")}`;
}

/** A stream the test feeds by hand. */
function channel() {
  const queue: unknown[] = [];
  let ended = false;
  let failure: Error | null = null;
  let wake: (() => void) | null = null;
  async function* iterate(): AsyncGenerator {
    for (;;) {
      if (queue.length > 0) {
        yield queue.shift();
        continue;
      }
      if (failure !== null) throw failure;
      if (ended) return;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
      wake = null;
    }
  }
  return {
    iterable: iterate(),
    push(event: unknown) {
      queue.push(event);
      wake?.();
    },
    end() {
      ended = true;
      wake?.();
    },
    fail(error: Error) {
      failure = error;
      wake?.();
    },
  };
}

type Channel = ReturnType<typeof channel>;

interface Sent {
  readonly submission: ChatSubmission;
  readonly signal: AbortSignal;
  readonly stream: Channel;
}

function manualAdapter() {
  const sent: Sent[] = [];
  const adapter: ChatAdapter = {
    send(submission, { signal }) {
      const stream = channel();
      sent.push({ submission, signal, stream });
      return stream.iterable;
    },
  };
  return { adapter, sent };
}

function setup(storage: ChatStorage = createMemoryStorage()) {
  const { adapter, sent } = manualAdapter();
  const store = createConversationStore({ adapter, storage, createId: sequentialIds() });
  return { store, sent, storage };
}

/** The item at the index, which the test expects to exist. */
function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`nothing at ${String(index)}`);
  return item;
}

/** A value the test expects to be there. */
function present<T>(value: T | null): T {
  if (value === null) throw new Error("expected a value");
  return value;
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

function event(sent: Sent, eventId: number, fields: Record<string, unknown>) {
  return { requestId: sent.submission.requestId, messageId: MESSAGE, eventId, ...fields };
}

/** Answers a sent question completely. */
async function answer(sent: Sent, text = "A fictional answer.") {
  sent.stream.push(event(sent, 0, { type: "start" }));
  sent.stream.push(event(sent, 1, { type: "text_delta", text }));
  sent.stream.push(event(sent, 2, { type: "complete", outcome: "answered" }));
  sent.stream.end();
  await flush();
}

describe("a conversation store", () => {
  it("opens an empty conversation without an address", () => {
    const { store, sent } = setup();
    store.open(null);

    expect(store.getSnapshot()).toEqual({ conversationId: null, turns: [], busy: false });
    expect(sent).toHaveLength(0);
  });

  it("sends a trimmed question once, under a new random conversation and request", () => {
    const { store, sent } = setup();
    store.open(null);

    expect(store.submit("  What is Casey Morrow working on now?  ")).toBe("sent");

    expect(sent).toHaveLength(1);
    const { submission } = at(sent, 0);
    expect(submission.question).toBe("What is Casey Morrow working on now?");
    expect(submission.conversationId).toMatch(UUID);
    expect(submission.requestId).toMatch(UUID);
    expect(submission.requestId).not.toBe(submission.conversationId);
    expect(store.getSnapshot()).toMatchObject({
      conversationId: submission.conversationId,
      busy: true,
      turns: [{ question: "What is Casey Morrow working on now?", status: "pending" }],
    });
  });

  it("refuses a second question while one is pending", () => {
    const { store, sent } = setup();
    store.open(null);
    store.submit("First?");

    expect(store.submit("Second?")).toBe("busy");
    expect(sent).toHaveLength(1);
    expect(store.getSnapshot().turns).toHaveLength(1);
  });

  it.each([[""], ["   "], ["x".repeat(1001)]])("refuses an invalid question %#", (question) => {
    const { store, sent } = setup();
    store.open(null);

    expect(store.submit(question)).toBe("invalid");
    expect(sent).toHaveLength(0);
  });

  it("streams the answer into the turn and accepts the next question once complete", async () => {
    const { store, sent } = setup();
    store.open(null);
    store.submit("First?");
    await answer(at(sent, 0));

    expect(store.getSnapshot()).toMatchObject({
      busy: false,
      turns: [{ status: "complete", text: "A fictional answer.", outcome: "answered" }],
    });
    expect(store.submit("Second?")).toBe("sent");
    expect(sent[1]?.submission.conversationId).toBe(sent[0]?.submission.conversationId);
  });

  it("marks a stream that ends without its terminal event as interrupted", async () => {
    const { store, sent } = setup();
    store.open(null);
    store.submit("Q?");
    at(sent, 0).stream.push(event(at(sent, 0), 0, { type: "start" }));
    at(sent, 0).stream.push(event(at(sent, 0), 1, { type: "text_delta", text: "Partial" }));
    at(sent, 0).stream.end();
    await flush();

    expect(store.getSnapshot()).toMatchObject({
      busy: false,
      turns: [{ status: "interrupted", text: "Partial" }],
    });
  });

  it("marks a transport that fails as interrupted, keeping the question", async () => {
    const { store, sent } = setup();
    store.open(null);
    store.submit("Q?");
    at(sent, 0).stream.fail(new TypeError("network down"));
    await flush();

    expect(store.getSnapshot()).toMatchObject({
      busy: false,
      turns: [{ question: "Q?", status: "interrupted" }],
    });
  });

  it("notifies subscribers of every change until they unsubscribe", async () => {
    const { store, sent } = setup();
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls += 1;
    });
    store.open(null);
    store.submit("Q?");
    const afterSubmit = calls;
    expect(afterSubmit).toBeGreaterThan(0);

    unsubscribe();
    await answer(at(sent, 0));
    expect(calls).toBe(afterSubmit);
  });

  it("keeps the snapshot stable while nothing changes", () => {
    const { store } = setup();
    store.open(null);

    expect(store.getSnapshot()).toBe(store.getSnapshot());
  });

  it("opens an unknown conversation address empty, without sending anything", () => {
    const { store, sent } = setup();
    store.open("7d1e2f3a-4b5c-4d6e-8f70-8192a3b4c5d6");

    expect(store.getSnapshot()).toEqual({
      conversationId: "7d1e2f3a-4b5c-4d6e-8f70-8192a3b4c5d6",
      turns: [],
      busy: false,
    });
    expect(sent).toHaveLength(0);
  });

  it("starts a new chat: cancels the active request, clears the turns and the address", async () => {
    const { store, sent } = setup();
    store.open(null);
    store.submit("Q?");
    at(sent, 0).stream.push(event(at(sent, 0), 0, { type: "start" }));
    await flush();

    store.newChat();

    expect(at(sent, 0).signal.aborted).toBe(true);
    expect(store.getSnapshot()).toEqual({ conversationId: null, turns: [], busy: false });

    at(sent, 0).stream.push(event(at(sent, 0), 1, { type: "text_delta", text: "Late" }));
    at(sent, 0).stream.end();
    await flush();
    expect(store.getSnapshot()).toEqual({ conversationId: null, turns: [], busy: false });
  });

  it("forgets the cleared conversation in this tab", async () => {
    const storage = createMemoryStorage();
    const { store, sent } = setup(storage);
    store.open(null);
    store.submit("Q?");
    await answer(at(sent, 0));
    const id = present(store.getSnapshot().conversationId);

    store.newChat();
    const reopened = setup(storage);
    reopened.store.open(id);

    expect(reopened.store.getSnapshot().turns).toEqual([]);
  });

  it("cancels the active request when another conversation is opened", () => {
    const { store, sent } = setup();
    store.open(null);
    store.submit("Q?");

    store.open("7d1e2f3a-4b5c-4d6e-8f70-8192a3b4c5d6");

    expect(at(sent, 0).signal.aborted).toBe(true);
    expect(store.getSnapshot().turns).toEqual([]);
  });
});

describe("the hero's hand-off", () => {
  it("gives a random conversation address that does not carry the question", () => {
    const storage = createMemoryStorage();
    const question = "What is Casey Morrow working on now?";
    const id = handOffQuestion(storage, question, sequentialIds());

    expect(id).toMatch(UUID);
    expect(id).not.toContain("Casey");
  });

  it("refuses an empty question", () => {
    expect(handOffQuestion(createMemoryStorage(), "   ", sequentialIds())).toBeNull();
  });

  it("sends the handed-off question exactly once when its conversation opens", async () => {
    const storage = createMemoryStorage();
    const id = present(handOffQuestion(storage, "  Q from the hero?  ", () => crypto.randomUUID()));
    const { store, sent } = setup(storage);

    store.open(id);
    store.open(id);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.submission).toMatchObject({ conversationId: id, question: "Q from the hero?" });
    await answer(at(sent, 0));
    expect(store.getSnapshot().turns).toHaveLength(1);
  });

  it("does not send it again when the page is opened again (back, forward, reload)", async () => {
    const storage = createMemoryStorage();
    const id = present(handOffQuestion(storage, "Q from the hero?", () => crypto.randomUUID()));
    const first = setup(storage);
    first.store.open(id);
    await answer(at(first.sent, 0), "Kept.");

    const second = setup(storage);
    second.store.open(id);

    expect(second.sent).toHaveLength(0);
    expect(second.store.getSnapshot()).toMatchObject({
      conversationId: id,
      busy: false,
      turns: [{ question: "Q from the hero?", status: "complete", text: "Kept." }],
    });
  });

  it("restores an answer that was still streaming as interrupted, never resending it", async () => {
    const storage = createMemoryStorage();
    const id = present(handOffQuestion(storage, "Q?", () => crypto.randomUUID()));
    const first = setup(storage);
    first.store.open(id);
    at(first.sent, 0).stream.push(event(at(first.sent, 0), 0, { type: "start" }));
    at(first.sent, 0).stream.push(
      event(at(first.sent, 0), 1, { type: "text_delta", text: "Half" }),
    );
    await flush();

    const second = setup(storage);
    second.store.open(id);

    expect(second.sent).toHaveLength(0);
    expect(second.store.getSnapshot()).toMatchObject({
      busy: false,
      turns: [{ status: "interrupted", text: "Half" }],
    });
  });

  it("opens a conversation whose stored state is unreadable as empty", () => {
    const storage = createMemoryStorage();
    const id = "7d1e2f3a-4b5c-4d6e-8f70-8192a3b4c5d6";
    storage.setItem(`sebela-chat:${id}`, "{not json");
    const { store } = setup(storage);

    store.open(id);

    expect(store.getSnapshot()).toEqual({ conversationId: id, turns: [], busy: false });
  });
});
