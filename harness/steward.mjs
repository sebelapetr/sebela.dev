// The steward: every few minutes while the phase loop runs, it gathers what the run leaves behind —
// the orchestrator's and its subagents' transcripts, the phase's pull requests, Postgres, the
// worktree slots, the eval ledgers, the paid CI runs, the machine's load and disk — and prints one
// line: ok, a warning or a problem. When something looks wrong or was just paid for, and once an
// hour anyway, a small model (the `steward` agent) reads the facts and the latest transcript and
// judges what a script cannot. It returns whether the loop must stop: by a hard stop of the rules
// (eval ceiling, per-run stop, unexpected paid CI run, disk) or by the model's judgement that the
// work is inefficient. The loop acts on it (run-phase.mjs). Rules: lib/steward.mjs and
// lib/spend.mjs; intent: docs/agents.md, "The steward".

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
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
} from "./lib/steward.mjs";
import { countDispatches } from "./lib/phase-report.mjs";
import { currentWork, describeWork, phaseProgress } from "./lib/progress.mjs";
import { worktreeDirName } from "./lib/slots.mjs";
import { ledgerRuns, mergeRuns, parseCampaigns, summarizeSpend } from "./lib/spend.mjs";
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

// Closed of all the phase's issues, or null when GitHub cannot be asked.
export function phaseProgressNow(phase) {
  const out = quiet("gh", [
    "issue",
    "list",
    "--label",
    `phase:${phase}`,
    "--state",
    "all",
    "--limit",
    "200",
    "--json",
    "state",
  ]);
  return out === null ? null : phaseProgress(JSON.parse(out));
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

// --- spend ------------------------------------------------------------------------

const CAMPAIGNS_FILE = ["packages", "llm-agent", "evals", "campaigns.json"];
const LEDGER_FILE = [".tmp", "evals", "llm-agent", "ledger.json"];
// The runs the loop has seen, kept beside its logs: a worktree's ledger goes with the worktree.
const KEPT_RUNS = "eval-spend.json";

// Where the loop keeps them. The loop gives this path to the orchestrator's run as
// SEBELA_EVAL_KEPT_RUNS, and the eval runner adds the other checkouts' runs in it to its own
// ledger (packages/llm-agent/evals/budget.py), so the ceiling and the cumulative stop for issue
// runs hold across the issue worktrees between the steward's checks too.
export const keptRunsFile = (logDir) => path.join(logDir, KEPT_RUNS);

// A file's text; undefined when it does not exist, null when it cannot be read.
function textOf(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (error) {
    return error.code === "ENOENT" ? undefined : null;
  }
}

// The checkouts that may hold an eval ledger: the main one and every worktree folder.
function checkouts(mainRoot) {
  const found = [{ name: "the main checkout", root: mainRoot }];
  try {
    for (const entry of fs.readdirSync(path.join(mainRoot, ".worktrees"), {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      if (entry.name === "logs" || entry.name === "locks") continue;
      found.push({ name: entry.name, root: path.join(mainRoot, ".worktrees", entry.name) });
    }
  } catch {
    // no worktrees yet
  }
  return found;
}

// What the phase's eval campaign has spent (lib/spend.mjs, summarizeSpend), from the ledgers of
// every checkout and the runs kept from earlier checks in `logDir`. `since` (ms) lists the runs
// written from then on. The kept runs are updated, so the spend of a removed worktree stays.
export function phaseSpend({ mainRoot, phase, logDir, since = null }) {
  const campaignsText = textOf(path.join(mainRoot, ...CAMPAIGNS_FILE));
  const campaigns = campaignsText ? parseCampaigns(campaignsText) : null;
  const seen = [];
  const unreadable = [];
  let found = 0;
  for (const { name, root } of checkouts(mainRoot)) {
    const text = textOf(path.join(root, ...LEDGER_FILE));
    if (text === undefined) continue;
    const runs = text === null ? null : ledgerRuns(text, name);
    if (runs === null) unreadable.push(name);
    else {
      found += 1;
      seen.push(...runs);
    }
  }
  const keptFile = keptRunsFile(logDir);
  const keptText = textOf(keptFile);
  let kept = [];
  if (keptText !== undefined) {
    try {
      kept = JSON.parse(keptText).runs;
      if (!Array.isArray(kept)) throw new Error("no runs");
      found += 1;
    } catch {
      kept = [];
      unreadable.push("the loop's kept runs");
    }
  }
  const runs = mergeRuns(kept, seen);
  // An unreadable record is left as it is for the owner to look at, never overwritten.
  if (runs.length > 0 && !unreadable.includes("the loop's kept runs")) {
    const next = `${JSON.stringify({ runs }, null, 2)}\n`;
    if (next !== keptText) {
      try {
        fs.mkdirSync(logDir, { recursive: true });
        fs.writeFileSync(keptFile, next);
      } catch {
        // the next check tries again
      }
    }
  }
  return summarizeSpend({ phase, campaigns, runs, found, unreadable, since, now: Date.now() });
}

// --- paid CI runs -----------------------------------------------------------------

const WORKFLOW = "model-evals.yml";

function jsonOf(command, args) {
  const out = quiet(command, args);
  if (out === null) return null;
  try {
    return JSON.parse(out);
  } catch {
    return null;
  }
}

// The paid model-eval runs of CI since `since` (lib/steward.mjs, paidCiRuns), each marked `new`
// when no earlier check saw it; null when GitHub cannot be asked. `state` keeps what was seen.
export function paidCi({ phase, since, state }) {
  const runs = jsonOf("gh", [
    "run",
    "list",
    "--workflow",
    WORKFLOW,
    "--limit",
    "30",
    "--json",
    "databaseId,event,headBranch,createdAt,status",
  ]);
  if (!Array.isArray(runs)) return null;
  const recent = runs.filter((run) => !(Date.parse(run.createdAt ?? "") < since));
  state.ciJobs ??= new Map();
  state.seenCi ??= new Set();
  const jobs = new Map();
  for (const run of recent) {
    // The jobs of a finished run do not change any more.
    let listed = state.ciJobs.get(run.databaseId);
    if (!listed) {
      listed = jsonOf("gh", ["run", "view", String(run.databaseId), "--json", "jobs"])?.jobs;
      if (Array.isArray(listed) && run.status === "completed") {
        state.ciJobs.set(run.databaseId, listed);
      }
    }
    jobs.set(run.databaseId, Array.isArray(listed) ? listed : null);
  }
  // The phase branch and the branches of its issue pull requests.
  const heads = jsonOf("gh", [
    "pr",
    "list",
    "--base",
    `phase/${phase}`,
    "--state",
    "all",
    "--limit",
    "200",
    "--json",
    "headRefName",
  ]);
  const branches = [`phase/${phase}`, ...(heads ?? []).map((pr) => pr.headRefName)];
  const paid = paidCiRuns({ runs: recent, jobs, since, branches });
  for (const run of paid.runs) {
    run.new = !state.seenCi.has(run.id);
    state.seenCi.add(run.id);
  }
  return paid;
}

// --- the machine ------------------------------------------------------------------

const GB = 1024 ** 3;

function freeGb(folder) {
  try {
    const stats = fs.statfsSync(folder);
    return Math.round(((stats.bavail * stats.bsize) / GB) * 10) / 10;
  } catch {
    return null;
  }
}

// The machine's 1- and 5-minute load, its cores and the free disk space (GB) of the tightest of
// the checkout's and the system's file systems; null where it cannot be read.
export function machineFacts(mainRoot) {
  const free = [freeGb(mainRoot), freeGb(path.parse(mainRoot).root)].filter((gb) => gb !== null);
  // Windows reports no load average.
  const [load1, load5] = process.platform === "win32" ? [null, null] : os.loadavg();
  const tenth = (value) => (value === null ? null : Math.round(value * 10) / 10);
  return {
    load1: tenth(load1),
    load5: tenth(load5),
    cores: os.availableParallelism(),
    freeDiskGb: free.length ? Math.min(...free) : null,
  };
}

// The full test suites running on the machine now, whoever started them; null when unknown.
export function runningSuites() {
  return fullSuites(parseProcesses(quiet("ps", ["-eo", "pid=,ppid=,etimes=,args="])));
}

// What the loop checks before it starts an iteration, without a model: the hard stops that are
// already there — a reached ceiling, an unexpected paid CI run, a nearly full disk.
export function stopsBeforeIteration({ mainRoot, phase, logDir, state }) {
  const facts = {
    spend: phaseSpend({ mainRoot, phase, logDir }),
    paidCi: paidCi({ phase, since: state.loopStartedAt, state }),
    // Between iterations nothing is cut off, so one low disk reading is enough to stop.
    machine: machineFacts(mainRoot),
  };
  state.freeDiskGb = facts.machine.freeDiskGb;
  return decideStop({ hard: hardStops(facts), report: null });
}

// --- usage ------------------------------------------------------------------------

// What the agents of this iteration used (lib/steward.mjs, usageOf): the orchestrator and each
// subagent it started, with the kind of agent where Claude Code recorded it. `unreadable` counts
// the transcripts that gave nothing; null when not even the orchestrator's can be read.
function usageFacts({ dir, sessionId, main }) {
  const orchestrator = usageOf(main);
  if (!orchestrator) return null;
  const agents = [{ agent: "orchestrator", ...orchestrator }];
  let unreadable = 0;
  const subDir = path.join(dir, sessionId, "subagents");
  let names = [];
  try {
    names = fs.readdirSync(subDir).filter((name) => name.endsWith(".jsonl"));
  } catch {
    // no subagents yet
  }
  for (const name of names.sort()) {
    const usage = usageOf(readLines(path.join(subDir, name)));
    let agent = "agent";
    try {
      const meta = JSON.parse(
        fs.readFileSync(path.join(subDir, name.replace(/\.jsonl$/, ".meta.json")), "utf8"),
      );
      if (typeof meta.agentType === "string") agent = meta.agentType;
    } catch {
      // older Claude Code versions keep no metadata
    }
    if (usage) agents.push({ agent, ...usage });
    else unreadable += 1;
  }
  const total = (field) => agents.reduce((sum, item) => sum + item[field], 0);
  return {
    agents,
    unreadable,
    turns: total("turns"),
    inputTokens: total("inputTokens"),
    outputTokens: total("outputTokens"),
    cacheReadTokens: total("cacheReadTokens"),
    minutes: orchestrator.minutes,
  };
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

function askModel({ mainRoot, phase, facts, findings, triggers, transcript }) {
  const prompt = [
    `Phase: ${phase}. Judge whether this unattended run is healthy and efficient. Follow your agent definition.`,
    `Facts gathered by the harness (null or "unknown" means it could not be measured, never zero):\n${JSON.stringify(facts, null, 2)}`,
    `Findings of the harness's rules:\n${findings.map((f) => `- ${f.level}: ${f.message}`).join("\n") || "- none"}`,
    `Paid for since the last check:\n${triggers.map((t) => `- ${t}`).join("\n") || "- nothing"}`,
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

// One check. `state` carries what earlier checks saw: { lastModelAt, lastModelCodes, lastCheckAt,
// loopStartedAt, seenMerged, seenCi, ciJobs, freeDiskGb }. Returns the verdict; its `stop` is null or why the
// loop must stop ({ by, code, reason }).
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

  const work = currentWork(main ?? []);
  const machine = { ...machineFacts(mainRoot), freeDiskGbBefore: state.freeDiskGb ?? null };
  state.freeDiskGb = machine.freeDiskGb;
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
    work,
    // The folder of the worktree the loop's issue is worked on in, when the orchestrator has
    // created it: a paid run of another campaign there is this loop's doing.
    worktree: work.branch ? worktreeDirName(work.branch) : null,
    progress: phaseProgressNow(phase),
    // Spend and efficiency. The runs listed as recent are those written since the last check.
    spend: phaseSpend({
      mainRoot,
      phase,
      logDir,
      since: state.lastCheckAt ?? iterationStartedAt,
    }),
    paidCi: paidCi({ phase, since: state.loopStartedAt ?? iterationStartedAt, state }),
    usage: usageFacts({ dir, sessionId, main }),
    reviewRounds: main ? (countDispatches(main).reviewer ?? 0) : null,
    machine,
    fullSuites: runningSuites(),
  };
  state.lastCheckAt = now;
  const line = describeWork({
    work: facts.work,
    minutes: facts.iterationMinutes,
    calls: facts.agent.calls,
    context: facts.agent.context,
    progress: facts.progress,
  });
  const findings = assess(facts);
  const hard = hardStops(facts);
  const triggers = modelTriggers(facts);
  const rulesStatus = findings.reduce(
    (worst, f) => (SEVERITY[f.level] > SEVERITY[worst] ? f.level : worst),
    "ok",
  );
  let verdict = {
    status: rulesStatus,
    findings: findings.map((f) => f.message),
    by: "rules",
    line,
  };

  const minutesSinceModel = state.lastModelAt
    ? Math.round((now - state.lastModelAt) / 60_000)
    : null;
  const codes = findings
    .map((f) => f.code)
    .sort()
    .join(",");
  let report = null;
  // A hard stop needs no judgement: the loop stops at once.
  if (
    hard.length === 0 &&
    needsModel({
      findings,
      minutesSinceModel,
      changed: codes !== state.lastModelCodes,
      triggers,
    })
  ) {
    state.lastModelAt = now;
    state.lastModelCodes = codes;
    report = await askModel({
      mainRoot,
      phase,
      facts,
      findings,
      triggers,
      transcript: excerpt(sub ?? main ?? []),
    });
    if (report) {
      // The model may explain or add, but never hides what the rules found.
      const status = SEVERITY[report.status] >= SEVERITY[rulesStatus] ? report.status : rulesStatus;
      verdict = {
        status,
        findings: report.findings.length ? report.findings : verdict.findings,
        by: "model",
        line,
      };
    } else {
      verdict.findings = [...verdict.findings, "the steward model gave no answer"];
    }
  }
  verdict.stop = decideStop({ hard, report });
  if (verdict.stop) {
    verdict.status = "problem";
    if (verdict.stop.by === "model") {
      verdict.findings = [...verdict.findings, `stop: ${verdict.stop.reason}`];
    }
  }

  fs.appendFileSync(
    path.join(logDir, "steward.jsonl"),
    `${JSON.stringify({ at: new Date(now).toISOString(), facts, findings, verdict })}\n`,
  );
  console.log(formatVerdict(verdict));
  return verdict;
}
