// The chat's transport over the website's same-origin chat routes (`/api/chat/*`), which relay to
// the API: it reads the caller's conversation, admits a new question with a person check, and
// follows an admitted question's event stream, reconnecting where it left off.
import type { ChatAdapter } from "../types/adapter";

export interface ApiChatAdapterOptions {
  /** The browser's `fetch`; the cookie goes with every same-origin request. */
  readonly fetch: typeof globalThis.fetch;
  /** Where the chat routes are, such as `/api/chat`. */
  readonly basePath: string;
  /** Gives a fresh person-check token for one new question; rejects when the check fails. */
  readonly challenge: (signal: AbortSignal) => Promise<string>;
  readonly now?: () => number;
  /** Waits before a reconnect; resolves early when the signal aborts. */
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** The pause before following a stream again after it dropped; 1 s by default. */
  readonly reconnectDelayMs?: number;
  /** How long after the operation's deadline the stream is still followed; 20 s by default. */
  readonly deadlineGraceMs?: number;
}

export const createApiChatAdapter: (options: ApiChatAdapterOptions) => ChatAdapter = () => {
  throw new Error("not implemented");
};
