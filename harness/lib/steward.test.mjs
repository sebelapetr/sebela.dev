import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LIMITS,
  STEWARD_REPORT_SCHEMA,
  assess,
  decideStop,
  formatVerdict,
  fullSuites,
  hardStops,
  modelTriggers,
  needsModel,
  paidCiRuns,
  parseProcesses,
  summarizeTranscript,
  usageOf,
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

test("the line says what is happening, then what was found", () => {
  const plain = (text) =>
    text
      .split("\u001b")
      .join("")
      .replace(/\[\d+m/g, "");
  const line = "backend-developer on #24 · 16 min";
  assert.equal(
    plain(formatVerdict({ status: "ok", findings: [], line })),
    `[steward] ok · ${line}`,
  );
  assert.equal(
    plain(formatVerdict({ status: "warn", findings: ["slow"], line })),
    `[steward] warn · ${line}: slow`,
  );
});

test("the model's report schema requires a status and findings", () => {
  assert.deepEqual(STEWARD_REPORT_SCHEMA.required, ["status", "findings"]);
});

// --- spend and efficiency (issue #371) ----------------------------------------------

const spend = (extra = {}) => ({
  campaign: "07-ai-service",
  ceilingUsd: 4,
  issueStopUsd: 1.5,
  runStopUsd: 1,
  spentUsd: 0.6,
  uncertainUsd: 0,
  issueSpentUsd: 0.6,
  remainingUsd: 3.4,
  projectedUsd: 0.6,
  recent: [],
  unknown: [],
  ...extra,
});
const machine = (extra = {}) => ({ load1: 1.2, cores: 4, freeDiskGb: 40, ...extra });
const efficient = {
  ...healthy,
  spend: spend(),
  paidCi: { runs: [], unknown: [] },
  machine: machine(),
  fullSuites: [],
  reviewRounds: 1,
  usage: { turns: 40, inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, minutes: 12 },
};
const codes = (list) => list.map((item) => item.code);

test("a run within its ceiling on a quiet machine has no finding and no stop", () => {
  assert.deepEqual(assess(efficient), []);
  assert.deepEqual(hardStops(efficient), []);
  assert.deepEqual(modelTriggers(efficient), []);
});

test("the facts of a check before this change still assess without the new ones", () => {
  assert.deepEqual(hardStops(healthy), []);
  assert.deepEqual(modelTriggers(healthy), []);
});

test("a reached ceiling stops the loop", () => {
  const facts = { ...efficient, spend: spend({ spentUsd: 4, remainingUsd: 0, projectedUsd: 4 }) };
  const [stop] = hardStops(facts);
  assert.equal(stop.code, "ceiling");
  assert.match(stop.reason, /07-ai-service/);
  assert.match(stop.reason, /4\.00 USD/);
  assert.ok(codes(assess(facts)).includes("ceiling"));
  assert.equal(assess(facts).find((f) => f.code === "ceiling").level, "problem");
});

test("spend projected past the ceiling stops the loop before it gets there", () => {
  const facts = {
    ...efficient,
    spend: spend({ spentUsd: 3.5, remainingUsd: 0.5, projectedUsd: 4.3 }),
  };
  assert.deepEqual(codes(hardStops(facts)), ["ceiling-projected"]);
  assert.match(hardStops(facts)[0].reason, /4\.3000 USD/);
});

test("an issue run past the per-run stop stops the loop; the phase-PR run is not bound", () => {
  const over = { run: "r9", source: "feat-1-x", stage: "issue", scope: "partial", spentUsd: 1.2 };
  const facts = { ...efficient, spend: spend({ recent: [over] }) };
  assert.deepEqual(codes(hardStops(facts)), ["run-stop"]);
  assert.match(hardStops(facts)[0].reason, /r9/);
  const phasePr = { ...over, stage: "phase-pr" };
  assert.deepEqual(hardStops({ ...efficient, spend: spend({ recent: [phasePr] }) }), []);
  const within = { ...over, spentUsd: 1 };
  assert.deepEqual(hardStops({ ...efficient, spend: spend({ recent: [within] }) }), []);
});

test("an unexpected paid CI run stops the loop; one started by hand is only reported", () => {
  const unexpected = {
    id: 7,
    event: "pull_request",
    branch: "phase/07-ai-service",
    unexpected: true,
    new: true,
    jobs: ["Python agent model evals"],
  };
  const byHand = {
    id: 8,
    event: "workflow_dispatch",
    branch: "phase/07-ai-service",
    unexpected: false,
    new: true,
    jobs: ["MCP Admin model evals"],
  };
  const stopped = { ...efficient, paidCi: { runs: [unexpected], unknown: [] } };
  assert.deepEqual(codes(hardStops(stopped)), ["paid-ci"]);
  assert.match(hardStops(stopped)[0].reason, /run 7/);
  const reported = { ...efficient, paidCi: { runs: [byHand], unknown: [] } };
  assert.deepEqual(hardStops(reported), []);
  assert.equal(modelTriggers(reported).length, 1);
  assert.match(modelTriggers(reported)[0], /run 8/);
  // Seen at an earlier check: the model has judged it already.
  const seen = { ...efficient, paidCi: { runs: [{ ...byHand, new: false }], unknown: [] } };
  assert.deepEqual(modelTriggers(seen), []);
});

test("free disk below the threshold stops the loop; getting close is a warning", () => {
  assert.equal(LIMITS.diskStopGb, 2);
  const low = { ...efficient, machine: machine({ freeDiskGb: 1.4 }) };
  assert.deepEqual(codes(hardStops(low)), ["disk"]);
  assert.match(hardStops(low)[0].reason, /1\.4 GB/);
  const close = { ...efficient, machine: machine({ freeDiskGb: 4 }) };
  assert.deepEqual(hardStops(close), []);
  assert.deepEqual(codes(assess(close)), ["disk"]);
  assert.equal(assess(close)[0].level, "warn");
});

test("what cannot be measured never stops the loop by itself and is never read as zero", () => {
  const unknown = {
    ...efficient,
    spend: spend({
      spentUsd: null,
      uncertainUsd: null,
      issueSpentUsd: null,
      remainingUsd: null,
      projectedUsd: null,
      unknown: [{ code: "no-ledger", message: "no eval ledger was found on this machine" }],
    }),
    paidCi: null,
    machine: machine({ freeDiskGb: null, load1: null }),
    fullSuites: null,
    reviewRounds: null,
    usage: null,
  };
  assert.deepEqual(hardStops(unknown), []);
  const found = assess(unknown);
  // No ledger yet is the normal state before the first paid run; the rest is worth a warning.
  assert.ok(!codes(found).includes("ceiling"));
  assert.ok(codes(found).includes("paid-ci-unknown"));
  assert.ok(codes(found).includes("machine-unknown"));
  assert.ok(found.every((f) => f.level === "warn"));
  const unreadable = {
    ...efficient,
    spend: spend({
      unknown: [{ code: "unreadable-ledger", message: "the eval ledger of x cannot be read" }],
    }),
  };
  assert.deepEqual(codes(assess(unreadable)), ["spend-unknown"]);
});

test("spend near the ceiling is a warning", () => {
  const near = {
    ...efficient,
    spend: spend({ spentUsd: 3.3, remainingUsd: 0.7, projectedUsd: 3.3, issueSpentUsd: 1 }),
  };
  assert.deepEqual(codes(assess(near)), ["spend"]);
  const issueStop = {
    ...efficient,
    spend: spend({ spentUsd: 1.5, issueSpentUsd: 1.5, remainingUsd: 2.5, projectedUsd: 1.5 }),
  };
  // The reached issue stop is a hard stop (issue #384), shown as a problem.
  assert.deepEqual(codes(assess(issueStop)), ["issue-stop"]);
  assert.equal(assess(issueStop)[0].level, "problem");
});

test("a third review round, a loaded machine and several full suites are warnings", () => {
  assert.deepEqual(codes(assess({ ...efficient, reviewRounds: 2 })), []);
  assert.deepEqual(codes(assess({ ...efficient, reviewRounds: 3 })), ["review-rounds"]);
  assert.deepEqual(codes(assess({ ...efficient, machine: machine({ load1: 7.9 }) })), []);
  const loaded = assess({ ...efficient, machine: machine({ load1: 21.3 }) });
  assert.deepEqual(codes(loaded), ["load"]);
  assert.match(loaded[0].message, /21\.3 on 4 cores/);
  const one = [{ pid: 1, kind: "pnpm test", minutes: 3 }];
  assert.deepEqual(codes(assess({ ...efficient, fullSuites: one })), []);
  const two = [...one, { pid: 2, kind: "pnpm ci:affected", minutes: 1 }];
  const several = assess({ ...efficient, fullSuites: two });
  assert.deepEqual(codes(several), ["full-suites"]);
  assert.match(several[0].message, /pnpm test, pnpm ci:affected/);
});

test("a new paid run is put to the model without being a warning", () => {
  const run = {
    run: "r3",
    source: "feat-1-x",
    stage: "issue",
    scope: "partial",
    spentUsd: 0.2,
    expectedUsd: 0.25,
  };
  const facts = { ...efficient, spend: spend({ recent: [run] }) };
  assert.deepEqual(assess(facts), []);
  assert.equal(modelTriggers(facts).length, 1);
  assert.match(modelTriggers(facts)[0], /r3/);
});

// --- the agent's usage -----------------------------------------------------------

function turn(minutesAgo, id, usage) {
  return JSON.stringify({
    type: "assistant",
    timestamp: at(minutesAgo, now),
    message: { id, usage, content: [] },
  });
}

test("a transcript gives turns, tokens and wall time", () => {
  const lines = [
    prompt,
    turn(30, "m1", {
      input_tokens: 100,
      cache_creation_input_tokens: 50,
      cache_read_input_tokens: 1000,
      output_tokens: 20,
    }),
    // The same response written again with its next content block counts once.
    turn(30, "m1", {
      input_tokens: 100,
      cache_creation_input_tokens: 50,
      cache_read_input_tokens: 1000,
      output_tokens: 20,
    }),
    turn(10, "m2", { input_tokens: 10, cache_read_input_tokens: 2000, output_tokens: 300 }),
    "not json",
  ];
  assert.deepEqual(usageOf(lines), {
    turns: 2,
    inputTokens: 160,
    outputTokens: 320,
    cacheReadTokens: 3000,
    minutes: 30,
  });
});

test("a transcript that cannot be read or holds no response has unknown usage", () => {
  assert.equal(usageOf(null), null);
  assert.equal(usageOf([]), null);
  assert.equal(usageOf([prompt, "not json"]), null);
});

// --- full test suites running at once ---------------------------------------------

test("full suites are counted once each, whatever they start", () => {
  const processes = parseProcesses(
    [
      "  100     1   600 bash",
      "  110   100   300 node /home/x/.nvm/bin/pnpm test",
      "  111   110   299 node /repo/node_modules/.bin/turbo run test",
      "  112   111   200 node /repo/node_modules/vitest/vitest.mjs run",
      "  200     1   120 sh -c pnpm ci:affected",
      "  201   200   119 node /usr/bin/pnpm ci:affected",
      "  300     1    60 node /usr/bin/pnpm --filter @sebela/api test",
      "  310     1    60 node /usr/bin/pnpm test --filter @sebela/web",
      "  320     1    30 node /repo/node_modules/.bin/turbo run lint typecheck --filter=@sebela/api...",
      "  330     1    45 node /repo/node_modules/.bin/playwright test",
      "  340     1    10 node --test harness/",
      "  350     1    10 grep -rn 'pnpm test' docs",
    ].join("\n"),
  );
  assert.equal(processes.length, 12);
  assert.deepEqual(fullSuites(processes), [
    { pid: 110, kind: "pnpm test", minutes: 5 },
    { pid: 200, kind: "pnpm ci:affected", minutes: 2 },
    { pid: 330, kind: "playwright test", minutes: 1 },
  ]);
});

test("a process list that cannot be read is unknown", () => {
  assert.equal(parseProcesses(null), null);
  assert.equal(fullSuites(null), null);
});

// --- paid CI runs ----------------------------------------------------------------

const ciRun = (databaseId, event, headBranch, minutesAgo) => ({
  databaseId,
  event,
  headBranch,
  createdAt: at(minutesAgo, now),
  status: "completed",
});
const job = (name, status, conclusion = null) => ({ name, status, conclusion });

test("only eval jobs that actually ran count as a paid CI run", () => {
  const runs = [
    ciRun(1, "pull_request", "phase/07-ai-service", 10),
    ciRun(2, "pull_request", "fix/9-thing", 9),
    ciRun(3, "workflow_dispatch", "phase/07-ai-service", 8),
    ciRun(4, "pull_request", "phase/07-ai-service", 7),
    ciRun(5, "pull_request", "phase/09.1-rag-integration", 6),
    ciRun(6, "pull_request", "phase/07-ai-service", 500),
    ciRun(7, "pull_request", "feat/301-chat", 5),
  ];
  const jobs = new Map([
    [
      1,
      [
        job("Affected eval suites", "completed", "success"),
        job("Python agent model evals", "in_progress"),
      ],
    ],
    [
      2,
      [
        job("Affected eval suites", "completed", "success"),
        job("MCP Admin model evals", "completed", "skipped"),
        job("Python agent model evals", "completed", "skipped"),
      ],
    ],
    [3, [job("MCP Admin model evals", "completed", "failure")]],
    [4, [job("Affected eval suites", "completed", "skipped")]],
    [5, [job("Python agent model evals", "completed", "success")]],
    [6, [job("Python agent model evals", "completed", "success")]],
    [7, null],
  ]);
  const paid = paidCiRuns({
    runs,
    jobs,
    since: now - 60 * 60_000,
    branches: ["phase/07-ai-service", "feat/301-chat"],
  });
  assert.deepEqual(
    paid.runs.map((run) => [run.id, run.event, run.branch, run.jobs, run.unexpected]),
    [
      [1, "pull_request", "phase/07-ai-service", ["Python agent model evals"], true],
      [3, "workflow_dispatch", "phase/07-ai-service", ["MCP Admin model evals"], false],
      // Another phase's pull request is that phase's business.
      [5, "pull_request", "phase/09.1-rag-integration", ["Python agent model evals"], false],
    ],
  );
  assert.deepEqual(paid.unknown, [7]);
});

// --- stopping the loop -----------------------------------------------------------

test("the model is asked again at once for something new, later for the same findings", () => {
  const warn = [{ level: "warn", code: "idle", message: "no activity" }];
  assert.equal(needsModel({ findings: warn, minutesSinceModel: 5, changed: true }), true);
  assert.equal(needsModel({ findings: warn, minutesSinceModel: 5, changed: false }), false);
  assert.equal(needsModel({ findings: warn, minutesSinceModel: 15, changed: false }), true);
  assert.equal(needsModel({ findings: [], minutesSinceModel: 5, triggers: ["paid run r3"] }), true);
  assert.equal(needsModel({ findings: [], minutesSinceModel: 5, triggers: [] }), false);
});

test("a hard stop stops the loop whatever the model says", () => {
  const hard = [{ code: "ceiling", reason: "the ceiling is reached" }];
  assert.deepEqual(decideStop({ hard, report: { status: "ok", findings: [], stop: false } }), {
    by: "rules",
    code: "ceiling",
    reason: "the ceiling is reached",
  });
  assert.deepEqual(decideStop({ hard, report: null }).by, "rules");
});

test("the model may stop the loop for inefficient work, with a reason", () => {
  const report = {
    status: "problem",
    findings: ["x"],
    stop: true,
    stopReason: "the same paid run was repeated without a changed input",
  };
  assert.deepEqual(decideStop({ hard: [], report }), {
    by: "model",
    code: "efficiency",
    reason: "the same paid run was repeated without a changed input",
  });
  assert.equal(decideStop({ hard: [], report: { ...report, stopReason: " " } }), null);
  assert.equal(decideStop({ hard: [], report: { ...report, stop: false } }), null);
  assert.equal(decideStop({ hard: [], report: { status: "problem", findings: ["x"] } }), null);
  assert.equal(decideStop({ hard: [], report: null }), null);
});

test("the model's report may carry a stop and its reason", () => {
  assert.equal(STEWARD_REPORT_SCHEMA.properties.stop.type, "boolean");
  assert.equal(STEWARD_REPORT_SCHEMA.properties.stopReason.type, "string");
});

// --- the gaps of the first guards (issue #384) -------------------------------------

test("issue runs at or past their cumulative stop stop the loop", () => {
  // Three issue worktrees with USD 1.00 each: every one within its own ledger's stop.
  const facts = {
    ...efficient,
    spend: spend({
      spentUsd: 3,
      issueSpentUsd: 3,
      issueProjectedUsd: 3,
      remainingUsd: 1,
      projectedUsd: 3,
    }),
  };
  const [stop] = hardStops(facts);
  assert.equal(stop.code, "issue-stop");
  assert.match(stop.reason, /1\.50 USD/);
  assert.match(stop.reason, /3\.0000 USD/);
  const at = {
    ...efficient,
    spend: spend({ spentUsd: 1.5, issueSpentUsd: 1.5, issueProjectedUsd: 1.5 }),
  };
  assert.deepEqual(codes(hardStops(at)), ["issue-stop"]);
  const below = {
    ...efficient,
    spend: spend({ spentUsd: 1.4, issueSpentUsd: 1.4, issueProjectedUsd: 1.4 }),
  };
  assert.deepEqual(hardStops(below), []);
  // Phase-PR spend is not issue work.
  const reserve = {
    ...efficient,
    spend: spend({ spentUsd: 2.6, issueSpentUsd: 0.6, issueProjectedUsd: 0.6 }),
  };
  assert.deepEqual(hardStops(reserve), []);
});

test("an issue run under way that is expected to pass the issue stop stops the loop", () => {
  const facts = {
    ...efficient,
    spend: spend({ spentUsd: 1.2, issueSpentUsd: 1.2, issueProjectedUsd: 1.7, projectedUsd: 1.7 }),
  };
  const [stop] = hardStops(facts);
  assert.equal(stop.code, "issue-stop");
  assert.match(stop.reason, /projected/);
  assert.match(stop.reason, /1\.7000 USD/);
});

test("the steward never says the runner refuses what only the loop stops", () => {
  const facts = {
    ...efficient,
    spend: spend({ spentUsd: 1.5, issueSpentUsd: 1.5, issueProjectedUsd: 1.5 }),
  };
  for (const item of [...assess(facts), ...hardStops(facts)]) {
    assert.doesNotMatch(item.message ?? item.reason, /runner refuses/);
  }
});

test("a local phase-PR run during the loop stops it", () => {
  const run = {
    run: "r7",
    source: "feat-301-chat",
    campaign: "07-ai-service",
    stage: "phase-pr",
    scope: "running",
    spentUsd: 0.2,
  };
  const facts = { ...efficient, spend: spend({ recent: [run] }) };
  const [stop] = hardStops(facts);
  assert.equal(stop.code, "phase-pr-run");
  assert.match(stop.reason, /r7/);
  assert.match(stop.reason, /feat-301-chat/);
  assert.match(stop.reason, /--stage phase-pr/);
});

test("a paid run of another phase's campaign in the loop's worktree stops it", () => {
  const foreign = {
    run: "r8",
    source: "feat-301-chat",
    campaign: "08-mcp-public",
    stage: "issue",
    scope: "partial",
    spentUsd: 0.4,
  };
  const facts = { ...efficient, worktree: "feat-301-chat", spend: spend({ foreign: [foreign] }) };
  const [stop] = hardStops(facts);
  assert.equal(stop.code, "foreign-campaign");
  assert.match(stop.reason, /08-mcp-public/);
  assert.match(stop.reason, /r8/);
  // Another loop's or the owner's run elsewhere is theirs: reported to the model, no stop.
  const elsewhere = {
    ...facts,
    spend: spend({ foreign: [{ ...foreign, source: "feat-410-search" }] }),
  };
  assert.deepEqual(hardStops(elsewhere), []);
  assert.equal(modelTriggers(elsewhere).length, 1);
  assert.match(modelTriggers(elsewhere)[0], /08-mcp-public/);
  const unknown = { ...facts, worktree: null };
  assert.deepEqual(hardStops(unknown), []);
});

test("the disk stop needs two readings in a row during an iteration", () => {
  const first = { ...efficient, machine: machine({ freeDiskGb: 1.4, freeDiskGbBefore: 6 }) };
  assert.deepEqual(hardStops(first), []);
  assert.deepEqual(codes(assess(first)), ["disk"]);
  assert.equal(assess(first)[0].level, "warn");
  const unknownBefore = {
    ...efficient,
    machine: machine({ freeDiskGb: 1.4, freeDiskGbBefore: null }),
  };
  assert.deepEqual(hardStops(unknownBefore), []);
  const second = { ...efficient, machine: machine({ freeDiskGb: 1.6, freeDiskGbBefore: 1.4 }) };
  assert.deepEqual(codes(hardStops(second)), ["disk"]);
  // Between iterations one reading is enough: nothing is cut off.
  const between = { ...efficient, machine: machine({ freeDiskGb: 1.4 }) };
  assert.deepEqual(codes(hardStops(between)), ["disk"]);
});
