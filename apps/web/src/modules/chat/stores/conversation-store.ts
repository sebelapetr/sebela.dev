import type { ChatAdapter } from "../types/adapter";
import type { ChatTurn } from "../data/conversation";

/** The part of `sessionStorage` the store uses, so tests and a fallback can stand in for it. */
export interface ChatStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** What the chat shows: the open conversation's address, its turns and whether one is answering. */
export interface ConversationSnapshot {
  readonly conversationId: string | null;
  readonly turns: readonly ChatTurn[];
  readonly busy: boolean;
}

export type SubmitResult = "sent" | "busy" | "invalid";

export interface ConversationStore {
  getSnapshot(): ConversationSnapshot;
  subscribe(listener: () => void): () => void;
  open(conversationId: string | null): void;
  submit(question: string): SubmitResult;
  newChat(): void;
}

export interface ConversationStoreOptions {
  readonly adapter: ChatAdapter;
  readonly storage: ChatStorage;
  readonly createId: () => string;
}

export function createMemoryStorage(): ChatStorage {
  throw new Error("not implemented");
}

export const createConversationStore: (
  options: ConversationStoreOptions,
) => ConversationStore = () => {
  throw new Error("not implemented");
};

export const handOffQuestion: (
  storage: ChatStorage,
  question: string,
  createId: () => string,
) => string | null = () => {
  throw new Error("not implemented");
};
