// The phase 3 chat transport: prepared answers streamed in the browser as contract events, so the
// chat is built against streaming before the assistant exists. Phase 7 replaces it with the API's
// adapter behind the same `ChatAdapter`.
import type { ChatErrorCode, ChatStreamEvent, ChatSubmission } from "@sebela/contracts";

import type { ChatAdapter } from "../types/adapter";
import type { AskEvidence } from "./evidence";
import { declinedAnswer, preparedAnswer } from "./prepared-answers";

/**
 * A failure the mock can play instead of its answer, so every recovery path of the chat is
 * exercised before a real assistant exists:
 * - `error-before-start`: a retryable `unavailable` error as the only event;
 * - `transport-failure`: the transport throws before the first event;
 * - `stall`: start and a partial answer, then nothing until the request is aborted;
 * - `interrupt`: start and a partial answer, then the stream ends without a terminal event;
 * - `error-after-start`: a partial answer, then a retryable `internal` error;
 * - `not-retryable`: an `invalid_request` error a retry cannot help;
 * - `refused`: the declined reply, completed as `refused`;
 * - `duplicates`: the normal answer with every event delivered twice;
 * - `invalid-payload`: a partial answer, then a block of a type the contract does not know.
 */
export const mockChatScenarios = [
  "error-before-start",
  "transport-failure",
  "stall",
  "interrupt",
  "error-after-start",
  "not-retryable",
  "refused",
  "duplicates",
  "invalid-payload",
] as const;

export type MockChatScenario = (typeof mockChatScenarios)[number];

/** The known scenario names of a list, in order; nothing for anything but a list. */
export function parseMockChatScenarios(value: unknown): MockChatScenario[] {
  if (!Array.isArray(value)) return [];
  return value.filter((name): name is MockChatScenario =>
    (mockChatScenarios as readonly unknown[]).includes(name),
  );
}

export interface MockChatAdapterOptions {
  /** The public profile the answers rest on, reduced for the browser. */
  readonly evidence: AskEvidence;
  /** The pause before each streamed piece; 40 ms by default. */
  readonly chunkDelayMs?: number;
  /** Waits the given time unless the signal aborts first; a timer by default. */
  readonly wait?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Creates the identifier of each assistant message; `crypto.randomUUID` by default. */
  readonly createId?: () => string;
  /** The scenario to play for the next question, asked once per question; none: answer normally. */
  readonly nextScenario?: () => MockChatScenario | null;
}

const DEFAULT_CHUNK_DELAY_MS = 40;

/** How many words each streamed piece carries. */
const WORDS_PER_CHUNK = 3;

function timer(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const done = () => {
      clearTimeout(id);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const id = setTimeout(done, ms);
    signal.addEventListener("abort", done);
  });
}

/** Never settles until the signal aborts. */
function aborted(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve();
    else
      signal.addEventListener("abort", () => {
        resolve();
      });
  });
}

/** The text in pieces of a few words, each keeping its following whitespace. */
function chunks(text: string): string[] {
  const words = text.match(/\S+\s*/g) ?? [];
  const pieces: string[] = [];
  for (let i = 0; i < words.length; i += WORDS_PER_CHUNK) {
    pieces.push(words.slice(i, i + WORDS_PER_CHUNK).join(""));
  }
  return pieces;
}

/**
 * A chat adapter that answers from the prepared answers: start, the text in deltas of a few words
 * with a pause before each, each block, the sources (none for an answer that rests on none), the
 * related links, then the completion with the answer's outcome. Every such stream satisfies the
 * chat contract (`validateChatStream`); a scenario from `nextScenario` plays a failure instead.
 * Aborting stops it between events.
 */
export function createMockChatAdapter(options: MockChatAdapterOptions): ChatAdapter {
  const delay = options.chunkDelayMs ?? DEFAULT_CHUNK_DELAY_MS;
  const wait = options.wait ?? timer;
  const createId = options.createId ?? (() => crypto.randomUUID());

  const nextScenario = options.nextScenario ?? (() => null);

  return {
    async *send(submission: ChatSubmission, { signal }: { readonly signal: AbortSignal }) {
      const scenario = nextScenario();
      if (scenario === "transport-failure") throw new Error("The mock transport failed.");
      const answer =
        scenario === "refused"
          ? declinedAnswer(options.evidence)
          : preparedAnswer(options.evidence, submission.question);
      const messageId = createId();
      let eventId = 0;
      const base = () => ({ requestId: submission.requestId, messageId, eventId: eventId++ });
      const deltas = chunks(answer.text).map((text) => (): ChatStreamEvent => ({
        ...base(),
        type: "text_delta",
        text,
      }));
      const start = (): ChatStreamEvent => ({ ...base(), type: "start" });
      const error = (code: ChatErrorCode, retryable: boolean) => (): ChatStreamEvent => ({
        ...base(),
        type: "error",
        code,
        retryable,
      });

      let events: (() => unknown)[];
      switch (scenario) {
        case "error-before-start":
          events = [error("unavailable", true)];
          break;
        case "not-retryable":
          events = [error("invalid_request", false)];
          break;
        case "stall":
        case "interrupt":
          events = [start, ...deltas.slice(0, scenario === "stall" ? 1 : 2)];
          break;
        case "error-after-start":
          events = [start, ...deltas.slice(0, 2), error("internal", true)];
          break;
        case "invalid-payload":
          events = [
            start,
            ...deltas.slice(0, 2),
            () => ({ ...base(), type: "block", block: { type: "HtmlCard", html: "<p>Card</p>" } }),
          ];
          break;
        default:
          events = [
            start,
            ...deltas,
            ...answer.blocks.map((block) => (): ChatStreamEvent => ({
              ...base(),
              type: "block",
              block,
            })),
            ...(answer.sources.length > 0
              ? [
                  (): ChatStreamEvent => ({
                    ...base(),
                    type: "sources",
                    sources: [...answer.sources],
                  }),
                ]
              : []),
            () => ({ ...base(), type: "related", links: [...answer.related] }),
            () => ({ ...base(), type: "complete", outcome: answer.outcome }),
          ];
      }
      for (const [index, next] of events.entries()) {
        if (index > 0) await wait(delay, signal);
        if (signal.aborted) return;
        const raw = next();
        yield raw;
        if (scenario === "duplicates") yield raw;
      }
      if (scenario === "stall") await aborted(signal);
    },
  };
}
