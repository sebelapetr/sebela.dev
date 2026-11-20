import { test } from "node:test";
import assert from "node:assert/strict";

import { findInText, parseTerms, termMatcher } from "./private-terms.mjs";

test("terms come one per line or comma-separated, short ones ignored", () => {
  assert.deepEqual(parseTerms("alpha, beta-host\n10.0.0.1\n\nab"), [
    "alpha",
    "beta-host",
    "10.0.0.1",
  ]);
  assert.deepEqual(parseTerms(undefined), []);
});

test("terms match as whole words, case-insensitively", () => {
  const matcher = termMatcher(parseTerms("panelco,10.0.0.1,/srv/data-vol"));
  assert.deepEqual(findInText("uses PanelCo nginx", matcher), [{ line: 1 }]);
  assert.deepEqual(findInText("ok\nserver 10.0.0.1 here", matcher), [{ line: 2 }]);
  assert.deepEqual(findInText("path /srv/data-vol/x", matcher), [{ line: 1 }]);
  // Part of a longer word is not a finding.
  assert.deepEqual(findInText("explanelcoit 110.0.0.12", matcher), []);
});

test("no terms means no matcher", () => {
  assert.equal(termMatcher([]), null);
});
