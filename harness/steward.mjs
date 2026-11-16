// The steward: every few minutes while the phase loop runs, it gathers what the run leaves behind —
// the orchestrator's and its subagents' transcripts, the phase's pull requests, Postgres, the
// worktree slots — and prints one line: ok, a warning or a problem. When something looks wrong, and
// once an hour anyway, a small model (the `steward` agent) reads the facts and the latest
// transcript and judges what a script cannot. It only reports. Rules: lib/steward.mjs; intent:
// docs/agents.md, "The steward".

import fs from "node:fs";
import path from "node:path";
import {
  STEWARD_REPORT_SCHEMA,
  assess,
  formatVerdict,
  needsModel,
  summarizeTranscript,
} from "./lib/steward.mjs";
import { askAgent, quiet, readLines, transcriptDir } from "./run-tools.mjs";
import { listWorktrees } from "./worktree.mjs";

const EXCERPT_ENTRIES = 40;
const EXCERPT_CHARS = 12_000;

function newestFile(dir) {
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".jsonl"))
      .map((name) => path.join(dir, name))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  } catch {
    return undefined;
  }
}

export function postgresHealth(mainRoot) {
  const out = quiet("docker", ["compose", "ps", "--format", "json", "postgres"], { cwd: mainRoot });
  if (out === null) return "unknown";
  const service = out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .find(Boolean);
  if (!service) return "down";
  return service.Health || service.State || "unknown";
}

const FAILED = new Set(["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED"]);

function failingPullRequests(phase) {
  const out = quiet("gh", [
    "pr",
    "list",
    "--base",
    `phase/${phase}`,
    "--state",
    "open",
    "--json",
    "number,statusCheckRollup",
  ]);
  if (out === null) return [];
  return JSON.parse(out)
    .filter((pr) =>
      (pr.statusCheckRollup ?? []).some((check) => FAILED.has(check.conclusion ?? check.state)),
    )
    .map((pr) => pr.number);
}

export function failedIssues(phase) {
  const out = quiet("gh", [
    "issue",
    "list",
    "--label",
    `phase:${phase}`,
    "--label",
    "agent-failed",
    "--state",
    "open",
    "--json",
    "number",
  ]);
  return out === null ? [] : JSON.parse(out).map((issue) => issue.number);
}

// Worktrees whose branch belongs to a merged pull request; the caller reports only those seen twice,
// because the orchestrator removes a worktree shortly after merging it.
function mergedWorktrees(mainRoot) {
  const porcelain = quiet("git", ["worktree", "list", "--porcelain"], { cwd: mainRoot }) ?? "";
  const branches = new Map();
  let current = null;
  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) current = line.slice("worktree ".length);
    if (line.startsWith("branch refs/heads/") && current)
      branches.set(path.basename(current), line.slice(18));
  }
  return listWorktrees({ mainRoot })
    .map(({ name }) => ({ name, branch: branches.get(name) }))
    .filter(({ branch }) => {
      if (!branch) return false;
      const out = quiet("gh", [
        "pr",
        "list",
        "--state",
        "merged",
        "--head",
        branch,
        "--json",
        "number",
      ]);
      return out !== null && JSON.parse(out).length > 0;
    })
    .map(({ name }) => name);
}

// A readable tail of a transcript for the model: what the agent did and what came back.
function excerpt(lines) {
  const parts = [];
  for (const line of lines.slice(-EXCERPT_ENTRIES)) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const content = entry?.message?.content;
    if (typeof content === "string") parts.push(`${entry.type}: ${content.slice(0, 400)}`);
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part.type === "text") parts.push(`${entry.type} text: ${part.text.slice(0, 400)}`);
      if (part.type === "tool_use")
        parts.push(`call ${part.name}: ${JSON.stringify(part.input).slice(0, 300)}`);
      if (part.type === "tool_result") {
        const text = typeof part.content === "string" ? part.content : JSON.stringify(part.content);
        parts.push(`result${part.is_error ? " (error)" : ""}: ${String(text).slice(0, 300)}`);
      }
    }
  }
  return parts.join("\n").slice(-EXCERPT_CHARS);
}

function askModel({ mainRoot, phase, facts, findings, transcript }) {
  const prompt = [
    `Phase: ${phase}. Judge whether this unattended run is healthy. Follow your agent definition.`,
    `Facts gathered by the harness:\n${JSON.stringify(facts, null, 2)}`,
    `Findings of the harness's rules:\n${findings.map((f) => `- ${f.level}: ${f.message}`).join("\n") || "- none"}`,
    `Latest entries of the current agent's transcript:\n${transcript || "(none)"}`,
  ].join("\n\n");
  return askAgent({
    mainRoot,
    agent: "steward",
    prompt,
    schema: STEWARD_REPORT_SCHEMA,
    name: `steward ${phase}`,
  }).then((report) => (report?.status ? report : null));
}

const SEVERITY = { ok: 0, warn: 1, problem: 2 };

// One check. `state` carries what earlier checks saw: { lastModelAt, seenMerged }.
export async function checkOnce({
  mainRoot,
  phase,
  sessionId,
  iterationStartedAt,
  failedAtStart,
  state,
  logDir,
}) {
  const now = Date.now();
  const dir = transcriptDir(mainRoot);
  const main = readLines(path.join(dir, `${sessionId}.jsonl`));
  const subagentFile = newestFile(path.join(dir, sessionId, "subagents"));
  const sub = subagentFile ? readLines(subagentFile) : null;

  const mainSummary = main ? summarizeTranscript(main, { now }) : null;
  const subSummary = sub ? summarizeTranscript(sub, { now }) : null;
  const idle = [mainSummary?.idleMinutes, subSummary?.idleMinutes].filter(
    (m) => m !== null && m !== undefined,
  );

  const merged = mergedWorktrees(mainRoot);
  const leftover = merged.filter((name) => state.seenMerged?.has(name));
  state.seenMerged = new Set(merged);

  const facts = {
    iterationMinutes: Math.round((now - iterationStartedAt) / 60_000),
    idleMinutes: idle.length ? Math.min(...idle) : null,
    agent: subSummary
      ? { task: subSummary.task, calls: subSummary.calls, context: subSummary.context }
      : {
          task: mainSummary?.task ?? null,
          calls: mainSummary?.calls ?? 0,
          context: mainSummary?.context ?? 0,
        },
    refusals: [...(mainSummary?.refusals ?? []), ...(subSummary?.refusals ?? [])],
    failingPullRequests: failingPullRequests(phase),
    postgres: postgresHealth(mainRoot),
    leftoverWorktrees: leftover,
    newFailedIssues: failedIssues(phase).filter((n) => !failedAtStart.includes(n)),
  };
  const findings = assess(facts);
  const rulesStatus = findings.reduce(
    (worst, f) => (SEVERITY[f.level] > SEVERITY[worst] ? f.level : worst),
    "ok",
  );
  let verdict = { status: rulesStatus, findings: findings.map((f) => f.message), by: "rules" };

  const minutesSinceModel = state.lastModelAt
    ? Math.round((now - state.lastModelAt) / 60_000)
    : null;
  if (needsModel({ findings, minutesSinceModel })) {
    state.lastModelAt = now;
    const report = await askModel({
      mainRoot,
      phase,
      facts,
      findings,
      transcript: excerpt(sub ?? main ?? []),
    });
    if (report) {
      // The model may explain or add, but never hides what the rules found.
      const status = SEVERITY[report.status] >= SEVERITY[rulesStatus] ? report.status : rulesStatus;
      verdict = {
        status,
        findings: report.findings.length ? report.findings : verdict.findings,
        by: "model",
      };
    } else {
      verdict.findings = [...verdict.findings, "the steward model gave no answer"];
    }
  }

  fs.appendFileSync(
    path.join(logDir, "steward.jsonl"),
    `${JSON.stringify({ at: new Date(now).toISOString(), facts, findings, verdict })}\n`,
  );
  console.log(formatVerdict(verdict));
  return verdict;
}
