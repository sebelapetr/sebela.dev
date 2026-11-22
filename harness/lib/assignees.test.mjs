import { test } from "node:test";
import assert from "node:assert/strict";
import { assigneeDisagreements, assigneeLines } from "./assignees.mjs";

const issue = (number, labels, assignees = []) => ({
  number,
  title: `Issue ${number}`,
  labels,
  assignees,
});

test("an issue that waits for the owner is assigned, an issue for agents is not", () => {
  const issues = [
    issue(216, ["ready-for-agent", "hitl"], ["owner"]),
    issue(210, ["ready-for-agent", "afk"]),
    issue(420, ["enhancement"]),
  ];
  assert.deepEqual(assigneeDisagreements(issues), []);
});

test("a hitl issue without an assignee is reported", () => {
  assert.deepEqual(assigneeDisagreements([issue(189, ["hitl"])]), [
    { number: 189, title: "Issue 189", hitl: true, assignees: [] },
  ]);
});

test("an assigned issue without hitl is reported with who it is assigned to", () => {
  assert.deepEqual(assigneeDisagreements([issue(210, ["ready-for-agent", "afk"], ["owner"])]), [
    { number: 210, title: "Issue 210", hitl: false, assignees: ["owner"] },
  ]);
});

test("each disagreement is one line that says which side is missing", () => {
  const lines = assigneeLines([
    { number: 189, title: "Privacy", hitl: true, assignees: [] },
    { number: 210, title: "Chat", hitl: false, assignees: ["owner"] },
  ]);
  assert.match(lines[0], /#189 Privacy: labelled `hitl` but has no assignee/);
  assert.match(lines[1], /#210 Chat: assigned to owner but not labelled `hitl`/);
});
