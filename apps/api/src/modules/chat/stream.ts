import type { ChatProgress, ChatStreamEvent } from "@sebela/contracts";
import type { ChatCaller, ChatObservation, ChatService } from "@sebela/services";

/** How often the event stream reads the stored state, signs of life and the grace after deadline. */
export interface ChatTiming {
  readonly pollMs: number;
  readonly progressMs: number;
  readonly graceMs: number;
}

export const defaultChatTiming: ChatTiming = { pollMs: 500, progressMs: 4_000, graceMs: 15_000 };

export interface ChatStreamOptions {
  readonly chat: Pick<ChatService, "observe">;
  readonly caller: ChatCaller;
  /** The caller's operation as it was first observed. */
  readonly first: ChatObservation;
  /** The last chat event the client saw, `-1` for none. */
  readonly lastEventId: number;
  readonly now: () => number;
  readonly timing: ChatTiming;
  readonly headers: Record<string, string>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The `Last-Event-ID` a client sent, or `-1` when it sent none or nonsense. */
export function lastEventIdOf(header: string | undefined): number {
  if (header === undefined || !/^\d{1,9}$/.test(header.trim())) return -1;
  return Number(header.trim());
}

/**
 * The server-sent events of one operation. Stored events after `lastEventId` are sent as `chat`
 * frames with their event ID, so a reconnect replays the same identifiers; while the operation
 * runs, an anonymous `progress` frame follows at once and then at least every `progressMs`. The
 * stream ends at the terminal event, or after the deadline and its grace with a retryable
 * `timeout` error. It only reads: the supervisor records the interruption. A client that goes away
 * stops the polling.
 */
export function chatEventStream(options: ChatStreamOptions): Response {
  const { chat, caller, timing, now } = options;
  const operationId = options.first.operation.operationId;
  const encoder = new TextEncoder();
  const progressEvery = Math.max(1, Math.ceil(timing.progressMs / timing.pollMs));
  const closesAt = Date.parse(options.first.operation.deadlineAt) + timing.graceMs;
  let cancelled = false;

  const run = async (controller: ReadableStreamDefaultController<Uint8Array>) => {
    const write = (frame: string) => {
      if (!cancelled) controller.enqueue(encoder.encode(frame));
    };
    const send = (event: ChatStreamEvent) => {
      write(`event: chat\nid: ${String(event.eventId)}\ndata: ${JSON.stringify(event)}\n\n`);
    };
    let observation = options.first;
    let sent = options.lastEventId;
    for (let poll = 0; ; poll += 1) {
      for (const event of observation.events) {
        if (event.eventId > sent) {
          send(event);
          sent = event.eventId;
        }
      }
      if (observation.terminal) break;
      if (now() > closesAt) {
        send({
          requestId: observation.operation.requestId,
          messageId: observation.assistant.id,
          eventId: Math.max(observation.events.length, sent + 1),
          type: "error",
          code: "timeout",
          retryable: true,
        });
        break;
      }
      if (poll % progressEvery === 0) {
        const progress: ChatProgress = {
          type: "progress",
          requestId: observation.operation.requestId,
          stage: observation.stage,
          elapsedMs: observation.elapsedMs,
        };
        write(`event: progress\ndata: ${JSON.stringify(progress)}\n\n`);
      }
      await sleep(timing.pollMs);
      if (cancelled) return;
      const next = await chat.observe(caller, operationId);
      if (next === null) break;
      observation = next;
    }
    if (!cancelled) controller.close();
  };

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      run(controller).catch((error: unknown) => {
        if (!cancelled) controller.error(error);
      });
    },
    cancel() {
      cancelled = true;
    },
  });
  return new Response(body, {
    status: 200,
    headers: {
      ...options.headers,
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
