// Server-sent events as the API's chat stream frames them, read piece by piece as the bytes arrive.

/** One dispatched frame: its event name (`message` when unnamed), its ID if any, and its data. */
export interface SseFrame {
  readonly event: string;
  readonly id: string | null;
  readonly data: string;
}

/** An incremental reader: `push` takes the next decoded text and returns the frames it completed. */
export interface SseParser {
  push(text: string): SseFrame[];
}

export function createSseParser(): SseParser {
  throw new Error("not implemented");
}
