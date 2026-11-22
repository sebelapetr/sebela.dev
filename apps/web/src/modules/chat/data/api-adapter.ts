// The chat's transport over the website's same-origin chat routes (`/api/chat/*`), which relay to
// the API: it reads the caller's conversation, admits a new question with a person check, and
// follows an admitted question's event stream, reconnecting where it left off.
import { ChatOperationSchema, type ChatOperation } from "@sebela/contracts";

import type { ChatAdapter, ChatQuestion } from "../types/adapter";
import { ChatAdmissionError, type ChatAdmissionCode } from "./admission";
import { createSseParser } from "./sse";

export interface ApiChatAdapterOptions {
  /** The browser's `fetch`; the cookie goes with every same-origin request. */
  readonly fetch: typeof globalThis.fetch;
  /** Where the chat routes are, such as `/api/chat`. */
  readonly basePath: string;
  /** Gives a fresh person-check token for one new question; rejects when the check fails. */
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

/**
 * Builds the transport. A question it already knows an operation for (from the restored
 * conversation or an earlier submission) is only followed again: no new person check, no second
 * submission, so a retry or a reload never pays twice. A new question gets one fresh token and is
 * submitted once; a refusal throws a `ChatAdmissionError` (the API's `Retry-After` kept for a spent
 * allowance), anything it cannot read is `unavailable`. Following reconnects from the last event
 * ID after a drop until a terminal event, an operation the API no longer shows the caller (404),
 * an unreadable frame, an abort, or the deadline and its grace.
 */
export function createApiChatAdapter(options: ApiChatAdapterOptions): ChatAdapter {
  const fetch = options.fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? wait;
  const reconnectDelayMs = options.reconnectDelayMs ?? 1_000;
  const graceMs = options.deadlineGraceMs ?? 20_000;
  const operations = new Map<string, ChatOperation>();

  function remember(raw: unknown): ChatOperation | null {
    const parsed = ChatOperationSchema.safeParse(raw);
    if (!parsed.success) return null;
    operations.set(parsed.data.requestId, parsed.data);
    return parsed.data;
  }

  async function submit(question: ChatQuestion, signal: AbortSignal): Promise<ChatOperation> {
    let challengeToken: string;
    try {
      challengeToken = await options.challenge(signal);
    } catch {
      throw new ChatAdmissionError("challenge_failed");
    }
    let response: Response;
    let body: unknown;
    try {
      response = await fetch(`${options.basePath}/conversation/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ ...question, challengeToken }),
        signal,
      });
      body = await response.json();
    } catch {
      throw new ChatAdmissionError("unavailable");
    }
    if (!response.ok) {
      const code = ADMISSION_CODES[errorCode(body)] ?? "unavailable";
      throw new ChatAdmissionError(
        code,
        code === "quota_exceeded" ? retryAfter(response.headers.get("retry-after")) : null,
      );
    }
    const operation = remember(body);
    if (operation === null) throw new ChatAdmissionError("unavailable");
    return operation;
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
      const operation = operations.get(question.requestId) ?? (await submit(question, signal));
      yield* follow(operation, signal);
    },
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
