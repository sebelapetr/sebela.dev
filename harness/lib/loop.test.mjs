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
  phaseEnd,
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
  assert.deepEqual(run, {
    kind: "report",
    outcome: "merged",
    issue: 12,
    cause: null,
    summary: "done",
  });
});

test("the cause of an interruption is read from the report", () => {
  const run = classifyRun({
    exitCode: 0,
    stdout: success({ outcome: "interrupted", issue: 113, cause: "safeguard", summary: "" }),
    stderr: "",
  });
  assert.equal(run.cause, "safeguard");
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

// What Claude Code prints when the API refuses a request (stop reason "refusal").
const REFUSAL_TEXT =
  "API Error: Claude Code is unable to respond to this request, which appears to violate our Usage Policy (https://www.anthropic.com/legal/aup). Please double press esc to edit your last message or start a new session for Claude Code to assist with a different task.";

test("a run refused by a model safeguard is a safeguard, not a crash or a limit", () => {
  const stdout = JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: true,
    stop_reason: "refusal",
    api_error_status: null,
    result: REFUSAL_TEXT,
  });
  assert.deepEqual(classifyRun({ exitCode: 1, stdout, stderr: "" }), { kind: "safeguard" });
});

test("a refusal stop reason alone is a safeguard", () => {
  const stdout = JSON.stringify({ subtype: "success", is_error: true, stop_reason: "refusal" });
  assert.equal(classifyRun({ exitCode: 1, stdout, stderr: "" }).kind, "safeguard");
});

test("an invalid request flagged under the usage policy is a safeguard", () => {
  const stdout = JSON.stringify({
    subtype: "success",
    is_error: true,
    api_error_status: 400,
    result:
      'API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"Output blocked by content filtering policy"}}',
  });
  assert.equal(classifyRun({ exitCode: 1, stdout, stderr: "" }).kind, "safeguard");
});

test("an error run with safety stops counted is a safeguard", () => {
  const stdout = JSON.stringify({
    subtype: "error_during_execution",
    is_error: true,
    safety_stops: 1,
    result: "",
  });
  assert.equal(classifyRun({ exitCode: 1, stdout, stderr: "" }).kind, "safeguard");
});

test("a safeguard reported only on stderr is recognised", () => {
  assert.equal(classifyRun({ exitCode: 1, stdout: "", stderr: REFUSAL_TEXT }).kind, "safeguard");
});

test("an invalid request without policy wording stays a crash", () => {
  const stdout = JSON.stringify({
    subtype: "success",
    is_error: true,
    api_error_status: 400,
    result:
      'API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long"}}',
  });
  assert.equal(classifyRun({ exitCode: 1, stdout, stderr: "" }).kind, "crash");
});

test("a successful report wins over safety stops inside the run", () => {
  const stdout = JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    safety_stops: 2,
    structured_output: { outcome: "merged", issue: 5, cause: null, summary: "" },
  });
  assert.equal(classifyRun({ exitCode: 0, stdout, stderr: "" }).kind, "report");
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

const report = (outcome, issue = 7, cause = null) => ({
  kind: "report",
  outcome,
  issue,
  cause,
  summary: "",
});

test("a merged issue continues and resets the failure count", () => {
  assert.deepEqual(decideNext({ run: report("merged"), consecutiveFailures: 2 }), {
    next: "continue",
    label: null,
    consecutiveFailures: 0,
    lastSafeguard: null,
    reason: null,
  });
});

test("a usage limit waits and does not count as a failure", () => {
  assert.deepEqual(decideNext({ run: { kind: "limit" }, consecutiveFailures: 1 }), {
    next: "wait",
    label: null,
    consecutiveFailures: 1,
    lastSafeguard: null,
    reason: "usage_limit",
  });
});

test("an issue interrupted by the usage limit waits, without a label or a failure", () => {
  for (const cause of ["usage_limit", null]) {
    assert.deepEqual(
      decideNext({
        run: report("interrupted", 29, cause),
        consecutiveFailures: 1,
        issueLabels: ["agent-retry"],
      }),
      {
        next: "wait",
        label: null,
        consecutiveFailures: 1,
        lastSafeguard: null,
        reason: "usage_limit",
      },
    );
  }
});

test("the orchestrator may report an interruption with its cause", () => {
  assert.ok(RUN_REPORT_SCHEMA.properties.outcome.enum.includes("interrupted"));
  assert.match(RUN_REPORT_SCHEMA.properties.outcome.description, /interrupted: /);
  assert.ok(RUN_REPORT_SCHEMA.required.includes("cause"));
  assert.deepEqual(RUN_REPORT_SCHEMA.properties.cause.enum, [
    "usage_limit",
    "safeguard",
    "environment",
    null,
  ]);
  for (const cause of ["usage_limit", "safeguard", "environment"]) {
    assert.match(RUN_REPORT_SCHEMA.properties.cause.description, new RegExp(`${cause}: `));
  }
});

test("a safeguard stop is retried once at once, without a label or a failure", () => {
  for (const run of [report("interrupted", 113, "safeguard"), { kind: "safeguard" }]) {
    const decision = decideNext({ run, consecutiveFailures: 1, lastSafeguard: null });
    assert.equal(decision.next, "continue");
    assert.equal(decision.label, null);
    assert.equal(decision.consecutiveFailures, 1);
    assert.equal(decision.reason, "safeguard");
    assert.deepEqual(decision.lastSafeguard, { issue: run.issue ?? null });
  }
});

test("a second safeguard stop on the same issue stops the loop", () => {
  const decision = decideNext({
    run: report("interrupted", 113, "safeguard"),
    consecutiveFailures: 0,
    lastSafeguard: { issue: 113 },
    issueLabels: [],
  });
  assert.deepEqual(decision, {
    next: "stop",
    label: null,
    consecutiveFailures: 0,
    lastSafeguard: { issue: 113 },
    reason: "safeguard_repeated",
  });
});

test("a second safeguard stop whose issue is unknown counts as the same issue", () => {
  const first = decideNext({ run: { kind: "safeguard" }, consecutiveFailures: 0 });
  const second = decideNext({
    run: report("interrupted", 113, "safeguard"),
    consecutiveFailures: 0,
    lastSafeguard: first.lastSafeguard,
  });
  assert.equal(second.next, "stop");
});

test("a safeguard stop on another issue is a first one again", () => {
  const decision = decideNext({
    run: report("interrupted", 114, "safeguard"),
    consecutiveFailures: 0,
    lastSafeguard: { issue: 113 },
  });
  assert.equal(decision.next, "continue");
  assert.deepEqual(decision.lastSafeguard, { issue: 114 });
});

test("the safeguard memory survives a usage-limit wait and ends with any other run", () => {
  const lastSafeguard = { issue: 113 };
  assert.deepEqual(
    decideNext({ run: { kind: "limit" }, consecutiveFailures: 0, lastSafeguard }).lastSafeguard,
    lastSafeguard,
  );
  assert.equal(
    decideNext({ run: report("merged"), consecutiveFailures: 0, lastSafeguard }).lastSafeguard,
    null,
  );
  assert.equal(
    decideNext({ run: report("failed"), consecutiveFailures: 0, lastSafeguard }).lastSafeguard,
    null,
  );
});

test("an environment stop stops the loop at once, without a label or a failure", () => {
  assert.deepEqual(
    decideNext({
      run: report("interrupted", 40, "environment"),
      consecutiveFailures: 1,
      issueLabels: ["agent-retry"],
    }),
    {
      next: "stop",
      label: null,
      consecutiveFailures: 1,
      lastSafeguard: null,
      reason: "environment",
    },
  );
});

test("no ready issue left ends the loop", () => {
  assert.equal(
    decideNext({ run: report("phase_done", null), consecutiveFailures: 0 }).next,
    "done",
  );
});

test("the first failure of an issue marks it for one retry", () => {
  const decision = decideNext({ run: report("failed"), consecutiveFailures: 0, issueLabels: [] });
  assert.deepEqual(decision, {
    next: "continue",
    label: RETRY_LABEL,
    consecutiveFailures: 1,
    lastSafeguard: null,
    reason: null,
  });
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
  assert.equal(decision.reason, "failures");
});

test("crashes count towards the stop and label nothing", () => {
  const first = decideNext({ run: { kind: "crash", detail: "" }, consecutiveFailures: 0 });
  assert.deepEqual(first, {
    next: "continue",
    label: null,
    consecutiveFailures: 1,
    lastSafeguard: null,
    reason: null,
  });
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

// --- phaseEnd ---------------------------------------------------------------

const issue = (number, ...labels) => ({ number, labels });

test("a phase whose pull request is open and only HITL issues remain is done", () => {
  const end = phaseEnd({
    pullRequest: { number: 240 },
    openIssues: [issue(51, "phase:09-rag", "hitl")],
  });
  assert.equal(end.status, "done");
  assert.match(
    end.log[0],
    /^phase done: draft pull request #240 is open; mark it ready for review when the phase is complete/,
  );
  assert.ok(end.log.some((line) => /HITL.*#51/.test(line)));
  assert.match(end.alert.join(" "), /phase done/);
  assert.match(end.alert.join(" "), /#240/);
});

test("a done phase without open issues lists nothing more", () => {
  const end = phaseEnd({ pullRequest: { number: 240 }, openIssues: [] });
  assert.equal(end.status, "done");
  assert.equal(end.log.length, 1);
});

test("a phase without a pull request has stopped and says so", () => {
  const end = phaseEnd({
    pullRequest: null,
    openIssues: [
      issue(222, "phase:09-rag", "agent-failed"),
      issue(223, "phase:09-rag", "ready-for-agent"),
      issue(224, "phase:09-rag", "hitl"),
    ],
  });
  assert.equal(end.status, "stopped");
  assert.equal(end.log[0], "phase stopped: no workable issue left");
  const text = end.log.join("\n");
  assert.match(text, /agent-failed: #222/);
  assert.match(text, /blocked or not ready: #223/);
  assert.match(text, /HITL: #224/);
  assert.match(text, /no phase pull request/);
  assert.doesNotMatch(text, /mark it ready/);
  assert.match(end.alert.join(" "), /phase stopped/);
  assert.match(end.alert.join(" "), /no phase pull request/);
});

test("failed or blocked issues make a phase with a pull request read as stopped", () => {
  const end = phaseEnd({
    pullRequest: { number: 240 },
    openIssues: [issue(222, "agent-failed"), issue(224, "hitl")],
  });
  assert.equal(end.status, "stopped");
  const text = end.log.join("\n");
  assert.match(text, /draft pull request #240 is open/);
  assert.match(text, /agent-failed: #222/);
  assert.doesNotMatch(text, /mark it ready/);
});

test("an issue labelled both HITL and agent-failed counts as failed", () => {
  const end = phaseEnd({
    pullRequest: { number: 1 },
    openIssues: [issue(9, "hitl", "agent-failed")],
  });
  assert.equal(end.status, "stopped");
  assert.match(end.log.join("\n"), /agent-failed: #9/);
  assert.doesNotMatch(end.log.join("\n"), /HITL/);
});

test("a pull request gh could not look up is not reported as open or missing", () => {
  const end = phaseEnd({ pullRequest: undefined, openIssues: [] });
  assert.equal(end.status, "stopped");
  const text = end.log.join("\n");
  assert.match(text, /could not check/);
  assert.doesNotMatch(text, /no phase pull request|is open/);
});

test("open issues gh could not list are said to be unknown", () => {
  const end = phaseEnd({ pullRequest: { number: 240 }, openIssues: null });
  assert.equal(end.status, "done");
  assert.match(end.log.join("\n"), /could not list/);
});
