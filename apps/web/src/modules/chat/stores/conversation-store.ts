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
  endChatStream,
  isChatTurnOpen,
  receiveChatEvent,
  startChatTurn,
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
   * this address, exactly once.
   */
  open(conversationId: string | null): void;
  /**
   * Sends a question (trimmed, 1 to `chatQuestionMaxLength` characters) in the open conversation,
   * creating its random address for a new chat. Refused while another question is answering.
   */
  submit(question: string): SubmitResult;
  retry(requestId: string): RetryResult;
  /** Cancels the request in flight and forgets the open conversation in this tab. */
  newChat(): void;
}

export interface ConversationStoreOptions {
  readonly adapter: ChatAdapter;
  readonly storage: ChatStorage;
  /** Creates random identifiers (UUID) of conversations and requests. */
  readonly createId: () => string;
  readonly idleTimeoutMs?: number;
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

  async function stream(submission: ChatSubmission, controller: AbortController): Promise<void> {
    const { requestId } = submission;
    try {
      for await (const raw of adapter.send(submission, { signal: controller.signal })) {
        if (controller.signal.aborted) return;
        update(requestId, (turn) => receiveChatEvent(turn, raw));
        const turn = state.turns.find((candidate) => candidate.requestId === requestId);
        if (turn === undefined || !isChatTurnOpen(turn)) break;
      }
    } catch {
      // A transport that fails ends the stream; the answer is then interrupted.
    }
    if (controller.signal.aborted) return;
    if (active === controller) active = null;
    update(requestId, endChatStream);
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
    const controller = new AbortController();
    active = controller;
    set(
      snapshot(submission.conversationId, [
        ...state.turns,
        startChatTurn(submission.requestId, trimmed),
      ]),
    );
    void stream(submission, controller);
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
      if (opened && conversationId === state.conversationId) return;
      opened = true;
      cancel();
      if (conversationId === null) {
        set(snapshot(null, []));
        return;
      }
      const turns = restore(storage, conversationId);
      set(snapshot(conversationId, turns));
      const handedOff = take(storage, handOffKey(conversationId));
      if (handedOff !== null && turns.length === 0) submit(handedOff);
    },
    submit,
    retry(requestId) {
      throw new Error("not implemented: " + requestId);
    },
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
