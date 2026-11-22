import { describe, expect, it, vi } from "vitest";

import { ChatAdmissionError } from "./admission";
import {
  createApiChatAdapter,
  createApiUsageReader,
  type ApiChatAdapterOptions,
} from "./api-adapter";

const REQUEST = "11111111-0000-4000-8000-000000000001";
const OPERATION = "22222222-0000-4000-8000-000000000001";
const MESSAGE = "33333333-0000-4000-8000-000000000001";
const NOW = Date.parse("2026-11-20T10:00:00.000Z");

const operation = {
  operationId: OPERATION,
  requestId: REQUEST,
  status: "accepted",
  deadlineAt: "2026-11-20T10:01:00.000Z",
  assistantMessageId: MESSAGE,
};

const ids = { requestId: REQUEST, messageId: MESSAGE };
const start = { ...ids, eventId: 0, type: "start" };
const delta = { ...ids, eventId: 1, type: "text_delta", text: "Fictional." };
const complete = { ...ids, eventId: 2, type: "complete", outcome: "answered" };
const progress = { type: "progress", requestId: REQUEST, stage: "answering", elapsedMs: 4000 };

function chatFrame(event: { eventId: number }): string {
  return `event: chat\nid: ${String(event.eventId)}\ndata: ${JSON.stringify(event)}\n\n`;
}

const progressFrame = `event: progress\ndata: ${JSON.stringify(progress)}\n\n`;

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function failure(status: number, code: string, headers: Record<string, string> = {}): Response {
  return json(status, { error: { code, message: "Not admitted." } }, headers);
}

/** An event stream that sends its pieces, then ends (or fails when `fail` is set). */
function stream(pieces: readonly string[], fail = false): Response {
  const encoder = new TextEncoder();
  const queue = [...pieces];
  return new Response(
    // One piece per read, so a failure comes after them (an error drops what is still queued).
    new ReadableStream<Uint8Array>({
      pull(controller) {
        const piece = queue.shift();
        if (piece !== undefined) controller.enqueue(encoder.encode(piece));
        else if (fail) controller.error(new TypeError("network"));
        else controller.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}

interface Call {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly body: unknown;
}

/** A fetch that answers each call with the next response (or throws it when it is an error). */
function fakeFetch(responses: readonly (Response | Error)[]) {
  const calls: Call[] = [];
  const queue = [...responses];
  const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: input instanceof Request ? input.url : input.toString(),
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const next = queue.shift();
    if (next === undefined)
      return Promise.reject(
        new Error(`unexpected fetch ${input instanceof Request ? input.url : input.toString()}`),
      );
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next);
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

function adapter(
  fetch: typeof globalThis.fetch,
  options: Partial<ApiChatAdapterOptions> = {},
): ReturnType<typeof createApiChatAdapter> {
  return createApiChatAdapter({
    fetch,
    basePath: "/api/chat",
    challenge: () => Promise.resolve("token-1"),
    now: () => NOW,
    sleep: () => Promise.resolve(),
    ...options,
  });
}

async function collect(iterable: AsyncIterable<unknown>): Promise<unknown[]> {
  const events: unknown[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

const question = { requestId: REQUEST, question: "What does Ilsa build?" };
const signal = () => new AbortController().signal;

describe("createApiChatAdapter restore", () => {
  it("reads the newest page of the caller's conversation", async () => {
    const page = { conversationId: "c", messages: [], nextCursor: null, activeOperation: null };
    const { fetch, calls } = fakeFetch([json(200, page)]);

    await expect(adapter(fetch).restore({ signal: signal() })).resolves.toEqual(page);
    expect(calls).toMatchObject([{ url: "/api/chat/conversation", method: "GET" }]);
  });

  it("reads the page before a message", async () => {
    const { fetch, calls } = fakeFetch([json(200, {})]);

    await adapter(fetch).restore({ before: MESSAGE, signal: signal() });

    expect(calls[0]?.url).toBe(`/api/chat/conversation?before=${MESSAGE}`);
  });

  it("throws when the conversation cannot be read", async () => {
    const { fetch } = fakeFetch([failure(503, "unavailable")]);

    await expect(adapter(fetch).restore({ signal: signal() })).rejects.toThrow();
  });
});

describe("createApiChatAdapter send", () => {
  it("admits a new question with a fresh person check, then follows its events", async () => {
    const challenge = vi.fn(() => Promise.resolve("token-1"));
    const { fetch, calls } = fakeFetch([
      json(202, operation),
      stream([chatFrame(start), progressFrame, chatFrame(delta), chatFrame(complete)]),
    ]);

    const events = await collect(
      adapter(fetch, { challenge }).send(question, { signal: signal() }),
    );

    expect(challenge).toHaveBeenCalledTimes(1);
    expect(calls[0]).toMatchObject({
      url: "/api/chat/conversation/messages",
      method: "POST",
      body: { ...question, challengeToken: "token-1" },
    });
    expect(calls[0]?.headers.get("content-type")).toBe("application/json");
    expect(calls[1]).toMatchObject({
      url: `/api/chat/operations/${OPERATION}/events`,
      method: "GET",
    });
    expect(events).toEqual([start, progress, delta, complete]);
  });

  it("hands on a frame that is not JSON as its text, for the conversation to refuse", async () => {
    const { fetch } = fakeFetch([
      json(202, operation),
      stream(["event: chat\nid: 0\ndata: {\n\n"]),
    ]);

    await expect(collect(adapter(fetch).send(question, { signal: signal() }))).resolves.toEqual([
      "{",
    ]);
  });

  it("follows an operation it already knows without a new check or submission", async () => {
    const challenge = vi.fn(() => Promise.resolve("token-1"));
    const { fetch, calls } = fakeFetch([
      json(200, { conversationId: "c", activeOperation: operation }),
      stream([chatFrame(start), chatFrame(complete)]),
    ]);
    const chat = adapter(fetch, { challenge });

    await chat.restore({ signal: signal() });
    const events = await collect(chat.send(question, { signal: signal() }));

    expect(challenge).not.toHaveBeenCalled();
    expect(calls.map((call) => call.method)).toEqual(["GET", "GET"]);
    expect(events).toEqual([start, complete]);
  });

  it("follows an admitted question again on its retry, without a new check", async () => {
    const challenge = vi.fn(() => Promise.resolve("token-1"));
    const { fetch, calls } = fakeFetch([
      json(202, operation),
      stream([chatFrame(start)]),
      stream([chatFrame(start), chatFrame(complete)]),
    ]);
    const chat = adapter(fetch, {
      challenge,
      deadlineGraceMs: 0,
      now: () => Date.parse(operation.deadlineAt) + 1,
    });

    await collect(chat.send(question, { signal: signal() }));
    await collect(chat.send(question, { signal: signal() }));

    expect(challenge).toHaveBeenCalledTimes(1);
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
  });

  it("reconnects after a dropped stream from the last event it received", async () => {
    const { fetch, calls } = fakeFetch([
      json(202, operation),
      stream([chatFrame(start), progressFrame, chatFrame(delta)], true),
      stream([chatFrame(complete)]),
    ]);

    const events = await collect(adapter(fetch).send(question, { signal: signal() }));

    expect(events).toEqual([start, progress, delta, complete]);
    expect(calls[1]?.headers.get("last-event-id")).toBeNull();
    expect(calls[2]?.headers.get("last-event-id")).toBe("1");
  });

  it("reconnects after a stream that ended before its terminal event", async () => {
    const { fetch, calls } = fakeFetch([
      json(202, operation),
      stream([chatFrame(start)]),
      new TypeError("network"),
      stream([chatFrame(complete)]),
    ]);

    const events = await collect(adapter(fetch).send(question, { signal: signal() }));

    expect(events).toEqual([start, complete]);
    expect(calls[3]?.headers.get("last-event-id")).toBe("0");
  });

  it("stops following once the deadline and its grace have passed", async () => {
    let now = NOW;
    const { fetch, calls } = fakeFetch([json(202, operation), stream([chatFrame(start)])]);
    const sleep = vi.fn(() => {
      now = Date.parse(operation.deadlineAt) + 20_001;
      return Promise.resolve();
    });

    const events = await collect(
      adapter(fetch, { now: () => now, sleep, deadlineGraceMs: 20_000 }).send(question, {
        signal: signal(),
      }),
    );

    expect(events).toEqual([start]);
    expect(calls).toHaveLength(2);
  });

  it("stops following an operation the API does not know for the caller", async () => {
    const { fetch } = fakeFetch([json(202, operation), failure(404, "not_found")]);

    await expect(collect(adapter(fetch).send(question, { signal: signal() }))).resolves.toEqual([]);
  });

  it("stops quietly when the signal aborts", async () => {
    const controller = new AbortController();
    const { fetch, calls } = fakeFetch([json(202, operation), stream([chatFrame(start)])]);
    const sleep = vi.fn(() => {
      controller.abort();
      return Promise.resolve();
    });

    const events = await collect(
      adapter(fetch, { sleep }).send(question, { signal: controller.signal }),
    );

    expect(events).toEqual([start]);
    expect(calls).toHaveLength(2);
  });

  it.each([
    [403, "chat_challenge_failed", "challenge_failed"],
    [409, "chat_busy", "busy"],
    [409, "chat_request_conflict", "conflict"],
    [503, "chat_budget_exhausted", "budget_exhausted"],
    [429, "rate_limited", "rate_limited"],
    [400, "validation_failed", "invalid_request"],
    [503, "unavailable", "unavailable"],
    [500, "internal", "unavailable"],
    [403, "forbidden", "unavailable"],
  ])("reports %i %s as not admitted: %s", async (status, apiCode, code) => {
    const { fetch, calls } = fakeFetch([failure(status, apiCode)]);

    const error = await collect(adapter(fetch).send(question, { signal: signal() })).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(ChatAdmissionError);
    expect(error).toMatchObject({ code, retryAfterSeconds: null });
    expect(calls).toHaveLength(1);
  });

  it("keeps the API's Retry-After of a spent allowance", async () => {
    const { fetch } = fakeFetch([failure(429, "chat_quota_exceeded", { "retry-after": "120" })]);

    await expect(
      collect(adapter(fetch).send(question, { signal: signal() })),
    ).rejects.toMatchObject({ code: "quota_exceeded", retryAfterSeconds: 120 });
  });

  it("reports a failed person check without submitting the question", async () => {
    const { fetch, calls } = fakeFetch([]);
    const challenge = vi.fn(() => Promise.reject(new Error("challenge error")));

    await expect(
      collect(adapter(fetch, { challenge }).send(question, { signal: signal() })),
    ).rejects.toMatchObject({ code: "challenge_failed" });
    expect(calls).toHaveLength(0);
  });

  it.each([
    ["a network failure", new TypeError("network")],
    ["an operation the contract does not allow", json(202, { operationId: "x" })],
  ])("reports %s on submission as unavailable", async (_name, response) => {
    const { fetch } = fakeFetch([response]);

    await expect(
      collect(adapter(fetch).send(question, { signal: signal() })),
    ).rejects.toMatchObject({ code: "unavailable" });
  });

  it("accepts the existing operation the API returns for the same request", async () => {
    const { fetch } = fakeFetch([
      json(200, operation),
      stream([chatFrame(start), chatFrame(complete)]),
    ]);

    await expect(collect(adapter(fetch).send(question, { signal: signal() }))).resolves.toEqual([
      start,
      complete,
    ]);
  });
});

const RETRY = "44444444-0000-4000-8000-000000000001";
const RETRIED = "22222222-0000-4000-8000-000000000002";
const RETRIED_MESSAGE = "33333333-0000-4000-8000-000000000002";
const retried = { ...operation, operationId: RETRIED, assistantMessageId: RETRIED_MESSAGE };
const retriedIds = { requestId: REQUEST, messageId: RETRIED_MESSAGE };
const retriedStart = { ...retriedIds, eventId: 0, type: "start" };
const retriedComplete = { ...retriedIds, eventId: 1, type: "complete", outcome: "answered" };
const failed = { ...ids, eventId: 1, type: "error", code: "internal", retryable: true };

/** A promise and the function that settles it, to hold a fetch or a person check open. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe("createApiChatAdapter retry", () => {
  it("asks a failed attempt again under its own retry ID with a fresh person check, then follows the new attempt", async () => {
    const challenge = vi.fn(() => Promise.resolve(`token-${String(challenge.mock.calls.length)}`));
    const { fetch, calls } = fakeFetch([
      json(202, operation),
      stream([chatFrame(start), chatFrame(failed)]),
      json(202, retried),
      stream([chatFrame(retriedStart), chatFrame(retriedComplete)]),
    ]);
    const chat = adapter(fetch, { challenge });

    await collect(chat.send(question, { signal: signal() }));
    const events = await collect(chat.retry(question, { retryId: RETRY, signal: signal() }));

    expect(challenge).toHaveBeenCalledTimes(2);
    expect(calls[2]).toMatchObject({
      url: `/api/chat/operations/${OPERATION}/retry`,
      method: "POST",
      body: { retryId: RETRY, challengeToken: "token-2" },
    });
    expect(calls[2]?.headers.get("content-type")).toBe("application/json");
    expect(calls[3]?.url).toBe(`/api/chat/operations/${RETRIED}/events`);
    expect(events).toEqual([retriedStart, retriedComplete]);
  });

  it("follows an admitted attempt it never saw end again, without a person check or a retry", async () => {
    const challenge = vi.fn(() => Promise.resolve("token-1"));
    const { fetch, calls } = fakeFetch([
      json(202, operation),
      stream([chatFrame(start)]),
      stream([chatFrame(start), chatFrame(complete)]),
    ]);
    const chat = adapter(fetch, {
      challenge,
      deadlineGraceMs: 0,
      now: () => Date.parse(operation.deadlineAt) + 1,
    });

    await collect(chat.send(question, { signal: signal() }));
    const events = await collect(chat.retry(question, { retryId: RETRY, signal: signal() }));

    expect(challenge).toHaveBeenCalledTimes(1);
    expect(calls.map((call) => call.url)).not.toContain(`/api/chat/operations/${OPERATION}/retry`);
    expect(events).toEqual([start, complete]);
  });

  it("finds the failed attempt of a request it does not know by repeating the request, then retries it with the same token", async () => {
    const challenge = vi.fn(() => Promise.resolve("token-1"));
    const { fetch, calls } = fakeFetch([
      json(200, { ...operation, status: "failed" }),
      json(202, retried),
      stream([chatFrame(retriedStart), chatFrame(retriedComplete)]),
    ]);

    const events = await collect(
      adapter(fetch, { challenge }).retry(question, { retryId: RETRY, signal: signal() }),
    );

    expect(challenge).toHaveBeenCalledTimes(1);
    expect(calls[0]).toMatchObject({
      url: "/api/chat/conversation/messages",
      method: "POST",
      body: { ...question, challengeToken: "token-1" },
    });
    expect(calls[1]).toMatchObject({
      url: `/api/chat/operations/${OPERATION}/retry`,
      body: { retryId: RETRY, challengeToken: "token-1" },
    });
    expect(events).toEqual([retriedStart, retriedComplete]);
  });

  it.each([
    [202, "accepted"],
    [200, "running"],
    [200, "completed"],
  ])(
    "follows the attempt a repeated request returns (%i %s) without a retry",
    async (status, state) => {
      const { fetch, calls } = fakeFetch([
        json(status, { ...operation, status: state }),
        stream([chatFrame(start), chatFrame(complete)]),
      ]);

      const events = await collect(
        adapter(fetch).retry(question, { retryId: RETRY, signal: signal() }),
      );

      expect(calls.map((call) => call.method)).toEqual(["POST", "GET"]);
      expect(events).toEqual([start, complete]);
    },
  );

  it.each([
    [409, "chat_not_retryable", "not_retryable"],
    [409, "chat_busy", "busy"],
    [409, "chat_request_conflict", "conflict"],
    [403, "chat_challenge_failed", "challenge_failed"],
    [503, "chat_budget_exhausted", "budget_exhausted"],
    [404, "not_found", "unavailable"],
  ])("reports a retry refused with %i %s as not admitted: %s", async (status, apiCode, code) => {
    const { fetch } = fakeFetch([
      json(202, operation),
      stream([chatFrame(start), chatFrame(failed)]),
      failure(status, apiCode),
    ]);
    const chat = adapter(fetch);

    await collect(chat.send(question, { signal: signal() }));
    const error = await collect(chat.retry(question, { retryId: RETRY, signal: signal() })).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(ChatAdmissionError);
    expect(error).toMatchObject({ code });
  });

  it("keeps the API's Retry-After of a retry refused for a spent allowance", async () => {
    const { fetch } = fakeFetch([
      json(202, operation),
      stream([chatFrame(start), chatFrame(failed)]),
      failure(429, "chat_quota_exceeded", { "retry-after": "60" }),
    ]);
    const chat = adapter(fetch);

    await collect(chat.send(question, { signal: signal() }));

    await expect(
      collect(chat.retry(question, { retryId: RETRY, signal: signal() })),
    ).rejects.toMatchObject({ code: "quota_exceeded", retryAfterSeconds: 60 });
  });

  it("reports a failed person check of a retry without asking the API", async () => {
    const challenge = vi.fn(() => Promise.reject(new Error("challenge error")));
    const { fetch, calls } = fakeFetch([]);

    await expect(
      collect(adapter(fetch, { challenge }).retry(question, { retryId: RETRY, signal: signal() })),
    ).rejects.toMatchObject({ code: "challenge_failed" });
    expect(calls).toHaveLength(0);
  });
});

describe("createApiChatAdapter stop", () => {
  it("stops the request's operation without a person check or a body", async () => {
    const challenge = vi.fn(() => Promise.resolve("token-1"));
    const { fetch, calls } = fakeFetch([
      json(200, { conversationId: "c", activeOperation: operation }),
      json(200, { ...operation, status: "cancelled" }),
    ]);
    const chat = adapter(fetch, { challenge });

    await chat.restore({ signal: signal() });

    await expect(chat.stop(REQUEST, { signal: signal() })).resolves.toBe("stopped");
    expect(challenge).not.toHaveBeenCalled();
    expect(calls[1]).toMatchObject({
      url: `/api/chat/operations/${OPERATION}/stop`,
      method: "POST",
      body: undefined,
    });
  });

  it("has nothing to stop for a request it knows no operation of", async () => {
    const { fetch, calls } = fakeFetch([]);

    await expect(adapter(fetch).stop(REQUEST, { signal: signal() })).resolves.toBe("none");
    expect(calls).toHaveLength(0);
  });

  it("abandons a question still waiting for its person check, so it is never sent", async () => {
    const check = deferred<string>();
    const { fetch, calls } = fakeFetch([]);
    const chat = adapter(fetch, { challenge: () => check.promise });

    const sending = collect(chat.send(question, { signal: signal() })).catch(
      (thrown: unknown) => thrown,
    );
    await Promise.resolve();
    await expect(chat.stop(REQUEST, { signal: signal() })).resolves.toBe("none");
    check.resolve("token-1");

    await expect(sending).resolves.toBeInstanceOf(ChatAdmissionError);
    expect(calls).toHaveLength(0);
  });

  it("waits for a submission already sent, then stops the operation it admitted", async () => {
    const admitted = deferred<Response>();
    const calls: string[] = [];
    const fetch = vi.fn((input: string) => {
      const url = input;
      calls.push(url);
      if (url.endsWith("/messages")) return admitted.promise;
      if (url.endsWith("/stop"))
        return Promise.resolve(json(200, { ...operation, status: "cancelled" }));
      const cancelled = { ...failed, code: "cancelled" };
      return Promise.resolve(stream([chatFrame(start), chatFrame(cancelled)]));
    }) as unknown as typeof globalThis.fetch;
    const chat = adapter(fetch);

    const sending = collect(chat.send(question, { signal: signal() }));
    await vi.waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    const stopping = chat.stop(REQUEST, { signal: signal() });
    admitted.resolve(json(202, operation));

    await expect(stopping).resolves.toBe("stopped");
    await sending;
    expect(calls).toContain(`/api/chat/operations/${OPERATION}/stop`);
  });

  it("throws when the API could not be asked to stop", async () => {
    const { fetch } = fakeFetch([
      json(200, { conversationId: "c", activeOperation: operation }),
      failure(503, "unavailable"),
    ]);
    const chat = adapter(fetch);

    await chat.restore({ signal: signal() });

    await expect(chat.stop(REQUEST, { signal: signal() })).rejects.toThrow();
  });

  it("asks a stopped attempt again under a retry, not by following it", async () => {
    const { fetch, calls } = fakeFetch([
      json(200, { conversationId: "c", activeOperation: operation }),
      json(200, { ...operation, status: "cancelled" }),
      json(202, retried),
      stream([chatFrame(retriedStart), chatFrame(retriedComplete)]),
    ]);
    const chat = adapter(fetch);

    await chat.restore({ signal: signal() });
    await chat.stop(REQUEST, { signal: signal() });
    await collect(chat.retry(question, { retryId: RETRY, signal: signal() }));

    expect(calls[2]?.url).toBe(`/api/chat/operations/${OPERATION}/retry`);
  });
});

describe("createApiChatAdapter clear", () => {
  const cleared = {
    cleared: true,
    conversation: { conversationId: "d", messages: [], nextCursor: null, activeOperation: null },
    telemetryDeletion: "pending",
  };

  it("deletes the conversation the visitor confirmed and returns the API's answer", async () => {
    const { fetch, calls } = fakeFetch([json(200, cleared)]);

    await expect(
      adapter(fetch).clear("55555555-0000-4000-8000-000000000001", { signal: signal() }),
    ).resolves.toEqual(cleared);
    expect(calls[0]).toMatchObject({
      url: "/api/chat/conversation",
      method: "DELETE",
      body: { conversationId: "55555555-0000-4000-8000-000000000001" },
    });
    expect(calls[0]?.headers.get("content-type")).toBe("application/json");
  });

  it("throws when the conversation could not be cleared", async () => {
    const { fetch } = fakeFetch([failure(503, "unavailable")]);

    await expect(adapter(fetch).clear("c", { signal: signal() })).rejects.toThrow();
  });
});

describe("createApiUsageReader", () => {
  it("reads the caller's usage as a plain GET, with nothing that could admit a question", async () => {
    const snapshot = { serverTime: "2026-11-20T10:00:00.000Z" };
    const { fetch, calls } = fakeFetch([json(200, snapshot)]);
    const read = createApiUsageReader({ fetch, basePath: "/api/chat" });

    await expect(read(signal())).resolves.toEqual(snapshot);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: "/api/chat/usage", method: "GET", body: undefined });
    expect(calls[0]?.headers.get("accept")).toBe("application/json");
  });

  it("throws when the usage cannot be read", async () => {
    const { fetch } = fakeFetch([failure(503, "unavailable")]);

    await expect(
      createApiUsageReader({ fetch, basePath: "/api/chat" })(signal()),
    ).rejects.toThrow();
  });
});
