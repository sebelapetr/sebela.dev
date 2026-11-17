import type {
  ChatAttempt,
  ChatBlock,
  ChatErrorCode,
  ChatOutcome,
  ChatRelatedLink,
  ChatSource,
} from "@sebela/contracts";

/**
 * Where one question's answer stands: waiting for its first event, streaming, complete (with its
 * outcome), failed (with an error) or interrupted (its stream ended without a terminal event).
 */
export type ChatTurnStatus = "pending" | "streaming" | "complete" | "failed" | "interrupted";

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
  readonly error: { readonly code: ChatErrorCode; readonly retryable: boolean } | null;
}

export const startChatTurn: (requestId: string, question: string) => ChatTurn = () => {
  throw new Error("not implemented");
};

export const receiveChatEvent: (turn: ChatTurn, raw: unknown) => ChatTurn = () => {
  throw new Error("not implemented");
};

export const endChatStream: (turn: ChatTurn) => ChatTurn = () => {
  throw new Error("not implemented");
};
