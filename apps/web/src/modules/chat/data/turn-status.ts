import type { ChatTurn } from "./conversation";

export type ChatTurnState =
  | "pending"
  | "streaming"
  | "answered"
  | "insufficient_evidence"
  | "refused"
  | "unavailable"
  | "failed"
  | "interrupted";

export interface ChatTurnDescription {
  readonly state: ChatTurnState;
  readonly tag: string | null;
  readonly note: string | null;
  readonly retry: boolean;
  readonly announcement: string;
}

export function describeChatTurn(turn: ChatTurn): ChatTurnDescription {
  throw new Error("not implemented: " + turn.requestId);
}
