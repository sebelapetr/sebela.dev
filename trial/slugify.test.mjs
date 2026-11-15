import { test } from "node:test";
import assert from "node:assert/strict";

import { slugify } from "./slugify.mjs";

test("lowercases words and joins them with a dash", () => {
  assert.equal(slugify("Hello World"), "hello-world");
});

test("removes diacritics", () => {
  assert.equal(slugify("Šebela Žluťoučký kůň"), "sebela-zlutoucky-kun");
});

test("collapses every run of other characters into one dash and trims dashes", () => {
  assert.equal(slugify("  --Hi!!  there--  "), "hi-there");
});

test("returns an empty string for empty input", () => {
  assert.equal(slugify(""), "");
});

test("returns an empty string for whitespace-only input", () => {
  assert.equal(slugify("   \t\n  "), "");
});
