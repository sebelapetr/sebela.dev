// One question's answer as the chat holds it, built event by event from the stream. Every raw event
// is checked against the chat contract here, so no transport can put an unchecked payload on the
// page.
import {
  advanceChatAttempt,
  ChatProgressSchema,
  ChatStreamEventSchema,
  startChatAttempt,
  type ChatAttempt,
  type ChatBlock,
  type ChatErrorCode,
  type ChatOutcome,
  type ChatRelatedLink,
  type ChatSource,
} from "@sebela/contracts";

import type { ChatAdmissionCode } from "./admission";

/** The admission codes a new attempt may pass. */
const retryableAdmissions: ReadonlySet<ChatAdmissionCode> = new Set([
  "challenge_failed",
  "busy",
  "quota_exceeded",
  "rate_limited",
  "unavailable",
]);

/**
 * Where one question's answer stands: waiting for its first event, streaming, complete (with its
 * outcome), failed (with an error) or interrupted (its stream ended without a terminal event).
 */
export type ChatTurnStatus = "pending" | "streaming" | "complete" | "failed" | "interrupted";

/** Why an answer failed: a stream error, or a question the API did not admit. */
export type ChatTurnErrorCode = ChatErrorCode | ChatAdmissionCode;

/** The failure of a turn; `retryAfterSeconds` only where the API said when to try again. */
export interface ChatTurnError {
  readonly code: ChatTurnErrorCode;
  readonly retryable: boolean;
  readonly retryAfterSeconds?: number;
}

/** One question of a conversation and the answer received for it so far. */
export interface ChatTurn {
  readonly requestId: string;
  readonly question: string;
  readonly status: ChatTurnStatus;
  readonly attempt: ChatAttempt;
  readonly text: string;
  readonly blocks: readonly ChatBlock[];
  readonly sources: readonly ChatSource[];
  readonly related: readonly ChatRelatedLink[];
  readonly outcome: ChatOutcome | null;
  readonly error: ChatTurnError | null;
}

/** A question just sent: pending, with no answer yet. */
export function startChatTurn(requestId: string, question: string): ChatTurn {
  return {
    requestId,
    question,
    status: "pending",
    attempt: startChatAttempt(requestId),
    text: "",
    blocks: [],
    sources: [],
    related: [],
    outcome: null,
    error: null,
  };
}

/** Whether the turn is still waiting for its answer to end: pending or streaming. */
export function isChatTurnOpen(turn: ChatTurn): boolean {
  return turn.status === "pending" || turn.status === "streaming";
}

/**
 * Applies one raw event to the turn. An ended turn, a duplicate, an event for another request
 * (a late event of a cancelled one) and a progress sign of life change nothing and return the same
 * turn. A malformed or misplaced event fails the turn as an invalid stream, keeping what was
 * received. Pure.
 */
export function receiveChatEvent(turn: ChatTurn, raw: unknown): ChatTurn {
  if (!isChatTurnOpen(turn)) return turn;
  if (isProgressFrame(raw)) {
    return ChatProgressSchema.safeParse(raw).success ? turn : fail(turn, "invalid_stream");
  }
  const parsed = ChatStreamEventSchema.safeParse(raw);
  if (!parsed.success) return fail(turn, "invalid_stream");
  const event = parsed.data;
  if (event.requestId !== turn.requestId) return turn;

  const step = advanceChatAttempt(turn.attempt, event);
  if (step.status === "duplicate") return turn;
  if (step.status === "invalid") return fail(turn, "invalid_stream");

  const next: ChatTurn = { ...turn, attempt: step.attempt, status: "streaming" };
  switch (event.type) {
    case "start":
      return next;
    case "text_delta":
      return { ...next, text: turn.text + event.text };
    case "block":
      return { ...next, blocks: [...turn.blocks, event.block] };
    case "sources":
      return { ...next, sources: event.sources };
    case "related":
      return { ...next, related: event.links };
    case "complete":
      return { ...next, status: "complete", outcome: event.outcome };
    case "error":
      return { ...next, status: "failed", error: { code: event.code, retryable: event.retryable } };
  }
}

/**
 * The API did not admit the question: an open turn fails with the reason, retryable where a new
 * attempt may pass (a failed person check, a busy conversation, a spent visitor allowance, a burst
 * limit, an unreachable assistant), never for a spent site budget, a request already used or an
 * invalid question. Pure.
 */
export function rejectChatTurn(
  turn: ChatTurn,
  code: ChatAdmissionCode,
  retryAfterSeconds: number | null = null,
): ChatTurn {
  if (!isChatTurnOpen(turn)) return turn;
  const error: ChatTurnError = {
    code,
    retryable: retryableAdmissions.has(code),
    ...(retryAfterSeconds === null ? {} : { retryAfterSeconds }),
  };
  return { ...turn, status: "failed", error };
}

function isProgressFrame(raw: unknown): boolean {
  return typeof raw === "object" && raw !== null && "type" in raw && raw.type === "progress";
}

/** The stream is over: a turn still waiting for its terminal event is interrupted. */
export function endChatStream(turn: ChatTurn): ChatTurn {
  return isChatTurnOpen(turn) ? { ...turn, status: "interrupted" } : turn;
}

/** A failure found by the client (invalid stream, timeout); a new attempt may succeed. */
function fail(turn: ChatTurn, code: ChatErrorCode): ChatTurn {
  return { ...turn, status: "failed", error: { code, retryable: true } };
}

/**
 * Whether the visitor may ask for the answer again: after an interruption (an ambiguous failure,
 * so the choice is theirs) or an error the contract marks as retryable. Never for a final answer
 * or one still open.
 */
export function canRetryChatTurn(turn: ChatTurn): boolean {
  if (turn.status === "interrupted") return true;
  return turn.status === "failed" && turn.error?.retryable === true;
}

/**
 * A new attempt at the same logical request: the question and request stay, the failed answer
 * attempt is replaced and the new attempt's events are accepted from the beginning.
 */
export function restartChatTurn(turn: ChatTurn): ChatTurn {
  return startChatTurn(turn.requestId, turn.question);
}

/** Stub. */
export function stopChatTurn(turn: ChatTurn): ChatTurn {
  return turn;
}

/** No event came for too long: an open turn fails as timed out, keeping its partial answer. */
export function timeOutChatTurn(turn: ChatTurn): ChatTurn {
  return isChatTurnOpen(turn) ? fail(turn, "timeout") : turn;
}
