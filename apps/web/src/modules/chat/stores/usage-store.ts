// The visitor's usage snapshot for this tab, read from the API through the website's chat routes.
// The server is the only authority: the store never counts anything itself.
import { parseChatUsage, readChatUsageState, type ChatUsageState } from "../data/usage";

export interface UsageStoreOptions {
  /** Reads the caller's usage snapshot, unchecked; throws when it cannot be read. */
  readonly read: (signal: AbortSignal) => Promise<unknown>;
  readonly now?: () => number;
}

export interface UsageStore {
  getSnapshot(): ChatUsageState;
  subscribe(listener: () => void): () => void;
  /** Reads the snapshot again; settles once it was read or failed, never rejects. */
  refresh(): Promise<void>;
}

/**
 * Builds the store. It is loading until the first read; a snapshot the contract does not allow
 * counts as a failed read. A failed first read is unavailable, a later one keeps the last snapshot
 * marked stale. The latest read wins: starting one aborts the one before and ignores its answer.
 */
export function createUsageStore(options: UsageStoreOptions): UsageStore {
  const now = options.now ?? Date.now;
  const listeners = new Set<() => void>();
  let state: ChatUsageState = { status: "loading" };
  let current: AbortController | null = null;

  function set(next: ChatUsageState): void {
    state = next;
    for (const listener of listeners) listener();
  }

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async refresh() {
      current?.abort();
      const controller = new AbortController();
      current = controller;
      const usage = await options.read(controller.signal).then(parseChatUsage, () => null);
      if (current !== controller) return;
      current = null;
      if (usage !== null) set(readChatUsageState(usage, now()));
      else if (state.status === "ready") set({ ...state, stale: true });
      else set({ status: "unavailable" });
    },
  };
}
