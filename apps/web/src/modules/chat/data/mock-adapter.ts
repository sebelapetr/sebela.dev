// The phase 3 chat transport: prepared answers streamed in the browser as contract events, so the
// chat is built against streaming before the assistant exists. Phase 7 replaces it with the API's
// adapter behind the same `ChatAdapter`.
import type { ChatStreamEvent, ChatSubmission } from "@sebela/contracts";

import type { ChatAdapter } from "../types/adapter";
import { preparedAnswer } from "./prepared-answers";

export interface MockChatAdapterOptions {
  /** The person the answers are about, by name from the API. */
  readonly subjectName: string;
  /** The pause before each streamed piece; 40 ms by default. */
  readonly chunkDelayMs?: number;
  /** Waits the given time unless the signal aborts first; a timer by default. */
  readonly wait?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Creates the identifier of each assistant message; `crypto.randomUUID` by default. */
  readonly createId?: () => string;
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
 * with a pause before each, the related links, then the completion with the answer's outcome. Every
 * stream satisfies the chat contract (`validateChatStream`). Aborting stops it between events.
 */
export function createMockChatAdapter(options: MockChatAdapterOptions): ChatAdapter {
  const delay = options.chunkDelayMs ?? DEFAULT_CHUNK_DELAY_MS;
  const wait = options.wait ?? timer;
  const createId = options.createId ?? (() => crypto.randomUUID());

  return {
    async *send(submission: ChatSubmission, { signal }: { readonly signal: AbortSignal }) {
      const answer = preparedAnswer(options.subjectName, submission.question);
      const messageId = createId();
      let eventId = 0;
      const base = () => ({ requestId: submission.requestId, messageId, eventId: eventId++ });

      const events: (() => ChatStreamEvent)[] = [
        () => ({ ...base(), type: "start" }),
        ...chunks(answer.text).map((text) => (): ChatStreamEvent => ({
          ...base(),
          type: "text_delta",
          text,
        })),
        () => ({ ...base(), type: "related", links: [...answer.related] }),
        () => ({ ...base(), type: "complete", outcome: answer.outcome }),
      ];
      for (const [index, next] of events.entries()) {
        if (index > 0) await wait(delay, signal);
        if (signal.aborted) return;
        yield next();
      }
    },
  };
}
