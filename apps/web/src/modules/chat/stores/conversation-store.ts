// The chat's state in this tab: the caller's one conversation as the API stores it, the question in
// flight and the hand-off of a question from the hero. The API resolves the conversation from the
// visitor's cookie; an address on the page never authorises anything.
import {
  chatQuestionMaxLength,
  type ChatAssistantMessage,
  type ChatConversation,
} from "@sebela/contracts";

import { ChatAdmissionError } from "../data/admission";
import {
  canRetryChatTurn,
  endChatStream,
  isChatTurnOpen,
  receiveChatEvent,
  rejectChatTurn,
  restartChatTurn,
  startChatTurn,
  timeOutChatTurn,
  type ChatTurn,
} from "../data/conversation";
import { historyTurns, parseChatConversation } from "../data/history";
import type { ChatAdapter, ChatQuestion } from "../types/adapter";

/** The part of `sessionStorage` the hand-off uses, so tests and a fallback can stand in for it. */
export interface ChatStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** What the chat shows. */
export interface ConversationSnapshot {
  /**
   * Whether the stored conversation is still being read, was read or could not be read; or the
   * website has no chat, so nothing is read and no question can be sent.
   */
  readonly history: "loading" | "ready" | "failed" | "unavailable";
  /** The conversation's questions and answers, oldest first. */
  readonly turns: readonly ChatTurn[];
  /** The history is loading or a question is answering; another cannot be sent. */
  readonly busy: boolean;
  /** How many days the conversation is kept after its last activity; null until it is read. */
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
   * foreign `handOffId` sends nothing and shows the caller's own conversation. On a website
   * without the chat it reads nothing and gives a handed-off question back.
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
  /**
   * Whether the website has the chat; when false the store never calls the adapter and every
   * question is refused as busy. True by default.
   */
  readonly available?: boolean;
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

interface Attempt {
  readonly requestId: string;
  readonly controller: AbortController;
}

/**
 * Builds the tab's store. Every raw event goes through the turn's contract checks; an event of an
 * attempt that was replaced, timed out or abandoned is ignored. An admission refusal fails the
 * turn with its reason and no answer; a transport that throws or ends early interrupts it; an
 * answer quiet for longer than the idle time (no event and no sign of life) fails as timed out and
 * is no longer followed. A failure is never retried by the store.
 */
export function createConversationStore(options: ConversationStoreOptions): ConversationStore {
  const { adapter, storage, createId } = options;
  const idleTimeoutMs = options.idleTimeoutMs ?? 20_000;
  const listeners = new Set<() => void>();
  const taken = new Set<string>();

  const available = options.available ?? true;

  let history: ConversationSnapshot["history"] = available ? "loading" : "unavailable";
  let turns: readonly ChatTurn[] = [];
  let retentionDays: number | null = null;
  let earlier: ConversationSnapshot["earlier"] = "none";
  let cursor: string | null = null;
  let carried: ChatAssistantMessage | null = null;
  let attempt: Attempt | null = null;
  let restoring: Promise<void> | null = null;
  let snapshot: ConversationSnapshot | null = null;

  const isBusy = () =>
    history === "loading" || history === "unavailable" || turns.some(isChatTurnOpen);

  function changed(): void {
    snapshot = null;
    for (const listener of listeners) listener();
  }

  function update(requestId: string, change: (turn: ChatTurn) => ChatTurn): void {
    const index = turns.findIndex((turn) => turn.requestId === requestId);
    const turn = turns[index];
    if (turn === undefined) return;
    const next = change(turn);
    if (next === turn) return;
    turns = turns.with(index, next);
    changed();
  }

  function stop(current: Attempt): void {
    current.controller.abort();
    if (attempt === current) attempt = null;
  }

  async function follow(question: ChatQuestion): Promise<void> {
    if (attempt !== null) stop(attempt);
    const current: Attempt = { requestId: question.requestId, controller: new AbortController() };
    attempt = current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const quiet = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (attempt !== current) return;
        stop(current);
        update(question.requestId, timeOutChatTurn);
      }, idleTimeoutMs);
    };
    quiet();
    try {
      for await (const raw of adapter.send(question, { signal: current.controller.signal })) {
        if (attempt !== current) return;
        quiet();
        update(question.requestId, (turn) => receiveChatEvent(turn, raw));
        if (!turns.some((turn) => turn.requestId === question.requestId && isChatTurnOpen(turn)))
          return;
      }
      if (attempt === current) update(question.requestId, endChatStream);
    } catch (error) {
      if (attempt !== current) return;
      update(question.requestId, (turn) =>
        error instanceof ChatAdmissionError
          ? rejectChatTurn(turn, error.code, error.retryAfterSeconds)
          : endChatStream(turn),
      );
    } finally {
      clearTimeout(timer);
      if (attempt === current) stop(current);
    }
  }

  function readHistory(page: ChatConversation): void {
    const active = page.activeOperation;
    const read = historyTurns(page.messages, {
      carried: null,
      activeRequestId: active?.requestId ?? null,
    });
    turns = read.turns;
    carried = read.leading;
    cursor = page.nextCursor;
    earlier = cursor === null ? "none" : "available";
    retentionDays = page.retentionDays;
    history = "ready";
    changed();
    const running =
      active === null ? undefined : turns.find((turn) => turn.requestId === active.requestId);
    if (running !== undefined && isChatTurnOpen(running)) {
      void follow({ requestId: running.requestId, question: running.question });
    }
  }

  async function restore(): Promise<void> {
    try {
      const page = parseChatConversation(
        await adapter.restore({ signal: new AbortController().signal }),
      );
      if (page === null) throw new Error("The conversation is not one the contract allows.");
      readHistory(page);
    } catch {
      history = "failed";
      changed();
    }
  }

  function takeHandOff(id: string): string | null {
    if (taken.has(id)) return null;
    taken.add(id);
    try {
      const question = storage.getItem(handOffKey(id));
      storage.removeItem(handOffKey(id));
      return question;
    } catch {
      return null;
    }
  }

  function submit(question: string): SubmitResult {
    const trimmed = validQuestion(question);
    if (trimmed === null) return "invalid";
    if (isBusy()) return "busy";
    const turn = startChatTurn(createId(), trimmed);
    turns = [...turns, turn];
    changed();
    void follow({ requestId: turn.requestId, question: turn.question });
    return "sent";
  }

  return {
    getSnapshot() {
      snapshot ??= { history, turns, busy: isBusy(), retentionDays, earlier };
      return snapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async open(handOffId) {
      if (available) {
        restoring ??= restore();
        await restoring;
      }
      if (handOffId === null) return { kind: "shown" };
      const question = takeHandOff(handOffId);
      if (question === null) return { kind: "shown" };
      if (isBusy()) return { kind: "held", question };
      return submit(question) === "sent" ? { kind: "sent" } : { kind: "shown" };
    },
    async loadEarlier() {
      if (earlier !== "available" || cursor === null) return;
      earlier = "loading";
      changed();
      try {
        const page = parseChatConversation(
          await adapter.restore({ before: cursor, signal: new AbortController().signal }),
        );
        if (page === null) throw new Error("The conversation is not one the contract allows.");
        const read = historyTurns(page.messages, { carried, activeRequestId: null });
        const shown = new Set(turns.map((turn) => turn.requestId));
        turns = [...read.turns.filter((turn) => !shown.has(turn.requestId)), ...turns];
        carried = read.leading;
        cursor = page.nextCursor;
        earlier = cursor === null ? "none" : "available";
      } catch {
        earlier = "available";
      }
      changed();
    },
    submit,
    retry(requestId) {
      const latest = turns.at(-1);
      if (latest?.requestId !== requestId || !canRetryChatTurn(latest)) {
        return isBusy() && latest?.requestId === requestId ? "busy" : "not_retryable";
      }
      if (isBusy()) return "busy";
      // An attempt the API never ended may still be admitted: follow or ask it under its request.
      const next =
        latest.attempt.terminal === null
          ? restartChatTurn(latest)
          : startChatTurn(createId(), latest.question);
      turns = [...turns.slice(0, -1), next];
      changed();
      void follow({ requestId: next.requestId, question: next.question });
      return "sent";
    },
  };
}
