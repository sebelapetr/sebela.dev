"use client";

// The chat's store for this tab, shared by the hero and the Ask page: one store per page load,
// created on first use in the browser and answered by the API through the website's same-origin
// chat routes, so a conversation keeps streaming across client navigation and opening it again
// never resends. The server renders an empty chat.
import { useCallback, useSyncExternalStore } from "react";

import { createApiChatAdapter } from "../data/api-adapter";
import { createTurnstileChallenge, turnstileScriptUrl, type TurnstileApi } from "../data/challenge";
import {
  createConversationStore,
  createMemoryStorage,
  handOffQuestion,
  type ChatStorage,
  type ConversationSnapshot,
  type ConversationStore,
} from "../stores/conversation-store";

/** Where the website relays the visitor chat routes to the API. */
const chatBasePath = "/api/chat";

const emptySnapshot: ConversationSnapshot = {
  history: "loading",
  turns: [],
  busy: true,
  retentionDays: null,
  earlier: "none",
};

const createId = () => crypto.randomUUID();

declare global {
  interface Window {
    /** Turnstile's API, once its script has loaded. */
    turnstile?: TurnstileApi;
  }
}

let storage: ChatStorage | undefined;
let current:
  | {
      readonly siteKey: string | null;
      readonly available: boolean;
      readonly store: ConversationStore;
    }
  | undefined;
let turnstile: Promise<TurnstileApi> | undefined;
/** The element the person check is shown in, while the chat is on the page. */
let challengeContainer: HTMLElement | null = null;

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

/** Loads Turnstile's script once; a load that failed is tried again by the next question. */
function loadTurnstile(): Promise<TurnstileApi> {
  turnstile ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = turnstileScriptUrl;
    script.async = true;
    script.addEventListener("load", () => {
      if (window.turnstile === undefined) reject(new Error("The person check did not load."));
      else resolve(window.turnstile);
    });
    script.addEventListener("error", () => {
      script.remove();
      reject(new Error("The person check could not be loaded."));
    });
    document.head.append(script);
  }).catch((error: unknown) => {
    turnstile = undefined;
    throw error;
  });
  return turnstile;
}

/** The tab's store, kept while the site key and the chat's availability stay. */
function conversationStore(siteKey: string | null, available: boolean): ConversationStore {
  if (current?.siteKey !== siteKey || current.available !== available) {
    current = {
      siteKey,
      available,
      store: createConversationStore({
        adapter: createApiChatAdapter({
          fetch: (input, init) => window.fetch(input, init),
          basePath: chatBasePath,
          challenge: createTurnstileChallenge({
            load: loadTurnstile,
            container: () => challengeContainer,
            siteKey,
          }),
        }),
        storage: chatStorage(),
        createId,
        available,
      }),
    };
  }
  return current.store;
}

/**
 * The visitor's conversation and what can be done with it. `siteKey` is the public key of the
 * person check; `available` is false on a website without the chat, which then asks the API nothing;
 * `challengeRef` goes on the element the check is shown in when it needs the visitor.
 */
export function useConversation(siteKey: string | null, available: boolean) {
  const store = useCallback(() => conversationStore(siteKey, available), [siteKey, available]);
  const subscribe = useCallback((listener: () => void) => store().subscribe(listener), [store]);
  const snapshot = useSyncExternalStore(
    subscribe,
    () => store().getSnapshot(),
    () => emptySnapshot,
  );
  const open = useCallback((handOffId: string | null) => store().open(handOffId), [store]);
  /** The store's state now, which may be ahead of the snapshot this render shows. */
  const now = useCallback(() => store().getSnapshot(), [store]);
  const submit = useCallback((question: string) => store().submit(question), [store]);
  const retry = useCallback((requestId: string) => store().retry(requestId), [store]);
  const loadEarlier = useCallback(() => store().loadEarlier(), [store]);
  const challengeRef = useCallback((element: HTMLElement | null) => {
    challengeContainer = element;
  }, []);
  return { snapshot, current: now, open, submit, retry, loadEarlier, challengeRef };
}

/**
 * Leaves the hero's question for the Ask page and returns the random hand-off address that takes
 * it there (null for an empty or too long question). The question never goes into the address.
 */
export function handOff(question: string): string | null {
  return handOffQuestion(chatStorage(), question, createId);
}
