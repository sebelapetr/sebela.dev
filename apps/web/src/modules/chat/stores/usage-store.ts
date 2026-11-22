// The visitor's usage snapshot for this tab, read from the API through the website's chat routes.
// The server is the only authority: the store never counts anything itself.
import type { ChatUsageState } from "../data/usage";

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
  throw new Error("not implemented", { cause: options });
}
