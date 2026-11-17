import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FAILED_LABEL,
  RETRY_LABEL,
  RUN_REPORT_SCHEMA,
  classifyRun,
  decideNext,
  noteAfter,
  ownerNoteSection,
} from "./loop.mjs";

const success = (report) =>
  JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    structured_output: report,
  });

// --- classifyRun -----------------------------------------------------------

test("a structured report is read from a successful run", () => {
  const run = classifyRun({
    exitCode: 0,
    stdout: success({ outcome: "merged", issue: 12, summary: "done" }),
    stderr: "",
  });
  assert.deepEqual(run, { kind: "report", outcome: "merged", issue: 12, summary: "done" });
});

test("an API error with status 429 is a usage limit", () => {
  const stdout = JSON.stringify({
    subtype: "success",
    is_error: true,
    api_error_status: 429,
    result: "",
  });
  assert.equal(classifyRun({ exitCode: 1, stdout, stderr: "" }).kind, "limit");
});

test("an overloaded API is treated like a limit", () => {
  const stdout = JSON.stringify({
    subtype: "success",
    is_error: true,
    api_error_status: 529,
    result: "",
  });
  assert.equal(classifyRun({ exitCode: 1, stdout, stderr: "" }).kind, "limit");
});

test("an error result whose text mentions the usage limit is a limit", () => {
  const stdout = JSON.stringify({
    subtype: "success",
    is_error: true,
    result: "Claude usage limit reached. Your limit will reset at 5pm.",
  });
  assert.equal(classifyRun({ exitCode: 1, stdout, stderr: "" }).kind, "limit");
});

test("a limit reported only on stderr is recognised", () => {
  const run = classifyRun({ exitCode: 1, stdout: "", stderr: "Error: rate limit exceeded" });
  assert.equal(run.kind, "limit");
});

test("other API errors are crashes", () => {
  const stdout = JSON.stringify({
    subtype: "success",
    is_error: true,
    api_error_status: 500,
    result: "boom",
  });
  assert.equal(classifyRun({ exitCode: 1, stdout, stderr: "" }).kind, "crash");
});

test("a run that ended without a structured report is a crash", () => {
  const stdout = JSON.stringify({ subtype: "error_max_turns", is_error: false });
  assert.equal(classifyRun({ exitCode: 0, stdout, stderr: "" }).kind, "crash");
});

test("unreadable output is a crash", () => {
  assert.equal(classifyRun({ exitCode: 2, stdout: "not json", stderr: "segfault" }).kind, "crash");
});

test("the JSON result is found on the last line after other output", () => {
  const stdout = `some banner\n${success({ outcome: "phase_done", issue: null, summary: "" })}`;
  assert.equal(classifyRun({ exitCode: 0, stdout, stderr: "" }).outcome, "phase_done");
});

// --- decideNext ------------------------------------------------------------

const report = (outcome, issue = 7) => ({ kind: "report", outcome, issue, summary: "" });

test("a merged issue continues and resets the failure count", () => {
  assert.deepEqual(decideNext({ run: report("merged"), consecutiveFailures: 2 }), {
    next: "continue",
    label: null,
    consecutiveFailures: 0,
  });
});

test("a usage limit waits and does not count as a failure", () => {
  assert.deepEqual(decideNext({ run: { kind: "limit" }, consecutiveFailures: 1 }), {
    next: "wait",
    label: null,
    consecutiveFailures: 1,
  });
});

test("an issue interrupted by the usage limit waits, without a label or a failure", () => {
  assert.deepEqual(
    decideNext({
      run: report("interrupted", 29),
      consecutiveFailures: 1,
      issueLabels: ["agent-retry"],
    }),
    { next: "wait", label: null, consecutiveFailures: 1 },
  );
});

test("the orchestrator may report an interruption by the usage limit", () => {
  assert.ok(RUN_REPORT_SCHEMA.properties.outcome.enum.includes("interrupted"));
  assert.match(RUN_REPORT_SCHEMA.properties.outcome.description, /interrupted: .*usage limit/);
});

test("no ready issue left ends the loop", () => {
  assert.equal(
    decideNext({ run: report("phase_done", null), consecutiveFailures: 0 }).next,
    "done",
  );
});

test("the first failure of an issue marks it for one retry", () => {
  const decision = decideNext({ run: report("failed"), consecutiveFailures: 0, issueLabels: [] });
  assert.deepEqual(decision, { next: "continue", label: RETRY_LABEL, consecutiveFailures: 1 });
});

test("the second failure of the same issue marks it as failed", () => {
  const decision = decideNext({
    run: report("failed"),
    consecutiveFailures: 1,
    issueLabels: ["ready-for-agent", RETRY_LABEL],
  });
  assert.equal(decision.label, FAILED_LABEL);
  assert.equal(decision.next, "continue");
});

test("consecutive failures stop the loop at the limit", () => {
  const decision = decideNext({
    run: report("failed"),
    consecutiveFailures: 2,
    maxConsecutiveFailures: 3,
  });
  assert.equal(decision.next, "stop");
  assert.equal(decision.consecutiveFailures, 3);
});

test("crashes count towards the stop and label nothing", () => {
  const first = decideNext({ run: { kind: "crash", detail: "" }, consecutiveFailures: 0 });
  assert.deepEqual(first, { next: "continue", label: null, consecutiveFailures: 1 });
  const third = decideNext({ run: { kind: "crash", detail: "" }, consecutiveFailures: 2 });
  assert.equal(third.next, "stop");
});

test("without an owner note the prompt gets no section", () => {
  assert.equal(ownerNoteSection(undefined), "");
  assert.equal(ownerNoteSection(null), "");
  assert.equal(ownerNoteSection("  \n "), "");
});

test("an owner note is passed on verbatim, marked as the owner's and to be recorded on its issue", () => {
  const section = ownerNoteSection("  I stopped #42: move the modules to src/modules.  ");
  assert.match(section, /I stopped #42: move the modules to src\/modules\./);
  assert.match(section, /owner/i);
  assert.match(section, /Owner note:/);
  // It adds to the instructions; it must not read as permission to skip the rules.
  assert.match(section, /does not override/);
  assert.ok(section.startsWith("\n"), "the section is appended to the prompt on its own lines");
});

test("the owner note stays while the loop waits for the usage limit and ends with the first finished run", () => {
  const note = "redo #42";
  assert.equal(noteAfter(note, "wait"), note);
  assert.equal(noteAfter(note, "continue"), null);
  assert.equal(noteAfter(note, "done"), null);
  assert.equal(noteAfter(note, "stop"), null);
  assert.equal(noteAfter(null, "wait"), null);
});
