// The chat's transport over the website's same-origin chat routes (`/api/chat/*`), which relay to
// the API: it reads the caller's conversation, admits a new question or a retry with a person
// check, follows an attempt's event stream, reconnecting where it left off, stops an answer and
// clears the conversation the visitor confirmed.
import { ChatOperationSchema, type ChatOperation } from "@sebela/contracts";

import type { ChatAdapter } from "../types/adapter";
import { ChatAdmissionError, type ChatAdmissionCode } from "./admission";
import { createSseParser } from "./sse";

export interface ApiChatAdapterOptions {
  /** The browser's `fetch`; the cookie goes with every same-origin request. */
  readonly fetch: typeof globalThis.fetch;
  /** Where the chat routes are, such as `/api/chat`. */
  readonly basePath: string;
  /** Gives a fresh person-check token for one new question or retry; rejects when it fails. */
  readonly challenge: (signal: AbortSignal) => Promise<string>;
  readonly now?: () => number;
  /** Waits before a reconnect; resolves early when the signal aborts. */
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** The pause before following a stream again after it dropped; 1 s by default. */
  readonly reconnectDelayMs?: number;
  /** How long after the operation's deadline the stream is still followed; 20 s by default. */
  readonly deadlineGraceMs?: number;
}

/** The API's error codes of a refused submission, as the chat names them. */
const ADMISSION_CODES: Readonly<Record<string, ChatAdmissionCode>> = {
  chat_challenge_failed: "challenge_failed",
  chat_busy: "busy",
  chat_request_conflict: "conflict",
  chat_not_retryable: "not_retryable",
  chat_quota_exceeded: "quota_exceeded",
  chat_budget_exhausted: "budget_exhausted",
  rate_limited: "rate_limited",
  validation_failed: "invalid_request",
};

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}

/** The statuses of an attempt still being answered, which only needs following. */
const activeStatuses: ReadonlySet<ChatOperation["status"]> = new Set(["accepted", "running"]);
/** The statuses of an attempt the API ended without an answer, which a retry may ask again. */
const failedStatuses: ReadonlySet<ChatOperation["status"]> = new Set([
  "failed",
  "interrupted",
  "cancelled",
]);

/**
 * Builds the transport. A question it already knows an operation for (from the restored
 * conversation or an earlier submission) is only followed again: no new person check, no second
 * submission, so a reload never pays twice. A new question gets one fresh token and is submitted
 * once; a refusal throws a `ChatAdmissionError` (the API's `Retry-After` kept for a spent
 * allowance), anything it cannot read is `unavailable`. Following reconnects from the last event
 * ID after a drop until a terminal event, an operation the API no longer shows the caller (404),
 * an unreadable frame, an abort, or the deadline and its grace.
 *
 * A retry follows an attempt it never saw end. Otherwise it takes one fresh token and asks the
 * failed attempt again under the caller's retry ID; an attempt it does not know (after a reload,
 * stored messages name no operation) is found first by repeating the request with the same token,
 * which the API answers with the request's latest attempt before it redeems any token. A stop
 * needs no token: a question still at its person check is abandoned and never sent, one being
 * submitted is stopped once it is admitted. A clear deletes the conversation the visitor
 * confirmed and forgets every operation.
 */
export function createApiChatAdapter(options: ApiChatAdapterOptions): ChatAdapter {
  const fetch = options.fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? wait;
  const reconnectDelayMs = options.reconnectDelayMs ?? 1_000;
  const graceMs = options.deadlineGraceMs ?? 20_000;
  /** The latest operation of each request, by request ID. */
  const operations = new Map<string, ChatOperation>();
  /** The operations whose end this tab saw: a terminal event, or a stop that found them ended. */
  const ended = new Set<string>();
  /** The requests at their person check, and those the visitor stopped there. */
  const preparing = new Set<string>();
  const abandoned = new Set<string>();
  /** The submissions sent and not yet answered, by request ID. */
  const submitting = new Map<string, Promise<unknown>>();

  function remember(raw: unknown): ChatOperation | null {
    const parsed = ChatOperationSchema.safeParse(raw);
    if (!parsed.success) return null;
    operations.set(parsed.data.requestId, parsed.data);
    if (!activeStatuses.has(parsed.data.status)) ended.add(parsed.data.operationId);
    return parsed.data;
  }

  /** One fresh person-check token; a question stopped meanwhile is not sent. */
  async function token(requestId: string, signal: AbortSignal): Promise<string> {
    preparing.add(requestId);
    let challengeToken: string;
    try {
      challengeToken = await options.challenge(signal);
    } catch {
      throw new ChatAdmissionError("challenge_failed");
    } finally {
      preparing.delete(requestId);
    }
    if (abandoned.delete(requestId)) throw new ChatAdmissionError("unavailable");
    return challengeToken;
  }

  /** Sends one admission (a question or a retry) and returns the operation it admitted. */
  function admit(
    requestId: string,
    path: string,
    body: unknown,
    signal: AbortSignal,
  ): Promise<ChatOperation> {
    const sent = (async () => {
      let response: Response;
      let answer: unknown;
      try {
        response = await fetch(`${options.basePath}${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(body),
          signal,
        });
        answer = await response.json();
      } catch {
        throw new ChatAdmissionError("unavailable");
      }
      if (!response.ok) {
        const code = ADMISSION_CODES[errorCode(answer)] ?? "unavailable";
        throw new ChatAdmissionError(
          code,
          code === "quota_exceeded" ? retryAfter(response.headers.get("retry-after")) : null,
        );
      }
      const operation = remember(answer);
      if (operation === null) throw new ChatAdmissionError("unavailable");
      return operation;
    })();
    submitting.set(requestId, sent);
    const settled = () => {
      if (submitting.get(requestId) === sent) submitting.delete(requestId);
    };
    sent.then(settled, settled);
    return sent;
  }

  async function* follow(operation: ChatOperation, signal: AbortSignal): AsyncGenerator {
    const closesAt = Date.parse(operation.deadlineAt) + graceMs;
    let lastEventId: string | null = null;
    for (let connection = 0; ; connection += 1) {
      if (connection > 0) {
        await sleep(reconnectDelayMs, signal);
        if (signal.aborted || now() > closesAt) return;
      }
      let response: Response;
      try {
        response = await fetch(
          `${options.basePath}/operations/${encodeURIComponent(operation.operationId)}/events`,
          {
            headers: {
              accept: "text/event-stream",
              ...(lastEventId === null ? {} : { "last-event-id": lastEventId }),
            },
            signal,
          },
        );
      } catch {
        if (signal.aborted) return;
        continue;
      }
      if (response.status === 404) return;
      if (!response.ok || response.body === null) continue;

      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      const parser = createSseParser();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const frame of parser.push(value)) {
            if (frame.event !== "chat" && frame.event !== "progress") continue;
            const event = parseJson(frame.data);
            if (frame.event === "chat" && frame.id !== null) lastEventId = frame.id;
            if (isTerminal(event)) ended.add(operation.operationId);
            yield event;
            // An unreadable frame fails the answer; there is nothing more worth following.
            if (event === frame.data || isTerminal(event)) return;
          }
        }
      } catch {
        if (signal.aborted) return;
      } finally {
        reader.cancel().catch(() => undefined);
      }
    }
  }

  return {
    async restore({ before, signal }) {
      const query = before === undefined || before === null ? "" : `?before=${before}`;
      const response = await fetch(`${options.basePath}/conversation${query}`, {
        headers: { accept: "application/json" },
        signal,
      });
      if (!response.ok)
        throw new Error(`The conversation could not be read: ${String(response.status)}.`);
      const page: unknown = await response.json();
      if (typeof page === "object" && page !== null && "activeOperation" in page) {
        remember(page.activeOperation);
      }
      return page;
    },
    async *send(question, { signal }) {
      let operation = operations.get(question.requestId);
      if (operation === undefined) {
        const challengeToken = await token(question.requestId, signal);
        operation = await admit(
          question.requestId,
          "/conversation/messages",
          { ...question, challengeToken },
          signal,
        );
      }
      yield* follow(operation, signal);
    },
    async *retry(question, { retryId, signal }) {
      const { requestId } = question;
      abandoned.delete(requestId);
      const known = operations.get(requestId);
      if (known !== undefined && !ended.has(known.operationId)) {
        yield* follow(known, signal);
        return;
      }
      const challengeToken = await token(requestId, signal);
      let failed = known;
      if (failed === undefined) {
        const latest = await admit(
          requestId,
          "/conversation/messages",
          { ...question, challengeToken },
          signal,
        );
        if (!failedStatuses.has(latest.status)) {
          yield* follow(latest, signal);
          return;
        }
        failed = latest;
      }
      const next = await admit(
        requestId,
        `/operations/${encodeURIComponent(failed.operationId)}/retry`,
        { retryId, challengeToken },
        signal,
      );
      yield* follow(next, signal);
    },
    async stop(requestId, { signal }) {
      if (preparing.has(requestId)) {
        abandoned.add(requestId);
        return "none";
      }
      await submitting.get(requestId)?.catch(() => undefined);
      const operation = operations.get(requestId);
      if (operation === undefined) return "none";
      const response = await fetch(
        `${options.basePath}/operations/${encodeURIComponent(operation.operationId)}/stop`,
        { method: "POST", headers: { accept: "application/json" }, signal },
      );
      if (!response.ok)
        throw new Error(`The answer could not be stopped: ${String(response.status)}.`);
      remember(await response.json().catch(() => null));
      return "stopped";
    },
    async clear(conversationId, { signal }) {
      const response = await fetch(`${options.basePath}/conversation`, {
        method: "DELETE",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ conversationId }),
        signal,
      });
      if (!response.ok)
        throw new Error(`The conversation could not be cleared: ${String(response.status)}.`);
      const answer: unknown = await response.json();
      if (typeof answer === "object" && answer !== null && "cleared" in answer && answer.cleared) {
        operations.clear();
        ended.clear();
      }
      return answer;
    },
  };
}

export interface ApiUsageReaderOptions {
  /** The browser's `fetch`; the cookie goes with every same-origin request. */
  readonly fetch: typeof globalThis.fetch;
  /** Where the chat routes are, such as `/api/chat`. */
  readonly basePath: string;
}

/**
 * Builds the read of the caller's usage snapshot: a plain GET that never admits, retries or
 * consumes anything. It returns the body unchecked and throws when it cannot be read.
 */
export function createApiUsageReader(
  options: ApiUsageReaderOptions,
): (signal: AbortSignal) => Promise<unknown> {
  return async (signal) => {
    const response = await options.fetch(`${options.basePath}/usage`, {
      method: "GET",
      headers: { accept: "application/json" },
      signal,
    });
    if (!response.ok) throw new Error(`The usage could not be read: ${String(response.status)}.`);
    return (await response.json()) as unknown;
  };
}

function parseJson(data: string): unknown {
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return data;
  }
}

function isTerminal(event: unknown): boolean {
  return (
    typeof event === "object" &&
    event !== null &&
    "type" in event &&
    (event.type === "complete" || event.type === "error")
  );
}

function errorCode(body: unknown): string {
  if (typeof body !== "object" || body === null || !("error" in body)) return "";
  const error = body.error;
  if (typeof error !== "object" || error === null || !("code" in error)) return "";
  return typeof error.code === "string" ? error.code : "";
}

/** The `Retry-After` seconds, or null when it is missing or a date. */
function retryAfter(header: string | null): number | null {
  if (header === null || !/^\d{1,9}$/.test(header.trim())) return null;
  return Number(header.trim());
}
