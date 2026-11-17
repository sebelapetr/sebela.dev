import { describe, expect, it, vi } from "vitest";

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

/** A new store over the storage, with the conversation opened, as a reload sees it. */
function setupAndOpen(storage: ChatStorage, id: string) {
  const { store } = setup(storage);
  store.open(id);
  return store.getSnapshot();
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

  it("opens a conversation whose stored block was tampered with as empty, showing none of it", async () => {
    const storage = createMemoryStorage();
    const first = setup(storage);
    first.store.submit("Q?");
    const sent = at(first.sent, 0);
    const block = {
      type: "ServiceCard",
      title: "Fictional automation",
      summary: "Made up.",
      href: "/services#service-automation",
    };
    sent.stream.push(event(sent, 0, { type: "start" }));
    sent.stream.push(event(sent, 1, { type: "block", block }));
    sent.stream.push(event(sent, 2, { type: "complete", outcome: "answered" }));
    sent.stream.end();
    await flush();
    const id = present(first.store.getSnapshot().conversationId);
    const key = `sebela-chat:${id}`;
    const stored = present(storage.getItem(key));
    expect(setupAndOpen(storage, id).turns).toMatchObject([{ blocks: [block] }]);

    storage.setItem(key, stored.replace("/services#service-automation", "javascript:alert(1)"));

    expect(setupAndOpen(storage, id)).toEqual({ conversationId: id, turns: [], busy: false });
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

/** A store whose stream times out after the given quiet time, under fake timers. */
function setupWithTimeout(idleTimeoutMs: number) {
  const { adapter, sent } = manualAdapter();
  const store = createConversationStore({
    adapter,
    storage: createMemoryStorage(),
    createId: sequentialIds(),
    idleTimeoutMs,
  });
  return { store, sent };
}

/** Starts an answer and ends its stream before the terminal event. */
async function interrupt(sent: Sent, text = "Partial") {
  sent.stream.push(event(sent, 0, { type: "start" }));
  sent.stream.push(event(sent, 1, { type: "text_delta", text }));
  sent.stream.end();
  await flush();
}

/** A storage where every call throws, as a browser that blocks it. */
const blockedStorage: ChatStorage = {
  getItem() {
    throw new Error("blocked");
  },
  setItem() {
    throw new Error("blocked");
  },
  removeItem() {
    throw new Error("blocked");
  },
};

describe("retrying an answer", () => {
  it("resends the interrupted question under the same request, replacing its answer in place", async () => {
    const { store, sent } = setup();
    store.open(null);
    store.submit("Q?");
    await interrupt(at(sent, 0));
    const failedTurn = at(store.getSnapshot().turns, 0);

    expect(store.retry(failedTurn.requestId)).toBe("sent");

    expect(sent).toHaveLength(2);
    expect(at(sent, 1).submission).toEqual(at(sent, 0).submission);
    const { turns, busy } = store.getSnapshot();
    expect(turns).toHaveLength(1);
    expect(at(turns, 0)).toMatchObject({
      requestId: failedTurn.requestId,
      question: "Q?",
      status: "pending",
      text: "",
      error: null,
    });
    expect(busy).toBe(true);

    await answer(at(sent, 1), "Whole.");
    expect(store.getSnapshot().turns).toHaveLength(1);
    expect(at(store.getSnapshot().turns, 0)).toMatchObject({ status: "complete", text: "Whole." });
  });

  it("resends a question whose answer failed with an error that may pass", async () => {
    const { store, sent } = setup();
    store.open(null);
    store.submit("Q?");
    at(sent, 0).stream.push(
      event(at(sent, 0), 0, { type: "error", code: "unavailable", retryable: true }),
    );
    await flush();

    expect(store.retry(at(store.getSnapshot().turns, 0).requestId)).toBe("sent");
    expect(sent).toHaveLength(2);
  });

  it("resends a question whose transport failed before the first event", async () => {
    const { store, sent } = setup();
    store.open(null);
    store.submit("Q?");
    at(sent, 0).stream.fail(new Error("network"));
    await flush();

    expect(store.retry(at(store.getSnapshot().turns, 0).requestId)).toBe("sent");
    expect(sent).toHaveLength(2);
  });

  it("refuses to resend where the error says a retry cannot help", async () => {
    const { store, sent } = setup();
    store.open(null);
    store.submit("Q?");
    at(sent, 0).stream.push(
      event(at(sent, 0), 0, { type: "error", code: "invalid_request", retryable: false }),
    );
    await flush();

    expect(store.retry(at(store.getSnapshot().turns, 0).requestId)).toBe("not_retryable");
    expect(sent).toHaveLength(1);
  });

  it("refuses to resend a final answer: answered, refused or unavailable", async () => {
    const { store, sent } = setup();
    store.open(null);
    store.submit("Q?");
    await answer(at(sent, 0));

    expect(store.retry(at(store.getSnapshot().turns, 0).requestId)).toBe("not_retryable");
    expect(sent).toHaveLength(1);
  });

  it("refuses to resend any but the latest question", async () => {
    const { store, sent } = setup();
    store.open(null);
    store.submit("First?");
    await interrupt(at(sent, 0));
    store.submit("Second?");
    await answer(at(sent, 1));

    expect(store.retry(at(store.getSnapshot().turns, 0).requestId)).toBe("not_retryable");
    expect(sent).toHaveLength(2);
  });

  it("refuses a second retry while the first is answering, so a double click sends once", async () => {
    const { store, sent } = setup();
    store.open(null);
    store.submit("Q?");
    await interrupt(at(sent, 0));
    const { requestId } = at(store.getSnapshot().turns, 0);

    expect(store.retry(requestId)).toBe("sent");
    expect(store.retry(requestId)).toBe("busy");
    expect(sent).toHaveLength(2);
  });

  it("refuses a request the open conversation does not have, such as one cleared by New chat", async () => {
    const { store, sent } = setup();
    store.open(null);
    store.submit("Q?");
    await interrupt(at(sent, 0));
    const { requestId } = at(store.getSnapshot().turns, 0);
    store.newChat();

    expect(store.retry(requestId)).toBe("not_retryable");
    expect(sent).toHaveLength(1);
  });

  it("never retries by itself: an interrupted or failed answer waits for the visitor", async () => {
    const { store, sent } = setup();
    store.open(null);
    store.submit("First?");
    await interrupt(at(sent, 0));
    store.retry(at(store.getSnapshot().turns, 0).requestId);
    at(sent, 1).stream.fail(new Error("network"));
    await flush();

    expect(sent).toHaveLength(2);
    expect(at(store.getSnapshot().turns, 0).status).toBe("interrupted");
  });

  it("keeps the retried answer, not the failed one, for a reload", async () => {
    const storage = createMemoryStorage();
    const { store, sent } = setup(storage);
    store.open(null);
    store.submit("Q?");
    await interrupt(at(sent, 0));
    store.retry(at(store.getSnapshot().turns, 0).requestId);
    await answer(at(sent, 1), "Whole.");

    const reloaded = setupAndOpen(storage, present(store.getSnapshot().conversationId));
    expect(reloaded.turns).toHaveLength(1);
    expect(at(reloaded.turns, 0)).toMatchObject({ status: "complete", text: "Whole." });
  });
});

describe("late and stale events", () => {
  it("ignores what a cancelled transport still yields after New chat, even under a new chat", async () => {
    const { store, sent } = setup();
    store.open(null);
    store.submit("First?");
    at(sent, 0).stream.push(event(at(sent, 0), 0, { type: "start" }));
    await flush();
    store.newChat();
    store.submit("Second?");

    at(sent, 0).stream.push(event(at(sent, 0), 1, { type: "text_delta", text: "Late" }));
    at(sent, 0).stream.push(event(at(sent, 0), 2, { type: "complete", outcome: "answered" }));
    await flush();

    const { turns } = store.getSnapshot();
    expect(turns).toHaveLength(1);
    expect(at(turns, 0)).toMatchObject({ question: "Second?", status: "pending", text: "" });
  });

  it("ignores events of a failed attempt that arrive after its retry, though they name the same request", async () => {
    vi.useFakeTimers();
    try {
      const { store, sent } = setupWithTimeout(1000);
      store.open(null);
      store.submit("Q?");
      at(sent, 0).stream.push(event(at(sent, 0), 0, { type: "start" }));
      await vi.advanceTimersByTimeAsync(1000);
      store.retry(at(store.getSnapshot().turns, 0).requestId);

      at(sent, 0).stream.push(event(at(sent, 0), 1, { type: "text_delta", text: "Stale" }));
      await vi.advanceTimersByTimeAsync(0);

      expect(at(store.getSnapshot().turns, 0)).toMatchObject({ status: "pending", text: "" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("accepts each event once when the transport delivers it twice", async () => {
    const { store, sent } = setup();
    store.open(null);
    store.submit("Q?");
    const first = at(sent, 0);
    for (const raw of [
      event(first, 0, { type: "start" }),
      event(first, 1, { type: "text_delta", text: "Once." }),
      event(first, 2, { type: "complete", outcome: "answered" }),
    ]) {
      first.stream.push(raw);
      first.stream.push(raw);
    }
    first.stream.end();
    await flush();

    expect(at(store.getSnapshot().turns, 0)).toMatchObject({ status: "complete", text: "Once." });
  });

  it("fails an answer with an unsupported payload as unreadable, keeping what came before", async () => {
    const { store, sent } = setup();
    store.open(null);
    store.submit("Q?");
    const first = at(sent, 0);
    first.stream.push(event(first, 0, { type: "start" }));
    first.stream.push(event(first, 1, { type: "text_delta", text: "Partial" }));
    first.stream.push(event(first, 2, { type: "block", block: { type: "HtmlCard", html: "<b>" } }));
    await flush();

    expect(first.signal.aborted).toBe(true);
    expect(store.getSnapshot()).toMatchObject({ busy: false });
    expect(at(store.getSnapshot().turns, 0)).toMatchObject({
      status: "failed",
      text: "Partial",
      blocks: [],
      error: { code: "invalid_stream", retryable: true },
    });
  });
});

describe("an answer that goes quiet", () => {
  it("times out after the quiet time, keeping the partial answer, and stops the transport", async () => {
    vi.useFakeTimers();
    try {
      const { store, sent } = setupWithTimeout(1000);
      store.open(null);
      store.submit("Q?");
      at(sent, 0).stream.push(event(at(sent, 0), 0, { type: "start" }));
      at(sent, 0).stream.push(event(at(sent, 0), 1, { type: "text_delta", text: "Partial" }));
      await vi.advanceTimersByTimeAsync(999);
      expect(at(store.getSnapshot().turns, 0).status).toBe("streaming");

      await vi.advanceTimersByTimeAsync(1);

      expect(at(sent, 0).signal.aborted).toBe(true);
      expect(store.getSnapshot().busy).toBe(false);
      expect(at(store.getSnapshot().turns, 0)).toMatchObject({
        status: "failed",
        text: "Partial",
        error: { code: "timeout", retryable: true },
      });
      expect(sent).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out an answer that never starts", async () => {
    vi.useFakeTimers();
    try {
      const { store } = setupWithTimeout(1000);
      store.open(null);
      store.submit("Q?");

      await vi.advanceTimersByTimeAsync(1000);

      expect(at(store.getSnapshot().turns, 0)).toMatchObject({
        status: "failed",
        text: "",
        error: { code: "timeout" },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("measures the quiet time from the latest event, not from the question", async () => {
    vi.useFakeTimers();
    try {
      const { store, sent } = setupWithTimeout(1000);
      store.open(null);
      store.submit("Q?");
      await vi.advanceTimersByTimeAsync(600);
      at(sent, 0).stream.push(event(at(sent, 0), 0, { type: "start" }));
      await vi.advanceTimersByTimeAsync(600);

      expect(at(store.getSnapshot().turns, 0).status).toBe("streaming");
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores a late event after the timeout", async () => {
    vi.useFakeTimers();
    try {
      const { store, sent } = setupWithTimeout(1000);
      store.open(null);
      store.submit("Q?");
      at(sent, 0).stream.push(event(at(sent, 0), 0, { type: "start" }));
      await vi.advanceTimersByTimeAsync(1000);

      at(sent, 0).stream.push(event(at(sent, 0), 1, { type: "text_delta", text: "Late" }));
      at(sent, 0).stream.push(event(at(sent, 0), 2, { type: "complete", outcome: "answered" }));
      await vi.advanceTimersByTimeAsync(0);

      expect(at(store.getSnapshot().turns, 0)).toMatchObject({
        status: "failed",
        text: "",
        error: { code: "timeout" },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not time out a New chat that cleared the answer", async () => {
    vi.useFakeTimers();
    try {
      const { store } = setupWithTimeout(1000);
      store.open(null);
      store.submit("Q?");
      store.newChat();

      await vi.advanceTimersByTimeAsync(1000);

      expect(store.getSnapshot()).toEqual({ conversationId: null, turns: [], busy: false });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a tab whose storage is blocked", () => {
  it("still asks and answers, keeping the conversation on the page", async () => {
    const { store, sent } = setup(blockedStorage);
    store.open(null);

    expect(store.submit("Q?")).toBe("sent");
    await answer(at(sent, 0));

    expect(at(store.getSnapshot().turns, 0)).toMatchObject({ status: "complete" });
  });

  it("opens any address empty and sends nothing, as no other tab's state is reachable", () => {
    const { store, sent } = setup(blockedStorage);

    store.open("7d1e2f3a-4b5c-4d6e-8f70-8192a3b4c5d6");

    expect(store.getSnapshot()).toEqual({
      conversationId: "7d1e2f3a-4b5c-4d6e-8f70-8192a3b4c5d6",
      turns: [],
      busy: false,
    });
    expect(sent).toHaveLength(0);
  });

  it("starts a new chat without failing", async () => {
    const { store, sent } = setup(blockedStorage);
    store.open(null);
    store.submit("Q?");
    await answer(at(sent, 0));

    store.newChat();

    expect(store.getSnapshot()).toEqual({ conversationId: null, turns: [], busy: false });
  });

  it("refuses the hero's hand-off, which could not reach the Ask page", () => {
    expect(handOffQuestion(blockedStorage, "Q?", sequentialIds())).toBeNull();
  });
});

describe("a transport that throws as it is called", () => {
  it("fails nothing else: the answer is interrupted and can be retried", async () => {
    const storage = createMemoryStorage();
    let calls = 0;
    const adapter: ChatAdapter = {
      send() {
        calls++;
        throw new Error("cannot connect");
      },
    };
    const store = createConversationStore({ adapter, storage, createId: sequentialIds() });
    store.open(null);

    expect(store.submit("Q?")).toBe("sent");
    await flush();

    expect(at(store.getSnapshot().turns, 0).status).toBe("interrupted");
    expect(store.getSnapshot().busy).toBe(false);
    expect(calls).toBe(1);
  });
});
