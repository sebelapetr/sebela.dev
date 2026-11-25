import { describe, expect, it } from "vitest";

import { handOffHref, handOffIdFromParam } from "./address";

const ID = "6f1c3a52-8f0b-4e1d-9a7c-2b4d5e6f7a80";

describe("handOffHref", () => {
  it("puts only the hand-off's identifier into the Ask address", () => {
    expect(handOffHref(ID)).toBe(`/ask?c=${ID}`);
  });

  it("leads to the Ask page itself without an identifier", () => {
    expect(handOffHref(null)).toBe("/ask");
  });
});

describe("handOffIdFromParam", () => {
  it("reads a hand-off identifier", () => {
    expect(handOffIdFromParam(ID)).toBe(ID);
  });

  it("reads an upper-case identifier as the same hand-off", () => {
    expect(handOffIdFromParam(ID.toUpperCase())).toBe(ID);
  });

  it.each([null, "", "hello", "What is Casey Morrow working on now?", `${ID}x`])(
    "names no hand-off for %j",
    (param) => {
      expect(handOffIdFromParam(param)).toBeNull();
    },
  );
});
