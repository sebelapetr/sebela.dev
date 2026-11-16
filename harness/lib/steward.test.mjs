import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STEWARD_REPORT_SCHEMA,
  assess,
  formatVerdict,
  needsModel,
  summarizeTranscript,
} from "./steward.mjs";

const at = (minutesAgo, now) => new Date(now - minutesAgo * 60_000).toISOString();
const now = Date.parse("2026-11-16T10:00:00Z");

function assistant(minutesAgo, context, toolUses = []) {
  return JSON.stringify({
    type: "assistant",
    timestamp: at(minutesAgo, now),
    message: {
      usage: {
        input_tokens: 10,
        cache_read_input_tokens: context - 10,
        cache_creation_input_tokens: 0,
      },
      content: toolUses.map(([id, command]) => ({
        type: "tool_use",
        id,
        name: "Bash",
        input: { command },
      })),
    },
  });
}

function result(minutesAgo, id, text, isError = true) {
  return JSON.stringify({
    type: "user",
    timestamp: at(minutesAgo, now),
    message: {
      content: [{ type: "tool_result", tool_use_id: id, is_error: isError, content: text }],
    },
  });
}

const prompt = JSON.stringify({
  type: "user",
  timestamp: at(40, now),
  message: { content: "Implement GitHub issue #22 in the worktree …" },
});

// --- reading a transcript ----------------------------------------------------

test("a transcript gives calls, the latest context, the last activity and the task", () => {
  const summary = summarizeTranscript([prompt, assistant(30, 40_000), assistant(5, 90_000)], {
    now,
  });
  assert.equal(summary.calls, 2);
  assert.equal(summary.context, 90_000);
  assert.equal(summary.idleMinutes, 5);
  assert.match(summary.task, /issue #22/);
});

test("the same refused command repeated within the window is counted, older refusals are not", () => {
  const lines = [
    assistant(40, 10_000, [["a", "cat secrets"]]),
    result(40, "a", "PreToolUse:Bash hook error: refused"),
    assistant(9, 20_000, [["b", "cat secrets"]]),
    result(9, "b", "PreToolUse:Bash hook error: refused"),
    assistant(8, 20_000, [["c", "cat secrets"]]),
    result(8, "c", "Permission to use Bash has been denied."),
    assistant(7, 20_000, [["d", "ls"]]),
    result(7, "d", "file-a", false),
  ];
  const summary = summarizeTranscript(lines, { now, windowMinutes: 15 });
  assert.deepEqual(summary.refusals, [{ command: "cat secrets", count: 2 }]);
});

test("broken or unrelated lines are ignored", () => {
  const summary = summarizeTranscript(["not json", "{}", assistant(3, 5_000)], { now });
  assert.equal(summary.calls, 1);
});

// --- assessing the facts -------------------------------------------------------

const healthy = {
  iterationMinutes: 20,
  idleMinutes: 2,
  agent: { calls: 80, context: 60_000 },
  refusals: [],
  failingPullRequests: [],
  postgres: "healthy",
  leftoverWorktrees: [],
  newFailedIssues: [],
};

test("a healthy run has no findings", () => {
  assert.deepEqual(assess(healthy), []);
});

test("a long iteration is a warning, a very long one a problem", () => {
  assert.equal(assess({ ...healthy, iterationMinutes: 50 })[0].level, "warn");
  assert.equal(assess({ ...healthy, iterationMinutes: 95 })[0].level, "problem");
});

test("no activity is a warning after 15 minutes and a problem after 30", () => {
  assert.equal(assess({ ...healthy, idleMinutes: 16 })[0].level, "warn");
  assert.equal(assess({ ...healthy, idleMinutes: 31 })[0].level, "problem");
  assert.equal(
    assess({ ...healthy, idleMinutes: null })[0].level,
    "warn",
    "an unreadable transcript is reported",
  );
});

test("repeated refusals, failing checks, many calls, new failures and leftovers are warnings", () => {
  const findings = assess({
    ...healthy,
    agent: { calls: 260, context: 60_000 },
    refusals: [{ command: "cat secrets", count: 3 }],
    failingPullRequests: [91],
    newFailedIssues: [33],
    leftoverWorktrees: ["feat-1-old"],
  });
  assert.deepEqual(
    findings.map((f) => [f.code, f.level]),
    [
      ["refusals", "warn"],
      ["checks", "warn"],
      ["calls", "warn"],
      ["failed-issue", "warn"],
      ["leftover", "warn"],
    ],
  );
});

test("a refusal seen only twice is not yet a finding", () => {
  assert.deepEqual(assess({ ...healthy, refusals: [{ command: "x", count: 2 }] }), []);
});

test("Postgres that is not healthy is a problem", () => {
  assert.equal(assess({ ...healthy, postgres: "down" })[0].level, "problem");
});

// --- when to ask the model -------------------------------------------------------

test("the model is asked when something looks wrong, or once an hour anyway", () => {
  const warn = [{ level: "warn", code: "idle", message: "x" }];
  assert.equal(needsModel({ findings: warn, minutesSinceModel: 15 }), true);
  assert.equal(needsModel({ findings: [], minutesSinceModel: 15 }), false);
  assert.equal(needsModel({ findings: [], minutesSinceModel: 60 }), true);
  assert.equal(needsModel({ findings: [], minutesSinceModel: null }), true, "the first check asks");
});

// --- the console line -------------------------------------------------------------

test("the verdict line is green, yellow or red", () => {
  const ok = formatVerdict({ status: "ok", findings: [] });
  const warn = formatVerdict({ status: "warn", findings: ["slow"] });
  const problem = formatVerdict({ status: "problem", findings: ["stuck"] });
  assert.ok(ok.startsWith("\u001b[32m") && ok.includes("[steward] ok"));
  assert.ok(warn.startsWith("\u001b[33m") && warn.includes("slow"));
  assert.ok(problem.startsWith("\u001b[31m") && problem.includes("stuck"));
});

test("the model's report schema requires a status and findings", () => {
  assert.deepEqual(STEWARD_REPORT_SCHEMA.required, ["status", "findings"]);
});
