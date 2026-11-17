import { describe, expect, it } from "vitest";

import { conversationHref, conversationIdFromParam } from "./address";

const ID = "6f1c3a52-8f0b-4e1d-9a7c-2b4d5e6f7a80";

describe("conversationHref", () => {
  it("puts only the conversation's identifier into the Ask address", () => {
    expect(conversationHref(ID)).toBe(`/ask?c=${ID}`);
  });

  it("leads to a new chat without an identifier", () => {
    expect(conversationHref(null)).toBe("/ask");
  });
});

describe("conversationIdFromParam", () => {
  it("reads a conversation identifier", () => {
    expect(conversationIdFromParam(ID)).toBe(ID);
  });

  it("reads an upper-case identifier as the same conversation", () => {
    expect(conversationIdFromParam(ID.toUpperCase())).toBe(ID);
  });

  it.each([null, "", "hello", "What is Casey Morrow working on now?", `${ID}x`])(
    "opens a new chat for %j",
    (param) => {
      expect(conversationIdFromParam(param)).toBeNull();
    },
  );
});
