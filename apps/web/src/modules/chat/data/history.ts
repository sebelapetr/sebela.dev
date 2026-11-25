// The stored conversation the API returns, turned into the chat's turns: one page at a time,
// newest page first, so earlier pages are put in front.
import {
  ChatConversationSchema,
  chatReplayEvents,
  type ChatAssistantMessage,
  type ChatConversation,
  type ChatMessage,
  type ChatUserMessage,
} from "@sebela/contracts";

import { endChatStream, receiveChatEvent, startChatTurn, type ChatTurn } from "./conversation";

/** The page of the caller's conversation, or null when it is not one the contract allows. */
export function parseChatConversation(raw: unknown): ChatConversation | null {
  const parsed = ChatConversationSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

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

/**
 * Pairs each stored question with the answer stored right after it for the same request, and
 * replays that answer through the same checks as a live stream. The running operation's answer
 * stays open; any other answer that never ended, or a question without its answer, shows as
 * interrupted. An answer that follows no question of its request is dropped, except the page's
 * first message, which belongs to the page before. Pure.
 */
export function historyTurns(
  messages: readonly ChatMessage[],
  options: HistoryTurnsOptions,
): HistoryTurns {
  const first = messages[0];
  const leading = first?.role === "assistant" ? first : null;
  const turns: ChatTurn[] = [];
  messages.forEach((message, index) => {
    if (message.role !== "user") return;
    const next = index + 1 < messages.length ? messages[index + 1] : options.carried;
    const answer = next?.role === "assistant" && next.requestId === message.requestId ? next : null;
    turns.push(storedTurn(message, answer, options.activeRequestId));
  });
  return { turns, leading };
}

function storedTurn(
  question: ChatUserMessage,
  answer: ChatAssistantMessage | null,
  activeRequestId: string | null,
): ChatTurn {
  const turn = startChatTurn(question.requestId, question.text);
  if (answer === null || answer.status === "pending") {
    return question.requestId === activeRequestId ? turn : endChatStream(turn);
  }
  const model = answer.model === null ? null : { name: answer.model, effort: answer.effort };
  if (answer.status === "interrupted") return { ...endChatStream(turn), model };
  return { ...chatReplayEvents(question.requestId, answer).reduce(receiveChatEvent, turn), model };
}
