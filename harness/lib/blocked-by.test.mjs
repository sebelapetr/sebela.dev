import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blockerDisagreements,
  disagreementLines,
  renderBlockedBy,
  textBlockers,
  textOnlyBlockers,
} from "./blocked-by.mjs";

const native = (number, state = "OPEN") => ({ number, state });
const issue = (number, body, blockedBy = [], labels = []) => ({
  number,
  title: `Issue ${number}`,
  body,
  labels,
  blockedBy,
});
const section = (text) => `## What to build\n\nSee #1.\n\n## Blocked by\n\n${text}\n`;
const OPEN = new Map();
const states = (entries) => new Map(Object.entries(entries).map(([n, s]) => [Number(n), s]));

// --- reading the text section -------------------------------------------------

test("the numbers of a Blocked by section are read from references and issue links", () => {
  const body = section(
    "- #252\n- https://github.com/example/repo/issues/302 (the client)\n- Phase 06 merged",
  );
  assert.deepEqual(textBlockers(body), [252, 302]);
});

test("only the Blocked by section is read, up to the next heading", () => {
  const body = `## Parent\n\n#5\n\n## Blocked by\n\n- #10\n\n## When\n\nAfter #11.\n`;
  assert.deepEqual(textBlockers(body), [10]);
});

test("a pull request link is not an issue reference", () => {
  assert.deepEqual(textBlockers(section("- https://github.com/example/repo/pull/274")), []);
});

test("a section without numbers names no blocker; no section is null", () => {
  assert.deepEqual(textBlockers(section("None - can start immediately.")), []);
  assert.equal(textBlockers("## What to build\n\nBlocked by #3 in prose."), null);
  assert.equal(textBlockers(null), null);
});

test("a number is read once, and a longer number is not cut", () => {
  assert.deepEqual(textBlockers(section("- #21\n- #210\n- #21 again")), [21, 210]);
});

// --- rendering from the native links -------------------------------------------

test("the section is rendered from the native links in their order", () => {
  assert.equal(renderBlockedBy([215, 393]), "## Blocked by\n\n- #215\n- #393");
  assert.equal(renderBlockedBy([]), "## Blocked by\n\nNone - can start immediately.");
});

test("a rendered section reads back as the same blockers", () => {
  assert.deepEqual(textBlockers(renderBlockedBy([215, 393])), [215, 393]);
  assert.deepEqual(textBlockers(renderBlockedBy([])), []);
});

// --- text against native --------------------------------------------------------

test("text and native links that name the same issues agree", () => {
  const issues = [issue(211, section("- #210"), [native(210)])];
  assert.deepEqual(blockerDisagreements(issues, OPEN), []);
});

test("an open native blocker the text does not name is a disagreement", () => {
  const issues = [issue(216, section("- #215"), [native(215), native(393), native(394)])];
  assert.deepEqual(blockerDisagreements(issues, OPEN), [
    {
      number: 216,
      title: "Issue 216",
      hasSection: true,
      missingInText: [393, 394],
      missingNatively: [],
    },
  ]);
});

test("an open issue the text names without a native link is a disagreement", () => {
  const issues = [issue(404, section("- #334\n- #345"), [native(334)])];
  const [found] = blockerDisagreements(issues, states({ 345: "OPEN" }));
  assert.deepEqual(found.missingNatively, [345]);
  assert.deepEqual(found.missingInText, []);
});

test("closed blockers on one side only are history, not a disagreement", () => {
  const issues = [
    issue(210, section("- #183\n- #302"), [native(302, "CLOSED")]),
    issue(212, section("None."), [native(211, "CLOSED")]),
  ];
  assert.deepEqual(blockerDisagreements(issues, states({ 183: "CLOSED" })), []);
});

test("a text reference that is no issue, or the issue itself, is ignored", () => {
  const issues = [issue(319, section("- #274 (the phase 6 pull request)\n- this is #319"), [])];
  assert.deepEqual(blockerDisagreements(issues, states({ 274: null })), []);
});

test("an issue without the section is left alone unless an agent may take it", () => {
  const body = "## What to build\n\nThings.";
  const tracking = issue(418, body, [native(414)]);
  const ready = issue(500, body, [native(414)], ["ready-for-agent", "afk"]);
  assert.deepEqual(blockerDisagreements([tracking, ready], OPEN), [
    {
      number: 500,
      title: "Issue 500",
      hasSection: false,
      missingInText: [414],
      missingNatively: [],
    },
  ]);
});

test("the numbers whose state the text check needs are those the text alone names", () => {
  const issues = [
    issue(210, section("- #183\n- #302"), [native(302, "CLOSED")]),
    issue(404, section("- #334\n- #183"), []),
    issue(5, "no section", [native(9)]),
  ];
  assert.deepEqual(textOnlyBlockers(issues), [183, 334]);
});

test("each disagreement is one line that says what to change", () => {
  const lines = disagreementLines([
    {
      number: 216,
      title: "Accept",
      hasSection: true,
      missingInText: [393, 394],
      missingNatively: [],
    },
    {
      number: 404,
      title: "Reconcile",
      hasSection: true,
      missingInText: [],
      missingNatively: [345],
    },
    { number: 500, title: "New", hasSection: false, missingInText: [414], missingNatively: [] },
  ]);
  assert.equal(lines.length, 3);
  assert.match(lines[0], /#216/);
  assert.match(lines[0], /text does not name #393, #394/);
  assert.match(lines[1], /#404.*text names #345.*no native link/);
  assert.match(lines[2], /#500.*no `## Blocked by` section/);
});
