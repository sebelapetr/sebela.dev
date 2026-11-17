"use client";

// The chat's store for this tab, shared by the hero and the Ask page: one store per page load,
// created on first use in the browser, so a conversation keeps streaming across client navigation
// and opening it again never resends. The server renders an empty chat.
import { useCallback, useMemo, useSyncExternalStore } from "react";

import type { AskEvidence } from "../data/evidence";
import { createMockChatAdapter } from "../data/mock-adapter";
import {
  createConversationStore,
  createMemoryStorage,
  handOffQuestion,
  type ChatStorage,
  type ConversationSnapshot,
  type ConversationStore,
} from "../stores/conversation-store";

const emptySnapshot: ConversationSnapshot = { conversationId: null, turns: [], busy: false };

const createId = () => crypto.randomUUID();

let storage: ChatStorage | undefined;
let current: { readonly key: string; readonly store: ConversationStore } | undefined;

/** The tab's session storage when it can be written; otherwise one that lasts as long as the page. */
function chatStorage(): ChatStorage {
  if (storage !== undefined) return storage;
  try {
    const probe = "sebela-chat-probe";
    window.sessionStorage.setItem(probe, probe);
    window.sessionStorage.removeItem(probe);
    storage = window.sessionStorage;
  } catch {
    storage = createMemoryStorage();
  }
  return storage;
}

/** The tab's store for answers from this evidence, kept while the evidence (by `key`) stays. */
function conversationStore(key: string, evidence: AskEvidence): ConversationStore {
  if (current?.key !== key) {
    current = {
      key,
      store: createConversationStore({
        adapter: createMockChatAdapter({ evidence }),
        storage: chatStorage(),
        createId,
      }),
    };
  }
  return current.store;
}

/** The open conversation and what can be done with it, answered from the person's evidence. */
export function useConversation(evidence: AskEvidence) {
  const key = useMemo(() => JSON.stringify(evidence), [evidence]);
  const store = useCallback(() => conversationStore(key, evidence), [key, evidence]);
  const subscribe = useCallback((listener: () => void) => store().subscribe(listener), [store]);
  const snapshot = useSyncExternalStore(
    subscribe,
    () => store().getSnapshot(),
    () => emptySnapshot,
  );
  const open = useCallback(
    (conversationId: string | null) => {
      store().open(conversationId);
    },
    [store],
  );
  const submit = useCallback(
    (question: string) => {
      const current = store();
      return {
        result: current.submit(question),
        conversationId: current.getSnapshot().conversationId,
      };
    },
    [store],
  );
  const newChat = useCallback(() => {
    store().newChat();
  }, [store]);
  return { snapshot, open, submit, newChat };
}

/**
 * Leaves the hero's question for the conversation it starts and returns that conversation's random
 * address (null for an empty or too long question). The question never goes into the address.
 */
export function handOff(question: string): string | null {
  return handOffQuestion(chatStorage(), question, createId);
}
