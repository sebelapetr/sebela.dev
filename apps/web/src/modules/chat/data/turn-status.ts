// What the chat shows and announces about where one answer stands: one description per state, so
// pending, streaming, each kind of final answer, a failure and an interruption never look alike.
import type { ChatErrorCode } from "@sebela/contracts";

import { canRetryChatTurn, type ChatTurn } from "./conversation";

/** Where an answer stands as the visitor sees it; a completion is split by its outcome. */
export type ChatTurnState =
  | "pending"
  | "streaming"
  | "answered"
  | "insufficient_evidence"
  | "refused"
  | "unavailable"
  | "failed"
  | "interrupted";

/** What the chat shows beside an answer and what the live region says as it ends. */
export interface ChatTurnDescription {
  readonly state: ChatTurnState;
  /** The short label beside "Assistant"; none for an ordinary answer. */
  readonly tag: string | null;
  /** Why the answer did not finish, and what to do when a retry cannot help; none otherwise. */
  readonly note: string | null;
  /** Whether a retry is offered (the store still allows only the latest turn's). */
  readonly retry: boolean;
  /**
   * Whether the answer's cards, sources and related pages are shown: while it streams and once it
   * is complete, never for an answer that failed or was interrupted, which is not a finished one.
   */
  readonly showsEvidence: boolean;
  readonly announcement: string;
}

const ANSWERING = "Answering…";

const ERROR_NOTES: Readonly<Record<ChatErrorCode, string>> = {
  timeout: "The answer took too long.",
  rate_limited: "Too many questions in a short time.",
  unavailable: "The assistant is unavailable right now.",
  invalid_stream: "The answer could not be read.",
  invalid_request: "This question could not be sent.",
  internal: "Something went wrong while answering.",
};

const INTERRUPTED_NOTE = "The answer stopped before it finished.";
const NOT_RETRYABLE_HINT = "Try asking something else.";
const RETRY_HINT = "You can try again.";

const OUTCOME_TAGS = {
  answered: null,
  insufficient_evidence: "Not enough evidence",
  refused: "Declined",
  unavailable: "Unavailable",
} as const;

/** Describes the turn's answer for the page and for the live region. Pure. */
export function describeChatTurn(turn: ChatTurn): ChatTurnDescription {
  switch (turn.status) {
    case "pending":
    case "streaming":
      return {
        state: turn.status,
        // A pending answer's placeholder already says it is answering.
        tag: turn.status === "streaming" ? "Answering" : null,
        note: null,
        retry: false,
        showsEvidence: true,
        announcement: ANSWERING,
      };
    case "complete": {
      const outcome = turn.outcome ?? "answered";
      return {
        state: outcome,
        tag: OUTCOME_TAGS[outcome],
        note: null,
        retry: false,
        showsEvidence: true,
        announcement: turn.text,
      };
    }
    case "failed":
    case "interrupted": {
      const retry = canRetryChatTurn(turn);
      const reason =
        turn.status === "interrupted" || turn.error === null
          ? INTERRUPTED_NOTE
          : ERROR_NOTES[turn.error.code];
      const note = retry ? reason : `${reason} ${NOT_RETRYABLE_HINT}`;
      return {
        state: turn.status,
        tag: turn.text.length > 0 ? "Incomplete" : "Not answered",
        note,
        retry,
        showsEvidence: false,
        announcement: retry ? `${note} ${RETRY_HINT}` : note,
      };
    }
  }
}
