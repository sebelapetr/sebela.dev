import { describe, expect, it } from "vitest";

import { createSseParser } from "./sse";

describe("createSseParser", () => {
  it("reads a named frame with its ID and data", () => {
    const parser = createSseParser();

    expect(parser.push('event: chat\nid: 3\ndata: {"type":"start"}\n\n')).toEqual([
      { event: "chat", id: "3", data: '{"type":"start"}' },
    ]);
  });

  it("reads an unnamed frame as a message without an ID", () => {
    expect(createSseParser().push("data: hello\n\n")).toEqual([
      { event: "message", id: null, data: "hello" },
    ]);
  });

  it("completes a frame only once its blank line arrives, across pieces", () => {
    const parser = createSseParser();

    expect(parser.push("event: progress\nda")).toEqual([]);
    expect(parser.push('ta: {"stage":"answering"}\n')).toEqual([]);
    expect(parser.push("\nevent: chat\nid: 1\ndata: x\n\n")).toEqual([
      { event: "progress", id: null, data: '{"stage":"answering"}' },
      { event: "chat", id: "1", data: "x" },
    ]);
  });

  it("accepts CRLF and CR line ends, also split between pieces", () => {
    const parser = createSseParser();

    expect(parser.push("data: a\r")).toEqual([]);
    expect(parser.push("\n\r\ndata: b\r\r")).toEqual([
      { event: "message", id: null, data: "a" },
      { event: "message", id: null, data: "b" },
    ]);
  });

  it("joins several data lines with a line feed and keeps only one leading space", () => {
    expect(createSseParser().push("data:one\ndata:  two\n\n")).toEqual([
      { event: "message", id: null, data: "one\n two" },
    ]);
  });

  it("ignores comments, unknown fields and a frame without data", () => {
    expect(createSseParser().push(": keep-alive\nretry: 10\n\nevent: chat\n\ndata: z\n\n")).toEqual(
      [{ event: "message", id: null, data: "z" }],
    );
  });

  it("drops what never ended with a blank line", () => {
    const parser = createSseParser();

    expect(parser.push("data: unfinished")).toEqual([]);
  });
});
