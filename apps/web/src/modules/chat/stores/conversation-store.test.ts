import { describe, expect, it, vi } from "vitest";

import type { ChatAssistantMessage, ChatMessage, ChatUserMessage } from "@sebela/contracts";

import { ChatAdmissionError } from "../data/admission";
import type { ChatAdapter, ChatQuestion } from "../types/adapter";
import {
  createConversationStore,
  createMemoryStorage,
  handOffQuestion,
  type ChatStorage,
} from "./conversation-store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CONVERSATION = "0c0c0c0c-0000-4000-8000-000000000001";
const OPERATION = "22222222-0000-4000-8000-000000000001";
const MESSAGE = "9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f";
const CREATED = "2026-11-20T10:00:00.000Z";

const storedId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const storedRequest = (n: number) => `11111111-0000-4000-8000-${String(n).padStart(12, "0")}`;

function sequentialIds(): () => string {
  let next = 0;
  return () => `aaaaaaaa-0000-4000-8000-${String(next++).padStart(12, "0")}`;
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
  readonly question: ChatQuestion;
  readonly signal: AbortSignal;
  readonly stream: Channel;
}

interface Restore {
  readonly before: string | null;
  resolve(page: unknown): void;
  reject(error: Error): void;
}

function manualAdapter() {
  const sent: Sent[] = [];
  const restores: Restore[] = [];
  const adapter: ChatAdapter = {
    restore({ before }) {
      return new Promise((resolve, reject) => {
        restores.push({ before: before ?? null, resolve, reject });
      });
    },
    send(question, { signal }) {
      const stream = channel();
      sent.push({ question, signal, stream });
      return stream.iterable;
    },
  };
  return { adapter, sent, restores };
}

function setup(storage: ChatStorage = createMemoryStorage(), idleTimeoutMs?: number) {
  const { adapter, sent, restores } = manualAdapter();
  const store = createConversationStore({
    adapter,
    storage,
    createId: sequentialIds(),
    ...(idleTimeoutMs === undefined ? {} : { idleTimeoutMs }),
  });
  return { store, sent, restores, storage };
}

/** The item at the index, which the test expects to exist. */
function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`nothing at ${String(index)}`);
  return item;
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

function user(n: number, text: string): ChatUserMessage {
  return {
    id: storedId(n * 2),
    role: "user",
    requestId: storedRequest(n),
    text,
    createdAt: CREATED,
  };
}

function answered(n: number, text: string): ChatAssistantMessage {
  return {
    id: storedId(n * 2 + 1),
    role: "assistant",
    requestId: storedRequest(n),
    status: "completed",
    outcome: "answered",
    error: null,
    text,
    blocks: [],
    sources: [],
    related: [],
    createdAt: CREATED,
  };
}

function pending(n: number): ChatAssistantMessage {
  return { ...answered(n, ""), status: "pending", outcome: null, text: null };
}

function page(
  messages: readonly ChatMessage[],
  fields: { nextCursor?: string | null; activeOperation?: unknown; retentionDays?: number } = {},
) {
  return {
    conversationId: CONVERSATION,
    messages,
    nextCursor: null,
    activeOperation: null,
    retentionDays: 730,
    ...fields,
  };
}

const emptyPage = page([]);

/** Opens the store and lets it read an empty conversation. */
async function openEmpty(context: ReturnType<typeof setup>, handOffId: string | null = null) {
  const opened = context.store.open(handOffId);
  at(context.restores, 0).resolve(emptyPage);
  await flush();
  return opened;
}

function event(sent: Sent, eventId: number, fields: Record<string, unknown>) {
  return { requestId: sent.question.requestId, messageId: MESSAGE, eventId, ...fields };
}

/** Answers a sent question completely. */
async function answer(sent: Sent, text = "A fictional answer.") {
  sent.stream.push(event(sent, 0, { type: "start" }));
  sent.stream.push(event(sent, 1, { type: "text_delta", text }));
  sent.stream.push(event(sent, 2, { type: "complete", outcome: "answered" }));
  sent.stream.end();
  await flush();
}

describe("opening the conversation", () => {
  it("is loading until the caller's conversation is read, refusing a question meanwhile", () => {
    const context = setup();

    void context.store.open(null);

    expect(context.store.getSnapshot()).toMatchObject({
      history: "loading",
      busy: true,
      turns: [],
    });
    expect(context.store.submit("Q?")).toBe("busy");
    expect(context.sent).toHaveLength(0);
  });

  it("shows the stored questions and answers with the storage period", async () => {
    const context = setup();

    const opened = context.store.open(null);
    at(context.restores, 0).resolve(
      page([user(1, "What does Ilsa build?"), answered(1, "Fictional systems.")], {
        retentionDays: 30,
      }),
    );

    await expect(opened).resolves.toEqual({ kind: "shown" });
    expect(context.store.getSnapshot()).toMatchObject({
      history: "ready",
      busy: false,
      retentionDays: 30,
      earlier: "none",
      turns: [
        { requestId: storedRequest(1), question: "What does Ilsa build?", status: "complete" },
      ],
    });
    expect(context.sent).toHaveLength(0);
  });

  it.each([
    ["a page the contract does not allow", { conversationId: "nope" }],
    ["a failed read", new Error("unavailable")],
  ])(
    "says the history could not be read after %s, still taking a question",
    async (_name, result) => {
      const context = setup();

      const opened = context.store.open(null);
      if (result instanceof Error) at(context.restores, 0).reject(result);
      else at(context.restores, 0).resolve(result);
      await opened;

      expect(context.store.getSnapshot()).toMatchObject({
        history: "failed",
        busy: false,
        turns: [],
      });
      expect(context.store.submit("Q?")).toBe("sent");
    },
  );

  it("reads the conversation once, however often the page opens it", async () => {
    const context = setup();

    await openEmpty(context);
    await context.store.open(null);

    expect(context.restores).toHaveLength(1);
  });

  it("follows the answer still being prepared, without asking again (reload recovery)", async () => {
    const context = setup();
    const opened = context.store.open(null);
    at(context.restores, 0).resolve(
      page([user(1, "Q?"), pending(1)], {
        activeOperation: {
          operationId: OPERATION,
          requestId: storedRequest(1),
          status: "running",
          deadlineAt: "2026-11-20T10:01:00.000Z",
          assistantMessageId: storedId(3),
        },
      }),
    );
    await opened;

    expect(context.sent).toHaveLength(1);
    expect(at(context.sent, 0).question).toEqual({ requestId: storedRequest(1), question: "Q?" });
    expect(context.store.getSnapshot().busy).toBe(true);

    await answer(at(context.sent, 0), "Recovered once.");

    expect(context.store.getSnapshot()).toMatchObject({
      busy: false,
      turns: [{ requestId: storedRequest(1), status: "complete", text: "Recovered once." }],
    });
    expect(context.sent).toHaveLength(1);
  });
});

describe("earlier messages", () => {
  it("reads the page before the oldest shown, pairing the answer the newer page began with", async () => {
    const context = setup();
    const opened = context.store.open(null);
    at(context.restores, 0).resolve(
      page([answered(1, "Older answer."), user(2, "Newer?"), answered(2, "Newer answer.")], {
        nextCursor: storedId(3),
      }),
    );
    await opened;
    expect(context.store.getSnapshot()).toMatchObject({
      earlier: "available",
      turns: [{ requestId: storedRequest(2) }],
    });

    const earlier = context.store.loadEarlier();
    expect(context.store.getSnapshot().earlier).toBe("loading");
    expect(at(context.restores, 1).before).toBe(storedId(3));
    at(context.restores, 1).resolve(page([user(1, "Older?")]));
    await earlier;

    expect(context.store.getSnapshot()).toMatchObject({
      earlier: "none",
      turns: [
        { requestId: storedRequest(1), question: "Older?", text: "Older answer." },
        { requestId: storedRequest(2), text: "Newer answer." },
      ],
    });
  });

  it("keeps the earlier messages available when they cannot be read", async () => {
    const context = setup();
    const opened = context.store.open(null);
    at(context.restores, 0).resolve(page([user(2, "Newer?")], { nextCursor: storedId(4) }));
    await opened;

    const earlier = context.store.loadEarlier();
    at(context.restores, 1).reject(new Error("unavailable"));
    await earlier;

    expect(context.store.getSnapshot()).toMatchObject({ earlier: "available", turns: [{}] });
  });
});

describe("asking a question", () => {
  it("sends a trimmed question once under a new random request", async () => {
    const context = setup();
    await openEmpty(context);

    expect(context.store.submit("  What does Ilsa build?  ")).toBe("sent");

    expect(context.sent).toHaveLength(1);
    expect(at(context.sent, 0).question.question).toBe("What does Ilsa build?");
    expect(at(context.sent, 0).question.requestId).toMatch(UUID);
    expect(context.store.getSnapshot().busy).toBe(true);
  });

  it("refuses an empty or too long question", async () => {
    const context = setup();
    await openEmpty(context);

    expect(context.store.submit("   ")).toBe("invalid");
    expect(context.store.submit("x".repeat(1001))).toBe("invalid");
    expect(context.sent).toHaveLength(0);
  });

  it("refuses a second question while one is answering", async () => {
    const context = setup();
    await openEmpty(context);
    context.store.submit("First?");

    expect(context.store.submit("Second?")).toBe("busy");
    expect(context.sent).toHaveLength(1);
  });

  it("streams the answer in, ignoring signs of life, and takes the next question once complete", async () => {
    const context = setup();
    await openEmpty(context);
    context.store.submit("Q?");
    const sent = at(context.sent, 0);

    sent.stream.push(event(sent, 0, { type: "start" }));
    sent.stream.push({
      type: "progress",
      requestId: sent.question.requestId,
      stage: "answering",
      elapsedMs: 4000,
    });
    await answer(sent, "Fictional.");

    expect(at(context.store.getSnapshot().turns, 0)).toMatchObject({
      status: "complete",
      text: "Fictional.",
    });
    expect(context.store.submit("Next?")).toBe("sent");
  });

  it("marks a stream that ends without its terminal event as interrupted", async () => {
    const context = setup();
    await openEmpty(context);
    context.store.submit("Q?");
    const sent = at(context.sent, 0);

    sent.stream.push(event(sent, 0, { type: "start" }));
    sent.stream.end();
    await flush();

    expect(context.store.getSnapshot()).toMatchObject({
      busy: false,
      turns: [{ status: "interrupted" }],
    });
  });

  it("fails a question the API did not admit with its reason, showing no answer", async () => {
    const context = setup();
    await openEmpty(context);
    context.store.submit("Q?");

    at(context.sent, 0).stream.fail(new ChatAdmissionError("quota_exceeded", 120));
    await flush();

    expect(context.store.getSnapshot()).toMatchObject({
      busy: false,
      turns: [
        {
          status: "failed",
          text: "",
          error: { code: "quota_exceeded", retryable: true, retryAfterSeconds: 120 },
        },
      ],
    });
  });

  it("interrupts the answer when the transport throws as it is called", async () => {
    const context = setup();
    const adapter: ChatAdapter = {
      restore: () => Promise.resolve(emptyPage),
      send() {
        throw new Error("cannot connect");
      },
    };
    const store = createConversationStore({
      adapter,
      storage: context.storage,
      createId: sequentialIds(),
    });
    await store.open(null);

    expect(store.submit("Q?")).toBe("sent");
    await flush();

    expect(store.getSnapshot()).toMatchObject({ busy: false, turns: [{ status: "interrupted" }] });
  });

  it("notifies subscribers of every change until they unsubscribe", async () => {
    const context = setup();
    await openEmpty(context);
    const listener = vi.fn();
    const unsubscribe = context.store.subscribe(listener);

    context.store.submit("Q?");
    expect(listener).toHaveBeenCalled();
    unsubscribe();
    listener.mockClear();
    await answer(at(context.sent, 0));

    expect(listener).not.toHaveBeenCalled();
  });

  it("keeps the snapshot stable while nothing changes", async () => {
    const context = setup();
    await openEmpty(context);

    expect(context.store.getSnapshot()).toBe(context.store.getSnapshot());
  });
});

describe("the hero's hand-off", () => {
  it("gives a random address that does not carry the question", () => {
    const storage = createMemoryStorage();

    const id = handOffQuestion(storage, "  What does Ilsa build?  ", sequentialIds());

    expect(id).toMatch(UUID);
    expect(id).not.toContain("Ilsa");
  });

  it("refuses an empty question and a storage that cannot be written", () => {
    const blocked: ChatStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => undefined,
    };

    expect(handOffQuestion(createMemoryStorage(), "  ", sequentialIds())).toBeNull();
    expect(handOffQuestion(blocked, "Q?", sequentialIds())).toBeNull();
  });

  it("sends the handed-off question once, after the history is read", async () => {
    const context = setup();
    const id = handOffQuestion(context.storage, "What does Ilsa build?", sequentialIds());

    const opened = context.store.open(id);
    expect(context.sent).toHaveLength(0);
    at(context.restores, 0).resolve(page([user(1, "Old?"), answered(1, "Old.")]));

    await expect(opened).resolves.toEqual({ kind: "sent" });
    expect(context.sent).toHaveLength(1);
    expect(at(context.sent, 0).question.question).toBe("What does Ilsa build?");
    expect(context.store.getSnapshot().turns).toMatchObject([
      { question: "Old?" },
      { question: "What does Ilsa build?", status: "pending" },
    ]);
  });

  it("never sends it again: not on a second open, nor from a new store after a reload", async () => {
    const context = setup();
    const id = handOffQuestion(context.storage, "Q?", sequentialIds());
    await openEmpty(context, id);

    await expect(context.store.open(id)).resolves.toEqual({ kind: "shown" });
    const reloaded = setup(context.storage);
    const opened = reloaded.store.open(id);
    at(reloaded.restores, 0).resolve(emptyPage);

    await expect(opened).resolves.toEqual({ kind: "shown" });
    expect(context.sent).toHaveLength(1);
    expect(reloaded.sent).toHaveLength(0);
  });

  it("holds the handed-off question while an earlier answer is still prepared", async () => {
    const context = setup();
    const id = handOffQuestion(context.storage, "New?", sequentialIds());
    const opened = context.store.open(id);
    at(context.restores, 0).resolve(
      page([user(1, "Q?"), pending(1)], {
        activeOperation: {
          operationId: OPERATION,
          requestId: storedRequest(1),
          status: "running",
          deadlineAt: "2026-11-20T10:01:00.000Z",
          assistantMessageId: storedId(3),
        },
      }),
    );

    await expect(opened).resolves.toEqual({ kind: "held", question: "New?" });
    expect(context.sent).toHaveLength(1);
  });

  it("opens an unknown hand-off address with the caller's own conversation, sending nothing", async () => {
    const context = setup();

    const opened = context.store.open("7d1e2f3a-4b5c-4d6e-8f70-8192a3b4c5d6");
    at(context.restores, 0).resolve(page([user(1, "Mine?"), answered(1, "Yours.")]));

    await expect(opened).resolves.toEqual({ kind: "shown" });
    expect(context.store.getSnapshot().turns).toMatchObject([{ question: "Mine?" }]);
    expect(context.sent).toHaveLength(0);
  });

  it("takes a later hand-off without reading the conversation again", async () => {
    const context = setup();
    await openEmpty(context);
    const id = handOffQuestion(context.storage, "Later?", sequentialIds());

    await expect(context.store.open(id)).resolves.toEqual({ kind: "sent" });
    expect(context.restores).toHaveLength(1);
    expect(at(context.sent, 0).question.question).toBe("Later?");
  });
});

describe("retrying an answer", () => {
  it("follows an interrupted question again under the same request, replacing its answer", async () => {
    const context = setup();
    await openEmpty(context);
    context.store.submit("Q?");
    const first = at(context.sent, 0);
    first.stream.push(event(first, 0, { type: "start" }));
    first.stream.push(event(first, 1, { type: "text_delta", text: "Part" }));
    first.stream.end();
    await flush();

    expect(context.store.retry(first.question.requestId)).toBe("sent");

    expect(at(context.sent, 1).question).toEqual(first.question);
    expect(context.store.getSnapshot().turns).toMatchObject([
      { requestId: first.question.requestId, status: "pending", text: "" },
    ]);
  });

  it("asks again under the same request after a question that was not admitted", async () => {
    const context = setup();
    await openEmpty(context);
    context.store.submit("Q?");
    at(context.sent, 0).stream.fail(new ChatAdmissionError("challenge_failed"));
    await flush();

    expect(context.store.retry(at(context.sent, 0).question.requestId)).toBe("sent");
    expect(at(context.sent, 1).question).toEqual(at(context.sent, 0).question);
  });

  it("asks again under a new request after the API ended the answer with a retryable error", async () => {
    const context = setup();
    await openEmpty(context);
    context.store.submit("Q?");
    const first = at(context.sent, 0);
    first.stream.push(event(first, 0, { type: "start" }));
    first.stream.push(event(first, 1, { type: "error", code: "timeout", retryable: true }));
    first.stream.end();
    await flush();

    expect(context.store.retry(first.question.requestId)).toBe("sent");

    const second = at(context.sent, 1).question;
    expect(second.question).toBe("Q?");
    expect(second.requestId).not.toBe(first.question.requestId);
    expect(context.store.getSnapshot().turns).toMatchObject([
      { requestId: second.requestId, status: "pending" },
    ]);
  });

  it("refuses a final answer, an error a retry cannot help and any but the latest question", async () => {
    const context = setup();
    await openEmpty(context);
    context.store.submit("First?");
    await answer(at(context.sent, 0));
    context.store.submit("Second?");
    at(context.sent, 1).stream.fail(new ChatAdmissionError("budget_exhausted"));
    await flush();

    expect(context.store.retry(at(context.sent, 0).question.requestId)).toBe("not_retryable");
    expect(context.store.retry(at(context.sent, 1).question.requestId)).toBe("not_retryable");
    expect(context.sent).toHaveLength(2);
  });

  it("refuses a second retry while the first is answering", async () => {
    const context = setup();
    await openEmpty(context);
    context.store.submit("Q?");
    at(context.sent, 0).stream.end();
    await flush();
    const { requestId } = at(context.sent, 0).question;

    expect(context.store.retry(requestId)).toBe("sent");
    expect(context.store.retry(requestId)).toBe("busy");
    expect(context.sent).toHaveLength(2);
  });

  it("ignores what a replaced attempt still yields, though it names the same request", async () => {
    const context = setup();
    await openEmpty(context);
    context.store.submit("Q?");
    const first = at(context.sent, 0);
    first.stream.push(event(first, 0, { type: "start" }));
    await flush();
    first.stream.fail(new Error("dropped"));
    await flush();
    context.store.retry(first.question.requestId);

    first.stream.push(event(first, 1, { type: "text_delta", text: "Stale" }));
    await flush();

    expect(at(context.store.getSnapshot().turns, 0)).toMatchObject({ status: "pending", text: "" });
  });
});

describe("an answer that goes quiet", () => {
  it("times out after the quiet time, keeping the partial answer, and stops following it", async () => {
    vi.useFakeTimers();
    try {
      const context = setup(createMemoryStorage(), 1000);
      const opened = context.store.open(null);
      at(context.restores, 0).resolve(emptyPage);
      await opened;
      context.store.submit("Q?");
      const sent = at(context.sent, 0);
      sent.stream.push(event(sent, 0, { type: "start" }));
      sent.stream.push(event(sent, 1, { type: "text_delta", text: "Partial" }));
      await vi.advanceTimersByTimeAsync(999);
      expect(at(context.store.getSnapshot().turns, 0).status).toBe("streaming");

      await vi.advanceTimersByTimeAsync(1);

      expect(sent.signal.aborted).toBe(true);
      expect(at(context.store.getSnapshot().turns, 0)).toMatchObject({
        status: "failed",
        text: "Partial",
        error: { code: "timeout", retryable: true },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("measures the quiet time from the latest sign of life", async () => {
    vi.useFakeTimers();
    try {
      const context = setup(createMemoryStorage(), 1000);
      const opened = context.store.open(null);
      at(context.restores, 0).resolve(emptyPage);
      await opened;
      context.store.submit("Q?");
      const sent = at(context.sent, 0);
      await vi.advanceTimersByTimeAsync(600);
      sent.stream.push({
        type: "progress",
        requestId: sent.question.requestId,
        stage: "queued",
        elapsedMs: 600,
      });
      await vi.advanceTimersByTimeAsync(600);

      expect(at(context.store.getSnapshot().turns, 0).status).toBe("pending");
    } finally {
      vi.useRealTimers();
    }
  });

  it("follows a timed-out question again under the same request", async () => {
    vi.useFakeTimers();
    try {
      const context = setup(createMemoryStorage(), 1000);
      const opened = context.store.open(null);
      at(context.restores, 0).resolve(emptyPage);
      await opened;
      context.store.submit("Q?");
      await vi.advanceTimersByTimeAsync(1000);

      expect(context.store.retry(at(context.sent, 0).question.requestId)).toBe("sent");
      expect(at(context.sent, 1).question).toEqual(at(context.sent, 0).question);
    } finally {
      vi.useRealTimers();
    }
  });
});
