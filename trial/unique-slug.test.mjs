import { test } from "node:test";
import assert from "node:assert/strict";

import { uniqueSlug } from "./unique-slug.mjs";
import { slugify } from "./slugify.mjs";

test("returns the plain slug when nothing is taken", () => {
  assert.equal(uniqueSlug("Hello World", []), "hello-world");
});

test("appends -2 when the plain slug is taken", () => {
  assert.equal(uniqueSlug("Hello World", ["hello-world"]), "hello-world-2");
});

test("appends the next free number when several are taken", () => {
  assert.equal(
    uniqueSlug("Hello World", ["hello-world", "hello-world-2"]),
    "hello-world-3",
  );
});

test("accepts a Set of taken slugs", () => {
  assert.equal(uniqueSlug("Hello World", new Set()), "hello-world");
  assert.equal(
    uniqueSlug("Hello World", new Set(["hello-world", "hello-world-2"])),
    "hello-world-3",
  );
});

test("derives the slug with slugify", () => {
  const text = "Šebela Žluťoučký kůň";
  assert.equal(uniqueSlug(text, []), slugify(text));
  assert.equal(uniqueSlug(text, [slugify(text)]), `${slugify(text)}-2`);
});

test("imports slugify from trial/slugify.mjs rather than reimplementing it", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("./unique-slug.mjs", import.meta.url), "utf8");
  assert.match(source, /import\s*\{\s*slugify\s*\}\s*from\s*["']\.\/slugify\.mjs["']/);
});
