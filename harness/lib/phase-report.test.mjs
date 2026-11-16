import { test } from "node:test";
import assert from "node:assert/strict";
import { countDispatches, formatCost, iterationStats, renderReport } from "./phase-report.mjs";

const stdout = (extra) =>
  JSON.stringify({
    total_cost_usd: 7.2919,
    duration_ms: 25 * 60_000 + 20_000,
    num_turns: 41,
    session_id: "s1",
    ...extra,
  });

test("an iteration's cost, time and outcome come from the orchestrator's result", () => {
  const stats = iterationStats({
    iteration: 1,
    run: { kind: "report", outcome: "merged", issue: 22, summary: "x" },
    raw: { stdout: stdout() },
  });
  assert.deepEqual(stats, {
    iteration: 1,
    outcome: "merged",
    issue: 22,
    costUsd: 7.2919,
    minutes: 25,
    turns: 41,
    sessionId: "s1",
  });
});

test("an interrupted or crashed iteration still counts what it cost", () => {
  const stats = iterationStats({ iteration: 2, run: { kind: "crash" }, raw: { stdout: stdout() } });
  assert.equal(stats.outcome, "crash");
  assert.equal(stats.issue, null);
  assert.equal(stats.costUsd, 7.2919);
});

test("without a JSON result nothing is invented", () => {
  const stats = iterationStats({ iteration: 3, run: { kind: "limit" }, raw: { stdout: "" } });
  assert.equal(stats.costUsd, null);
  assert.equal(stats.minutes, null);
  assert.equal(formatCost(stats), "");
});

test("the log line shows cost and time", () => {
  assert.equal(formatCost({ costUsd: 7.2919, minutes: 25 }), "$7.29, 25 min");
});

test("dispatches of each agent are counted from the orchestrator's transcript", () => {
  const call = (type) =>
    JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "Agent", input: { subagent_type: type } }] },
    });
  const counts = countDispatches([
    call("backend-developer"),
    call("reviewer"),
    call("reviewer"),
    "{bad",
  ]);
  assert.deepEqual(counts, { "backend-developer": 1, reviewer: 2 });
});

test("the report adds up the phase per issue and lists what needs the owner", () => {
  const report = renderReport({
    phase: "02-api-db",
    iterations: [
      {
        iteration: 1,
        outcome: "merged",
        issue: 22,
        costUsd: 4,
        minutes: 24,
        dispatches: { reviewer: 1 },
        refusals: [],
      },
      {
        iteration: 1,
        outcome: "crash",
        issue: null,
        costUsd: 7.3,
        minutes: 30,
        dispatches: { reviewer: 1 },
        refusals: [{ command: "docker run postgres", count: 2 }],
      },
      {
        iteration: 2,
        outcome: "merged",
        issue: 23,
        costUsd: 5,
        minutes: 40,
        dispatches: { reviewer: 2 },
        refusals: [],
      },
    ],
    steward: [
      { verdict: { status: "ok", findings: [] } },
      { verdict: { status: "problem", findings: ["Postgres is unknown"] } },
      { verdict: { status: "problem", findings: ["Postgres is unknown"] } },
    ],
    memory: [{ agent: "backend-developer", file: "tooling-pitfalls.md" }],
    suggestions: "- Promote the pnpm note to docs/repository-structure.md.",
  });
  assert.match(report, /^# Phase report: 02-api-db/m);
  assert.match(report, /\$16\.30/, "total cost");
  assert.match(report, /1 h 34 min/, "total time");
  assert.match(
    report,
    /\| #23 \| merged \| \$5\.00 \| 40 min \| 2 \|/,
    "per issue with review rounds",
  );
  assert.match(report, /crash/);
  assert.match(report, /2× docker run postgres/);
  assert.match(report, /problem: 2/);
  assert.equal(report.match(/Postgres is unknown/g).length, 1, "a repeated finding is listed once");
  assert.match(report, /backend-developer\/tooling-pitfalls\.md/);
  assert.match(report, /Promote the pnpm note/);
});

test("a report without a model's suggestions says so instead of leaving a hole", () => {
  const report = renderReport({
    phase: "p",
    iterations: [],
    steward: [],
    memory: [],
    suggestions: null,
  });
  assert.match(report, /No suggestions/);
  assert.match(report, /No steward checks were logged/, "not a misleading 0 of each");
});

test("refusals are merged, the most frequent first, ten at most, each on one line", () => {
  const refusals = Array.from({ length: 12 }, (_, i) => ({
    command: `cmd ${i}\nsecond line`,
    count: 1,
  }));
  refusals.push({ command: "cmd 3\nsecond line", count: 4 });
  const report = renderReport({
    phase: "p",
    iterations: [{ iteration: 1, outcome: "merged", issue: 1, costUsd: 1, minutes: 1, refusals }],
    steward: [],
    memory: [],
    suggestions: null,
  });
  assert.match(report, /16 refusals of 12 commands/);
  const section = report.split("## Guard refusals")[1].split("##")[0];
  const items = section.split("\n").filter((line) => line.startsWith("- "));
  assert.equal(items.length, 10);
  assert.match(items[0], /^- 5× cmd 3 second line$/);
});
