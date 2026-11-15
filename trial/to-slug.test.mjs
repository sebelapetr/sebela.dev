import { test } from "node:test";
import assert from "node:assert/strict";

import { toSlug } from "./to-slug.mjs";

test("lowercases words and joins them with a dash", () => {
  assert.equal(toSlug("Hello World"), "hello-world");
});

test("removes diacritics", () => {
  assert.equal(toSlug("Šebela Žluťoučký kůň"), "sebela-zlutoucky-kun");
});

test("collapses every run of other characters into one dash and trims dashes", () => {
  assert.equal(toSlug("  --Hi!!  there--  "), "hi-there");
});

test("returns an empty string for empty input", () => {
  assert.equal(toSlug(""), "");
});

test("returns an empty string for whitespace-only input", () => {
  assert.equal(toSlug("   \t\n  "), "");
});
