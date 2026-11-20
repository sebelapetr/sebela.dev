// The chat's state in this tab: the open conversation, its questions and their answers, the one
// request in flight and the hand-off of a question from the hero. Conversations live only in the
// tab's storage until phase 7 stores them on the server; the address authorises nothing.
import { z } from "zod";

import {
  ChatBlockSchema,
  ChatRelatedLinkSchema,
  ChatSourceSchema,
  chatErrorCodes,
  chatOutcomes,
  chatQuestionMaxLength,
  type ChatSubmission,
} from "@sebela/contracts";

import type { ChatAdapter } from "../types/adapter";
import {
  canRetryChatTurn,
  endChatStream,
  isChatTurnOpen,
  receiveChatEvent,
  restartChatTurn,
  startChatTurn,
  timeOutChatTurn,
  type ChatTurn,
} from "../data/conversation";

/** The part of `sessionStorage` the store uses, so tests and a fallback can stand in for it. */
export interface ChatStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** What the chat shows: the open conversation's address, its turns and whether one is answering. */
export interface ConversationSnapshot {
  /** Null until the first question of a new chat creates it. */
  readonly conversationId: string | null;
  readonly turns: readonly ChatTurn[];
  /** A question is pending or streaming; another cannot be sent. */
  readonly busy: boolean;
}

/** What became of a question: sent, refused while another is answering, or not a valid question. */
export type SubmitResult = "sent" | "busy" | "invalid";

/** What opening an address did: sent the question the hero handed off, or only showed it. */
export type OpenResult = "sent" | "shown";

/** What became of a retry: sent, refused while another is answering, or not a turn to retry. */
export type RetryResult = "sent" | "busy" | "not_retryable";

export interface ConversationStore {
  /** The current state; the same object until something changes. */
  getSnapshot(): ConversationSnapshot;
  /** Calls the listener after every change; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  /**
   * Shows the conversation at the address (null: a new, empty chat). Opening the one already open
   * changes nothing, so rerenders, back and forward never resend. Otherwise it cancels the request
   * in flight, restores the conversation from this tab (an answer that was still streaming becomes
   * interrupted; an unknown address opens empty) and sends a question handed off by the hero for
   * this address, exactly once. Says whether it sent that question or only showed the conversation.
   */
  open(conversationId: string | null): OpenResult;
  /**
   * Sends a question (trimmed, 1 to `chatQuestionMaxLength` characters) in the open conversation,
   * creating its random address for a new chat. Refused while another question is answering.
   */
  submit(question: string): SubmitResult;
  /**
   * Asks the latest question again when its answer was interrupted or failed with a retryable
   * error: the same conversation, request and question, its failed answer replaced in place and no
   * new question added. Refused while an answer is open and for any other turn. Never called by
   * the store itself: a failure waits for the visitor.
   */
  retry(requestId: string): RetryResult;
  /** Cancels the request in flight and forgets the open conversation in this tab. */
  newChat(): void;
}

export interface ConversationStoreOptions {
  readonly adapter: ChatAdapter;
  readonly storage: ChatStorage;
  /** Creates random identifiers (UUID) of conversations and requests. */
  readonly createId: () => string;
  /**
   * How long an answer may go without an event before it fails as timed out and its transport is
   * stopped; 20 s by default.
   */
  readonly idleTimeoutMs?: number;
}

const DEFAULT_IDLE_TIMEOUT_MS = 20_000;

/** The iterator's next result, or "timeout" after the given time, or "aborted" with the signal. */
function nextWithin(
  iterator: AsyncIterator<unknown>,
  ms: number,
  signal: AbortSignal,
): Promise<IteratorResult<unknown> | "timeout" | "aborted"> {
  return new Promise((resolve, reject) => {
    const settle = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", aborted);
    };
    const aborted = () => {
      settle();
      resolve("aborted");
    };
    const timer = setTimeout(() => {
      settle();
      resolve("timeout");
    }, ms);
    signal.addEventListener("abort", aborted);
    iterator.next().then(
      (result) => {
        settle();
        resolve(result);
      },
      (error: unknown) => {
        settle();
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/** Asks the transport to stop without waiting for it; a transport that cannot is ignored anyway. */
function close(iterator: AsyncIterator<unknown> | undefined): void {
  try {
    iterator?.return?.().catch(() => undefined);
  } catch {
    // Nothing more to stop.
  }
}

const conversationKey = (id: string) => `sebela-chat:${id}`;
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
 * Leaves a question from the hero for the conversation it creates and returns that conversation's
 * random address; the question itself never goes into the address. Null for an invalid question.
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

const StoredTurnSchema = z.object({
  requestId: z.string(),
  question: z.string(),
  status: z.enum(["pending", "streaming", "complete", "failed", "interrupted"]),
  attempt: z.object({
    requestId: z.string(),
    messageId: z.string().nullable(),
    lastEventId: z.int(),
    started: z.boolean(),
    sources: z.boolean(),
    related: z.boolean(),
    terminal: z
      .discriminatedUnion("type", [
        z.object({ type: z.literal("complete"), outcome: z.enum(chatOutcomes) }),
        z.object({
          type: z.literal("error"),
          code: z.enum(chatErrorCodes),
          retryable: z.boolean(),
        }),
      ])
      .nullable(),
  }),
  text: z.string(),
  blocks: z.array(ChatBlockSchema),
  sources: z.array(ChatSourceSchema),
  related: z.array(ChatRelatedLinkSchema),
  outcome: z.enum(chatOutcomes).nullable(),
  error: z.object({ code: z.enum(chatErrorCodes), retryable: z.boolean() }).nullable(),
});

const StoredConversationSchema = z.object({ turns: z.array(StoredTurnSchema) });

function take(storage: ChatStorage, key: string): string | null {
  try {
    const value = storage.getItem(key);
    storage.removeItem(key);
    return value;
  } catch {
    return null;
  }
}

/** The conversation's turns as this tab kept them; none when unknown or unreadable. */
function restore(storage: ChatStorage, id: string): readonly ChatTurn[] {
  try {
    const stored = storage.getItem(conversationKey(id));
    if (stored === null) return [];
    const parsed = StoredConversationSchema.safeParse(JSON.parse(stored));
    return parsed.success ? parsed.data.turns.map(endChatStream) : [];
  } catch {
    return [];
  }
}

function snapshot(conversationId: string | null, turns: readonly ChatTurn[]): ConversationSnapshot {
  return { conversationId, turns, busy: turns.some(isChatTurnOpen) };
}

export function createConversationStore({
  adapter,
  storage,
  createId,
  idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
}: ConversationStoreOptions): ConversationStore {
  let state = snapshot(null, []);
  let opened = false;
  let active: AbortController | null = null;
  const listeners = new Set<() => void>();

  function set(next: ConversationSnapshot): void {
    state = next;
    if (next.conversationId !== null && next.turns.length > 0) {
      try {
        storage.setItem(
          conversationKey(next.conversationId),
          JSON.stringify({ turns: next.turns }),
        );
      } catch {
        // A full or unusable storage keeps the conversation on the page only.
      }
    }
    for (const listener of listeners) listener();
  }

  function cancel(): void {
    active?.abort();
    active = null;
  }

  /** Applies a change to the turn of the request, if the open conversation still has it. */
  function update(requestId: string, change: (turn: ChatTurn) => ChatTurn): void {
    const index = state.turns.findIndex((turn) => turn.requestId === requestId);
    const turn = state.turns[index];
    if (turn === undefined) return;
    const changed = change(turn);
    if (changed === turn) return;
    set(snapshot(state.conversationId, state.turns.with(index, changed)));
  }

  /**
   * Feeds the attempt's events into its turn until the turn ends, the stream ends, nothing comes
   * for the idle time or the attempt is no longer the active one. Only the active attempt changes
   * anything: whatever a cancelled, replaced or timed-out attempt still yields is ignored, though
   * it names the same request.
   */
  async function stream(submission: ChatSubmission, controller: AbortController): Promise<void> {
    const { requestId } = submission;
    const current = () => active === controller && !controller.signal.aborted;
    let iterator: AsyncIterator<unknown> | undefined;
    let ending: (turn: ChatTurn) => ChatTurn = endChatStream;
    try {
      iterator = adapter.send(submission, { signal: controller.signal })[Symbol.asyncIterator]();
      for (;;) {
        const step = await nextWithin(iterator, idleTimeoutMs, controller.signal);
        if (!current()) return;
        if (step === "timeout") {
          ending = timeOutChatTurn;
          break;
        }
        if (step === "aborted" || step.done === true) break;
        update(requestId, (turn) => receiveChatEvent(turn, step.value));
        const turn = state.turns.find((candidate) => candidate.requestId === requestId);
        if (turn === undefined || !isChatTurnOpen(turn)) break;
      }
    } catch {
      // A transport that fails ends the stream; the answer is then interrupted.
      if (!current()) return;
    } finally {
      close(iterator);
    }
    active = null;
    controller.abort();
    update(requestId, ending);
  }

  /** Makes the submission the active attempt, shows the turns and streams its answer. */
  function send(submission: ChatSubmission, turns: readonly ChatTurn[]): void {
    const controller = new AbortController();
    active = controller;
    set(snapshot(submission.conversationId, turns));
    void stream(submission, controller);
  }

  function submit(question: string): SubmitResult {
    const trimmed = validQuestion(question);
    if (trimmed === null) return "invalid";
    if (state.busy) return "busy";
    const submission: ChatSubmission = {
      conversationId: state.conversationId ?? createId(),
      requestId: createId(),
      question: trimmed,
    };
    send(submission, [...state.turns, startChatTurn(submission.requestId, trimmed)]);
    return "sent";
  }

  function retry(requestId: string): RetryResult {
    const latest = state.turns.at(-1);
    if (latest?.requestId !== requestId || state.conversationId === null) return "not_retryable";
    if (state.busy) return "busy";
    if (!canRetryChatTurn(latest)) return "not_retryable";
    send(
      { conversationId: state.conversationId, requestId, question: latest.question },
      state.turns.with(-1, restartChatTurn(latest)),
    );
    return "sent";
  }

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    open(conversationId) {
      if (opened && conversationId === state.conversationId) return "shown";
      opened = true;
      cancel();
      if (conversationId === null) {
        set(snapshot(null, []));
        return "shown";
      }
      const turns = restore(storage, conversationId);
      set(snapshot(conversationId, turns));
      const handedOff = take(storage, handOffKey(conversationId));
      return handedOff !== null && turns.length === 0 && submit(handedOff) === "sent"
        ? "sent"
        : "shown";
    },
    submit,
    retry,
    newChat() {
      cancel();
      if (state.conversationId !== null) {
        try {
          storage.removeItem(conversationKey(state.conversationId));
        } catch {
          // Nothing more to forget.
        }
      }
      set(snapshot(null, []));
    },
  };
}
