// The chat's state in this tab: the caller's one conversation as the API stores it, the question in
// flight and the hand-off of a question from the hero. The API resolves the conversation from the
// visitor's cookie; an address on the page never authorises anything.
import { chatQuestionMaxLength } from "@sebela/contracts";

import type { ChatTurn } from "../data/conversation";
import type { ChatAdapter } from "../types/adapter";

/** The part of `sessionStorage` the hand-off uses, so tests and a fallback can stand in for it. */
export interface ChatStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** What the chat shows. */
export interface ConversationSnapshot {
  /** Whether the stored conversation is still being read, was read or could not be read. */
  readonly history: "loading" | "ready" | "failed";
  /** The conversation's questions and answers, oldest first. */
  readonly turns: readonly ChatTurn[];
  /** The history is loading or a question is answering; another cannot be sent. */
  readonly busy: boolean;
  /** How many days the conversation is kept after its last message; null until it is read. */
  readonly retentionDays: number | null;
  /** Whether older messages can be read, are being read, or there are none. */
  readonly earlier: "none" | "available" | "loading";
}

/** What became of a question: sent, refused while another is answering, or not a valid question. */
export type SubmitResult = "sent" | "busy" | "invalid";

/**
 * What opening the chat did with a question the hero handed off: sent it, only showed the
 * conversation (no hand-off, or one already taken), or held it back because an earlier answer is
 * still being prepared, giving it back for the visitor to send later.
 */
export type OpenResult =
  | { readonly kind: "sent" }
  | { readonly kind: "shown" }
  | { readonly kind: "held"; readonly question: string };

/** What became of a retry: sent, refused while another is answering, or not a turn to retry. */
export type RetryResult = "sent" | "busy" | "not_retryable";

export interface ConversationStore {
  /** The current state; the same object until something changes. */
  getSnapshot(): ConversationSnapshot;
  /** Calls the listener after every change; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  /**
   * Shows the caller's conversation. The first call reads its newest page and follows the answer
   * still being prepared, if any, without asking again; later calls read nothing. Then it sends the
   * question the hero left under `handOffId`, exactly once across opens and reloads. An unknown or
   * foreign `handOffId` sends nothing and shows the caller's own conversation.
   */
  open(handOffId: string | null): Promise<OpenResult>;
  /** Reads the page of messages before the oldest shown; a failed read leaves it available. */
  loadEarlier(): Promise<void>;
  /**
   * Sends a question (trimmed, 1 to `chatQuestionMaxLength` characters) under a new random request.
   * Refused while the history loads or another question is answering.
   */
  submit(question: string): SubmitResult;
  /**
   * Asks the latest question again when its answer was interrupted or failed with a retryable
   * error. An attempt the API never ended (interrupted, timed out on the page, not admitted) is
   * followed or asked again under the same request, so an admitted question is never paid twice;
   * an answer the API ended with an error is asked again under a new request. The failed answer is
   * replaced in place. Never called by the store itself: a failure waits for the visitor.
   */
  retry(requestId: string): RetryResult;
}

export interface ConversationStoreOptions {
  readonly adapter: ChatAdapter;
  /** Where the hero leaves its question for the Ask page (`sessionStorage`). */
  readonly storage: ChatStorage;
  /** Creates random identifiers (UUID) of requests and hand-offs. */
  readonly createId: () => string;
  /**
   * How long an answer may go without an event or a sign of life before it fails as timed out on
   * the page and stops being followed; 20 s by default.
   */
  readonly idleTimeoutMs?: number;
}

const handOffKey = (id: string) => `sebela-chat-handoff:${id}`;

/** A storage that lives as long as the page: the fallback where the tab's storage is unusable. */
export function createMemoryStorage(): ChatStorage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
    removeItem: (key) => {
      items.delete(key);
    },
  };
}

function validQuestion(question: string): string | null {
  const trimmed = question.trim();
  return trimmed.length > 0 && trimmed.length <= chatQuestionMaxLength ? trimmed : null;
}

/**
 * Leaves a question from the hero for the Ask page and returns its random hand-off address; the
 * question itself never goes into the address. Null for an invalid question or unusable storage.
 */
export function handOffQuestion(
  storage: ChatStorage,
  question: string,
  createId: () => string,
): string | null {
  const trimmed = validQuestion(question);
  if (trimmed === null) return null;
  const id = createId();
  try {
    storage.setItem(handOffKey(id), trimmed);
  } catch {
    return null;
  }
  return id;
}

export const createConversationStore: (
  options: ConversationStoreOptions,
) => ConversationStore = () => {
  throw new Error("not implemented");
};
