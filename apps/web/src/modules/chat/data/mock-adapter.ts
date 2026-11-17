import type { ChatAdapter } from "../types/adapter";

export interface MockChatAdapterOptions {
  /** The person the answers are about, by name from the API. */
  readonly subjectName: string;
  /** The pause before each streamed piece; 40 ms by default. */
  readonly chunkDelayMs?: number;
  /** Waits the given time unless the signal aborts first; a timer by default. */
  readonly wait?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Creates the identifier of each assistant message; `crypto.randomUUID` by default. */
  readonly createId?: () => string;
}

export const createMockChatAdapter: (options: MockChatAdapterOptions) => ChatAdapter = () => {
  throw new Error("not implemented");
};
