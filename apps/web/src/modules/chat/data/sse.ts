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

const lineEnd = /\r\n|\r|\n/;

/**
 * Reads frames as the event-stream format defines them: lines end with LF, CRLF or CR; a blank line
 * dispatches the frame; `data` lines join with a line feed; comments and unknown fields are
 * ignored; a frame without data is not dispatched. The ID is the frame's own, null without one.
 */
export function createSseParser(): SseParser {
  let buffer = "";
  let event = "";
  let id: string | null = null;
  let data: string[] | null = null;
  // The previous piece ended with a CR, so a line feed that begins this one completes its CRLF.
  let afterCr = false;

  function line(text: string, frames: SseFrame[]): void {
    if (text === "") {
      if (data !== null)
        frames.push({ event: event === "" ? "message" : event, id, data: data.join("\n") });
      event = "";
      id = null;
      data = null;
      return;
    }
    if (text.startsWith(":")) return;
    const colon = text.indexOf(":");
    const field = colon === -1 ? text : text.slice(0, colon);
    let value = colon === -1 ? "" : text.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "id") id = value;
    else if (field === "data") (data ??= []).push(value);
  }

  return {
    push(text) {
      if (text === "") return [];
      buffer += afterCr && text.startsWith("\n") ? text.slice(1) : text;
      afterCr = false;
      const frames: SseFrame[] = [];
      for (;;) {
        const match = lineEnd.exec(buffer);
        if (match === null) break;
        line(buffer.slice(0, match.index), frames);
        buffer = buffer.slice(match.index + match[0].length);
        if (buffer === "" && match[0] === "\r") afterCr = true;
      }
      return frames;
    },
  };
}
