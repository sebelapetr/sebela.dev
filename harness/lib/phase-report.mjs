// The phase report: what a phase's unattended run cost and where it struggled, from the logs the
// loop leaves in .worktrees/logs/<phase>/. Pure — the caller reads the files
// (harness/phase-report.mjs). Intent: docs/agents.md, "The phase report".

import { toolCalls } from "./progress.mjs";
import { workLines } from "./selection.mjs";

function parseResult(stdout) {
  const text = String(stdout ?? "").trim();
  for (const candidate of [text, text.split("\n").filter(Boolean).at(-1)]) {
    try {
      const value = JSON.parse(candidate ?? "");
      if (value && typeof value === "object") return value;
    } catch {
      // not JSON
    }
  }
  return null;
}

// One iteration log ({ iteration, run, raw }) → what it did and cost.
export function iterationStats({ iteration, run, raw }) {
  const result = parseResult(raw?.stdout);
  const report = run?.kind === "report";
  return {
    iteration,
    outcome: report ? run.outcome : (run?.kind ?? "unknown"),
    issue: report ? (run.issue ?? null) : null,
    costUsd: typeof result?.total_cost_usd === "number" ? result.total_cost_usd : null,
    minutes:
      typeof result?.duration_ms === "number" ? Math.round(result.duration_ms / 60_000) : null,
    turns: result?.num_turns ?? null,
    sessionId: result?.session_id ?? null,
  };
}

const dollars = (value) => `$${value.toFixed(2)}`;

// For the loop's log line; empty when the run left no result.
export function formatCost({ costUsd, minutes }) {
  if (costUsd === null || costUsd === undefined) return "";
  return minutes === null || minutes === undefined
    ? dollars(costUsd)
    : `${dollars(costUsd)}, ${minutes} min`;
}

// How often the orchestrator put each agent to work, from its transcript (JSONL lines): a
// dispatch and every continuation of the same agent count, so review rounds are counted right.
export function countDispatches(lines) {
  const counts = {};
  for (const { agent } of toolCalls(lines)) {
    if (agent) counts[agent] = (counts[agent] ?? 0) + 1;
  }
  return counts;
}

const duration = (minutes) =>
  minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
const sum = (values) => values.reduce((total, value) => total + (value ?? 0), 0);

// `work` is the phase's work selection when the report is written (lib/selection.mjs), null when
// GitHub could not be asked.
export function renderReport({ phase, iterations, steward, memory, suggestions, work = null }) {
  const out = [`# Phase report: ${phase}`, ""];
  const merged = iterations.filter((it) => it.outcome === "merged");
  out.push(
    `${iterations.length} iterations, ${merged.length} issues merged, ${dollars(sum(iterations.map((it) => it.costUsd)))} in total, ${duration(sum(iterations.map((it) => it.minutes)))} of agent time.`,
    "",
  );

  out.push(
    "## Issues",
    "",
    "| Issue | Outcome | Cost | Time | Review rounds |",
    "| --- | --- | --- | --- | --- |",
  );
  const byIssue = new Map();
  for (const it of iterations.filter((it) => it.issue !== null)) {
    byIssue.set(it.issue, [...(byIssue.get(it.issue) ?? []), it]);
  }
  for (const [issue, runs] of byIssue) {
    out.push(
      `| #${issue} | ${runs.at(-1).outcome} | ${dollars(sum(runs.map((r) => r.costUsd)))} | ${duration(sum(runs.map((r) => r.minutes)))} | ${sum(runs.map((r) => r.dispatches?.reviewer))} |`,
    );
  }
  const other = iterations.filter((it) => it.issue === null);
  if (other.length > 0) {
    out.push(
      "",
      `Iterations without a finished issue (interrupted, crashed, usage limit, phase done): ${other.map((it) => `${it.outcome} ${formatCost(it) || "no result"}`).join("; ")}.`,
    );
  }

  // What the tracking issue shows now: progress, and every open issue with why it is not done.
  out.push("", "## What is left", "");
  if (work) for (const line of workLines(work)) out.push(`- ${line}`);
  else out.push("Unknown: the phase's tracking issue could not be read.");

  // The spend line the loop logged with each iteration (harness/lib/spend.mjs): the state at the
  // last one, and every iteration that paid for model evals.
  out.push("", "## Eval spend", "");
  const withSpend = iterations.filter((it) => it.spend?.line);
  const text = (it) => it.spend.line.replace(/^spend: /, "");
  if (withSpend.length === 0) out.push("Unknown: no iteration logged its eval spend.");
  else out.push(`At the last iteration: ${text(withSpend.at(-1))}.`);
  const paid = withSpend.filter((it) => it.spend.paid);
  if (paid.length > 0) out.push("");
  for (const it of paid) {
    out.push(
      `- ${it.issue === null || it.issue === undefined ? "no issue" : `#${it.issue}`} (iteration ${it.iteration}): ${text(it)}`,
    );
  }

  out.push("", "## Steward", "");
  const counts = { ok: 0, warn: 0, problem: 0 };
  const findings = new Set();
  for (const { verdict } of steward) {
    counts[verdict.status] = (counts[verdict.status] ?? 0) + 1;
    if (verdict.status !== "ok")
      for (const f of verdict.findings) findings.add(`${verdict.status}: ${f}`);
  }
  out.push(
    steward.length === 0
      ? "No steward checks were logged."
      : `Checks — ok: ${counts.ok}, warn: ${counts.warn}, problem: ${counts.problem}.`,
  );
  for (const f of findings) out.push(`- ${f}`);

  out.push("", "## Guard refusals", "");
  const refused = new Map();
  for (const { command, count } of iterations.flatMap((it) => it.refusals ?? [])) {
    const line = command.replace(/\s+/g, " ").trim().slice(0, 140);
    refused.set(line, (refused.get(line) ?? 0) + count);
  }
  if (refused.size === 0) out.push("None.");
  else
    out.push(
      `${sum([...refused.values()])} refusals of ${refused.size} commands; the most frequent:`,
      "",
    );
  for (const [command, count] of [...refused].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    out.push(`- ${count}× ${command}`);
  }

  out.push("", "## Agent memory changed in this phase", "");
  if (memory.length === 0) out.push("None.");
  for (const { agent, file } of memory)
    out.push(`- \`.claude/agent-memory-local/${agent}/${file}\``);

  out.push(
    "",
    "## Suggestions",
    "",
    suggestions?.trim() || "No suggestions: the model was not asked or gave no answer.",
    "",
  );
  return out.join("\n");
}
