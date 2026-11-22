// The stored conversation the API returns, turned into the chat's turns: one page at a time,
// newest page first, so earlier pages are put in front.
import type { ChatAssistantMessage, ChatConversation, ChatMessage } from "@sebela/contracts";

import type { ChatTurn } from "./conversation";

/** The page of the caller's conversation, or null when it is not one the contract allows. */
export const parseChatConversation: (raw: unknown) => ChatConversation | null = () => {
  throw new Error("not implemented");
};

export interface HistoryTurnsOptions {
  /**
   * The answer the newer page began with, whose question is the last one of this page; null when
   * there is none.
   */
  readonly carried: ChatAssistantMessage | null;
  /** The request of the operation still running, whose answer stays open to be followed. */
  readonly activeRequestId: string | null;
}

export interface HistoryTurns {
  /** The page's questions with their answers, oldest first. */
  readonly turns: readonly ChatTurn[];
  /** The answer this page begins with, whose question is on the page before; null when none. */
  readonly leading: ChatAssistantMessage | null;
}

export const historyTurns: (
  messages: readonly ChatMessage[],
  options: HistoryTurnsOptions,
) => HistoryTurns = () => {
  throw new Error("not implemented");
};
