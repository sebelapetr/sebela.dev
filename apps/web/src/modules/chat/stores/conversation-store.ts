// The chat's state in this tab: the caller's one conversation as the API stores it, the question in
// flight and the hand-off of a question from the hero. The API resolves the conversation from the
// visitor's cookie; an address on the page never authorises anything. Every tab of the visitor
// shows the same conversation: a tab told that another changed it reads it again.
import {
  ChatConversationClearedSchema,
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
  stopChatTurn,
  timeOutChatTurn,
  type ChatTurn,
} from "../data/conversation";
import type { ChatCompactionState } from "../data/compaction";
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
  /**
   * The history is loading, a question is answering (in this tab or another) or the conversation
   * is being cleared; another question cannot be sent.
   */
  readonly busy: boolean;
  /** How many days the conversation is kept after its last activity; null until it is read. */
  readonly retentionDays: number | null;
  /** Whether older messages can be read, are being read, or there are none. */
  readonly earlier: "none" | "available" | "loading";
  /** The conversation the chat shows, which a clear names; null until it is read. */
  readonly conversationId: string | null;
  /**
   * After a clear: whether copies of the conversation in the monitoring service are still to be
   * deleted ("pending" is never done) or there were none; null when nothing was cleared since the
   * last question.
   */
  readonly telemetryDeletion: "none" | "pending" | null;
  /**
   * The compaction of the working context this tab asked for or follows from another tab, until
   * the next question or clear; null when there is none.
   */
  readonly compaction: ChatCompactionState | null;
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
   * Asks the latest question again when its answer was interrupted, stopped or failed with a
   * retryable error, always under the same request and a new random retry ID, so one press is one
   * attempt and an admitted attempt is never paid twice: an attempt the API never ended is only
   * followed again. The failed answer is replaced in place. Never called by the store itself: a
   * failure waits for the visitor.
   */
  retry(requestId: string): RetryResult;
  /**
   * Stops the latest question's answer while it is open, in whichever tab it was asked. The API
   * ends it and its stream says so; a question the API has not admitted yet is stopped on the page
   * and never sent. "failed" when the API could not be asked, and the answer is still followed.
   */
  stop(requestId: string): Promise<StopResult>;
  /**
   * Deletes the conversation shown, by its ID, and shows the fresh empty one; an answer being
   * prepared is cancelled. "changed" when the conversation changed before the clear (another tab
   * asked or cleared): nothing was deleted and it is shown as it now is. "failed" before the
   * conversation was read or when the API could not be asked; nothing changes.
   */
  clear(): Promise<ClearResult>;
  /**
   * Reads the newest page again, after another tab said the conversation changed, and follows the
   * answer it is preparing. Waits while this tab follows an answer; older pages already read stay
   * when the newest still begins with a question shown. A question the API did not admit stays at
   * the end, to be asked again.
   */
  refresh(): Promise<void>;
  /**
   * Asks the API to compact the working context under a new random request, then follows the
   * compaction until it ends. It adds no turn and changes no visible message. Refused while the
   * history loads, a question is answering or another compaction runs, in any tab.
   */
  compact(): CompactResult;
}

/** What became of a compaction request: asked for, or refused while something else runs. */
export type CompactResult = "started" | "busy";

/** What became of a stop: the answer was stopped, the API could not be asked, or nothing is open. */
export type StopResult = "stopped" | "failed" | "none";

/** What became of a clear: cleared, refused because the conversation changed, or not done. */
export type ClearResult = "cleared" | "changed" | "failed";

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
  /**
   * Called when this tab changed the conversation for the other tabs: a question or retry was
   * admitted (its first event), an answer was stopped or the conversation was cleared.
   */
  readonly onChange?: () => void;
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
 * is no longer followed. A failure is never retried by the store. A refusal because another
 * answer is being prepared, or because the attempt is no longer the latest, reads the conversation
 * again, so the other tab's answer is shown and followed instead.
 */
export function createConversationStore(options: ConversationStoreOptions): ConversationStore {
  const { adapter, storage, createId } = options;
  const idleTimeoutMs = options.idleTimeoutMs ?? 20_000;
  const onChange = options.onChange ?? (() => undefined);
  const listeners = new Set<() => void>();
  const taken = new Set<string>();
  /** The questions shown that the API never admitted, so no stored page has them. */
  const unadmitted = new Set<string>();

  const available = options.available ?? true;

  let history: ConversationSnapshot["history"] = available ? "loading" : "unavailable";
  let conversationId: string | null = null;
  let turns: readonly ChatTurn[] = [];
  let retentionDays: number | null = null;
  let earlier: ConversationSnapshot["earlier"] = "none";
  let cursor: string | null = null;
  let carried: ChatAssistantMessage | null = null;
  let attempt: Attempt | null = null;
  let restoring: Promise<void> | null = null;
  let clearing = false;
  let telemetryDeletion: ConversationSnapshot["telemetryDeletion"] = null;
  let refreshing: Promise<void> | null = null;
  /** A read of the newest page waits for the attempt followed, or for the read in flight. */
  let refreshWanted = false;
  let snapshot: ConversationSnapshot | null = null;

  const isBusy = () =>
    history === "loading" || history === "unavailable" || clearing || turns.some(isChatTurnOpen);

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

  function abandon(current: Attempt): void {
    current.controller.abort();
    if (attempt === current) attempt = null;
  }

  type Source = (signal: AbortSignal) => AsyncIterable<unknown>;

  /**
   * Follows one attempt of the question. `announced`: a question or retry this tab sent, whose
   * admission (its first event) the other tabs are told about.
   */
  async function follow(question: ChatQuestion, source: Source, announced: boolean): Promise<void> {
    if (attempt !== null) abandon(attempt);
    const current: Attempt = { requestId: question.requestId, controller: new AbortController() };
    attempt = current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let first = announced;
    const quiet = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (attempt !== current) return;
        abandon(current);
        update(question.requestId, timeOutChatTurn);
      }, idleTimeoutMs);
    };
    quiet();
    try {
      for await (const raw of source(current.controller.signal)) {
        if (attempt !== current) return;
        quiet();
        if (first) {
          first = false;
          onChange();
        }
        update(question.requestId, (turn) => receiveChatEvent(turn, raw));
        if (!turns.some((turn) => turn.requestId === question.requestId && isChatTurnOpen(turn)))
          return;
      }
      if (attempt === current) update(question.requestId, endChatStream);
    } catch (error) {
      if (attempt !== current) return;
      if (error instanceof ChatAdmissionError) {
        unadmitted.add(question.requestId);
        if (error.code === "busy" || error.code === "not_retryable") refreshWanted = true;
      }
      update(question.requestId, (turn) =>
        error instanceof ChatAdmissionError
          ? rejectChatTurn(turn, error.code, error.retryAfterSeconds)
          : endChatStream(turn),
      );
    } finally {
      clearTimeout(timer);
      if (attempt === current) {
        abandon(current);
        if (refreshWanted) void refresh();
      }
    }
  }

  /** Follows the answer the API is still preparing, which the page shows open. */
  function followActive(page: ChatConversation): void {
    const active = page.activeOperation;
    const running =
      active === null ? undefined : turns.find((turn) => turn.requestId === active.requestId);
    if (running !== undefined && isChatTurnOpen(running)) {
      const question = { requestId: running.requestId, question: running.question };
      void follow(question, (signal) => adapter.send(question, { signal }), false);
    }
  }

  /** Shows the newest page as the whole conversation. */
  function readHistory(page: ChatConversation): void {
    const read = historyTurns(page.messages, {
      carried: null,
      activeRequestId: page.activeOperation?.requestId ?? null,
    });
    unadmitted.clear();
    conversationId = page.conversationId;
    turns = read.turns;
    carried = read.leading;
    cursor = page.nextCursor;
    earlier = cursor === null ? "none" : "available";
    retentionDays = page.retentionDays;
    history = "ready";
    changed();
    followActive(page);
  }

  /**
   * Shows the newest page read again: the older turns already read stay when the page still
   * begins with a question shown, and the questions the API never admitted stay at the end.
   */
  function mergeNewest(page: ChatConversation): void {
    if (page.conversationId !== conversationId) {
      readHistory(page);
      return;
    }
    const read = historyTurns(page.messages, {
      carried: null,
      activeRequestId: page.activeOperation?.requestId ?? null,
    });
    const stored = new Set(read.turns.map((turn) => turn.requestId));
    const local = turns.filter(
      (turn) => unadmitted.has(turn.requestId) && !stored.has(turn.requestId),
    );
    const firstRequest = read.turns[0]?.requestId;
    const index =
      firstRequest === undefined ? -1 : turns.findIndex((turn) => turn.requestId === firstRequest);
    if (index > 0) {
      turns = [...turns.slice(0, index).filter((turn) => !local.includes(turn)), ...read.turns];
    } else {
      turns = read.turns;
      carried = read.leading;
      cursor = page.nextCursor;
      earlier = cursor === null ? "none" : "available";
    }
    turns = [...turns, ...local];
    for (const requestId of unadmitted) if (stored.has(requestId)) unadmitted.delete(requestId);
    retentionDays = page.retentionDays;
    changed();
    followActive(page);
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

  // Read through functions: they change while a read is awaited.
  const following = () => attempt !== null;
  const clearingNow = () => clearing;
  const wantsRefresh = () => refreshWanted;

  function refresh(): Promise<void> {
    if (history !== "ready" || clearing) return Promise.resolve();
    if (attempt !== null || refreshing !== null) {
      refreshWanted = true;
      return refreshing ?? Promise.resolve();
    }
    refreshWanted = false;
    const read = (async () => {
      try {
        const page = parseChatConversation(
          await adapter.restore({ signal: new AbortController().signal }),
        );
        if (page === null) return;
        // A question followed meanwhile wins and the page is read again after it; a clear shows
        // the conversation it left.
        if (following()) refreshWanted = true;
        else if (!clearingNow()) mergeNewest(page);
      } catch {
        // The conversation stays as shown; the next change reads it again.
      } finally {
        refreshing = null;
        if (wantsRefresh() && !following()) void refresh();
      }
    })();
    refreshing = read;
    return read;
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
    telemetryDeletion = null;
    changed();
    const asked = { requestId: turn.requestId, question: turn.question };
    void follow(asked, (signal) => adapter.send(asked, { signal }), true);
    return "sent";
  }

  return {
    getSnapshot() {
      snapshot ??= {
        history,
        turns,
        busy: isBusy(),
        retentionDays,
        earlier,
        conversationId,
        telemetryDeletion,
      };
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
      const next = restartChatTurn(latest);
      turns = [...turns.slice(0, -1), next];
      telemetryDeletion = null;
      changed();
      const asked = { requestId: next.requestId, question: next.question };
      const retryId = createId();
      void follow(asked, (signal) => adapter.retry(asked, { retryId, signal }), true);
      return "sent";
    },
    async stop(requestId) {
      const latest = turns.at(-1);
      if (latest?.requestId !== requestId || !isChatTurnOpen(latest)) return "none";
      let stopped: "stopped" | "none";
      try {
        stopped = await adapter.stop(requestId, { signal: new AbortController().signal });
      } catch {
        return "failed";
      }
      if (stopped === "none") {
        // Never admitted, so no stream will say it stopped.
        if (attempt?.requestId === requestId) abandon(attempt);
        unadmitted.add(requestId);
        update(requestId, stopChatTurn);
      }
      onChange();
      return "stopped";
    },
    async clear() {
      const shown = conversationId;
      if (shown === null || history !== "ready" || clearing) return "failed";
      clearing = true;
      changed();
      try {
        const parsed = ChatConversationClearedSchema.safeParse(
          await adapter.clear(shown, { signal: new AbortController().signal }),
        );
        if (!parsed.success) return "failed";
        if (attempt !== null) abandon(attempt);
        clearing = false;
        readHistory(parsed.data.conversation);
        if (!parsed.data.cleared) {
          telemetryDeletion = null;
          return "changed";
        }
        telemetryDeletion = parsed.data.telemetryDeletion;
        onChange();
        return "cleared";
      } catch {
        return "failed";
      } finally {
        clearing = false;
        changed();
      }
    },
    refresh,
  };
}
