#!/usr/bin/env node
// The phase loop: runs the orchestrator unattended, one issue per iteration, until the phase is done.
// Design: .plan/00-overview/harness-prd.md. Decisions: ./lib/loop.mjs.
//
//   node harness/run-phase.mjs <phase-folder> [--base <branch>] [--wait-minutes 10] [--steward-minutes 15]
//                                       [--max-failures 3] [--max-iterations 50] [--no-notify]
//
// It holds no state of its own: what is done is read from GitHub by the orchestrator each time,
// so the loop can be stopped (Ctrl+C) and started again at any point.

import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  FAILED_LABEL,
  RETRY_LABEL,
  RUN_REPORT_SCHEMA,
  classifyRun,
  decideNext,
} from "./lib/loop.mjs";
import { newProblem, notify } from "./lib/notify.mjs";
import { currentWork, workChange } from "./lib/progress.mjs";
import { formatCost, iterationStats } from "./lib/phase-report.mjs";
import { writePhaseReport } from "./phase-report.mjs";
import { checkReadiness } from "./preflight.mjs";
import { readLines, transcriptDir } from "./run-tools.mjs";
import { checkOnce, failedIssues, phaseProgressNow } from "./steward.mjs";
import { mainRootFrom } from "./worktree.mjs";

function parseArgs(argv) {
  const options = {
    base: "master",
    waitMinutes: 10,
    maxFailures: 3,
    maxIterations: 50,
    stewardMinutes: 15,
    notify: true,
    _: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--base") options.base = argv[++i];
    else if (arg === "--wait-minutes") options.waitMinutes = Number(argv[++i]);
    else if (arg === "--max-failures") options.maxFailures = Number(argv[++i]);
    else if (arg === "--max-iterations") options.maxIterations = Number(argv[++i]);
    else if (arg === "--steward-minutes") options.stewardMinutes = Number(argv[++i]);
    else if (arg === "--no-notify") options.notify = false;
    else options._.push(arg);
  }
  options.phase = options._[0];
  return options;
}

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

// A Windows notification for what the owner should see without watching the console.
function alert(options, lines) {
  if (options.notify) notify({ title: `sebela.dev · ${options.phase}`, lines });
}

function prompt({ phase, base }) {
  return `You are running unattended in the phase loop.

Phase: ${phase}
Phase branch: phase/${phase}
Base branch: ${base}

Handle exactly ONE issue, following your agent definition, docs/agents.md and docs/git-workflow.md:

1. Run \`git fetch origin\`. If phase/${phase} does not exist on origin, create it from origin/${base} and push it.
2. Pick the next open issue labelled \`phase:${phase}\` and \`ready-for-agent\` whose blockers are closed. Skip issues labelled \`hitl\` or \`agent-failed\`. An issue labelled \`agent-retry\` failed once before: read its comments first. An issue may also have unfinished work from an interrupted run: if a branch \`*/<issue>-*\` or its worktree exists, continue it rather than starting over.
3. Take it through to an issue pull request against phase/${phase}, reviewed and with green CI, and squash-merge it. Then close the issue, run the docs-keeper and remove the worktree with its branch.
4. If no such issue is left, open the phase pull request from phase/${phase} to ${base} (or update it if it exists) and report phase_done.

Write the report summary in English; it goes to the loop's log.
5. If the issue cannot be finished, comment on the issue with what happened and why, remove the worktree, and report failed. Do not change labels; the loop does that.

Nobody can answer questions in this run. Never wait for input; when something needs the owner, record it on the issue.
Finish with the structured report.`;
}

function runOrchestrator({ mainRoot, phase, base, iteration, sessionId }) {
  const args = [
    "-p",
    prompt({ phase, base }),
    "--agent",
    "orchestrator",
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(RUN_REPORT_SCHEMA),
    // A classifier reviews each call that the allow list does not cover; the deny list and the
    // guard hook still apply. Nothing can be confirmed, so anything it holds back is refused.
    "--permission-mode",
    "auto",
    "--permission-prompts",
    "none",
    // Only the MCP servers agents need: library documentation and a browser for UI checks. The
    // owner's personal servers and claude.ai connectors (mail, calendar, drive) are not loaded.
    // Only the repository's own settings: the owner's ~/.claude (plugins, rules, agents) would make
    // an unattended run depend on whatever is installed on the machine.
    "--setting-sources",
    "project,local",
    "--strict-mcp-config",
    "--mcp-config",
    path.join(mainRoot, "harness", "mcp.json"),
    "--name",
    `loop ${phase} #${iteration}`,
    // A known session id lets the steward find this run's transcript.
    "--session-id",
    sessionId,
  ];
  return new Promise((resolve) => {
    const child = spawn("claude", args, {
      cwd: mainRoot,
      // Subagents must run in the foreground: a print-mode session ends when the orchestrator
      // stops, and a background developer would be cut off.
      env: {
        ...process.env,
        SEBELA_UNATTENDED: "1",
        CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1",
        ENABLE_CLAUDEAI_MCP_SERVERS: "false",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const stop = () => child.kill("SIGINT");
    process.once("SIGINT", stop);
    child.on("close", (exitCode) => {
      process.removeListener("SIGINT", stop);
      resolve({ exitCode, stdout, stderr });
    });
  });
}

function issueLabels(issue) {
  const out = execFileSync(
    "gh",
    ["issue", "view", String(issue), "--json", "labels", "-q", ".labels[].name"],
    {
      encoding: "utf8",
    },
  );
  return out.split("\n").filter(Boolean);
}

function addLabel(issue, label) {
  // An issue that has failed for good is no longer up for a retry.
  const remove = label === FAILED_LABEL ? ["--remove-label", RETRY_LABEL] : [];
  execFileSync("gh", ["issue", "edit", String(issue), "--add-label", label, ...remove], {
    stdio: "ignore",
  });
}

// Ctrl+C ends a wait at once instead of after it.
let wakeUp = () => {};
const sleep = (ms) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    wakeUp = () => {
      clearTimeout(timer);
      resolve();
    };
  });

// Checks the running iteration every few minutes and prints one line; never blocks the loop.
function startSteward({ mainRoot, phase, sessionId, logDir, options, stewardState }) {
  if (!(options.stewardMinutes > 0)) return () => {};
  const iterationStartedAt = Date.now();
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const verdict = await checkOnce({
        mainRoot,
        phase,
        sessionId,
        iterationStartedAt,
        failedAtStart: stewardState.failedAtStart,
        state: stewardState,
        logDir,
      });
      if (newProblem(stewardState.lastStatus, verdict.status)) {
        alert(options, ["[steward] problem", verdict.findings.join("; ")]);
      }
      stewardState.lastStatus = verdict.status;
    } catch (error) {
      log(`steward check failed: ${error.message}`);
    } finally {
      running = false;
    }
  }, options.stewardMinutes * 60_000);
  timer.unref();
  return () => clearInterval(timer);
}

// Every half minute, reads the orchestrator's transcript and prints a line when it picks an issue
// or hands it to another agent.
function startWatcher({ mainRoot, sessionId, iteration }) {
  const file = path.join(transcriptDir(mainRoot), `${sessionId}.jsonl`);
  let previous = { issue: null, branch: null, agent: null };
  const timer = setInterval(() => {
    const work = currentWork(readLines(file) ?? []);
    const change = workChange(previous, work);
    if (change) log(`iteration ${iteration}: ${change}`);
    previous = work;
  }, 30_000);
  timer.unref();
  return () => clearInterval(timer);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.phase) {
    console.error(
      "usage: run-phase.mjs <phase-folder> [--base <branch>] [--wait-minutes N] [--max-failures N] [--no-notify]",
    );
    process.exit(64);
  }
  const mainRoot = mainRootFrom();
  const logDir = path.join(mainRoot, ".worktrees", "logs", options.phase);
  fs.mkdirSync(logDir, { recursive: true });

  let interrupted = false;
  process.on("SIGINT", () => {
    interrupted = true;
    wakeUp();
  });

  // The steward compares with what had already failed when the loop started.
  const stewardState = { failedAtStart: failedIssues(options.phase) };
  let consecutiveFailures = 0;
  let waiting = false;
  for (let iteration = 1; iteration <= options.maxIterations && !interrupted; iteration += 1) {
    // Without Docker, Postgres or gh every agent would fail or improvise; stop and say what to do.
    const readiness = checkReadiness({ mainRoot, base: options.base });
    if (iteration === 1) {
      for (const warning of readiness.warnings) log(`${YELLOW}warning: ${warning}${RESET}`);
    }
    if (readiness.blocking.length > 0) {
      for (const problem of readiness.blocking) log(`${RED}not ready: ${problem}${RESET}`);
      log("fix that and run the same command again to continue.");
      alert(options, ["the loop cannot start an iteration", readiness.blocking.join("; ")]);
      process.exitCode = 1;
      return;
    }
    const progress = phaseProgressNow(options.phase);
    const done = progress ? ` (${progress.closed}/${progress.total} issues closed)` : "";
    log(`iteration ${iteration}: starting the orchestrator for ${options.phase}${done}`);
    const sessionId = randomUUID();
    const stopWatcher = startWatcher({ mainRoot, sessionId, iteration });
    const stopSteward = startSteward({
      mainRoot,
      phase: options.phase,
      sessionId,
      logDir,
      options,
      stewardState,
    });
    const raw = await runOrchestrator({
      mainRoot,
      phase: options.phase,
      base: options.base,
      iteration,
      sessionId,
    });
    stopSteward();
    stopWatcher();
    const run = classifyRun(raw);

    const labels =
      run.kind === "report" && run.outcome === "failed" && run.issue ? issueLabels(run.issue) : [];
    const decision = decideNext({
      run,
      consecutiveFailures,
      issueLabels: labels,
      maxConsecutiveFailures: options.maxFailures,
    });
    consecutiveFailures = decision.consecutiveFailures;

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.writeFileSync(
      path.join(logDir, `${stamp}-${iteration}.json`),
      JSON.stringify({ iteration, run, decision, raw }, null, 2),
    );

    const cost = formatCost(iterationStats({ iteration, run, raw }));
    const spent = cost ? ` (${cost})` : "";
    const what =
      run.kind === "report"
        ? `${run.outcome}${run.issue ? ` #${run.issue}` : ""}${spent}: ${run.summary}`
        : `${run.kind}${spent}`;
    log(`iteration ${iteration}: ${what} -> ${decision.next}`);
    if (run.kind === "crash") log(`  ${run.detail}`);

    if (decision.label) {
      addLabel(run.issue, decision.label);
      log(`  labelled #${run.issue} ${decision.label}`);
    }

    if (decision.next === "done") {
      log("phase done: the phase pull request is open for review.");
      const report = await writePhaseReport({ mainRoot, phase: options.phase }).catch((error) =>
        log(`the phase report failed: ${error.message}`),
      );
      if (report) log(`phase report: ${report}`);
      alert(options, ["phase done", "the phase pull request is open for review"]);
      return;
    }
    if (decision.next === "stop") {
      log(`stopping after ${consecutiveFailures} failed runs in a row. See ${logDir}.`);
      alert(options, ["the loop stopped", `${consecutiveFailures} failed runs in a row`]);
      process.exitCode = 1;
      return;
    }
    if (decision.next === "wait") {
      log(`usage limit reached; waiting ${options.waitMinutes} minutes.`);
      if (!waiting)
        alert(options, ["usage limit reached", "the loop waits and retries on its own"]);
      waiting = true;
      iteration -= 1;
      await sleep(options.waitMinutes * 60_000);
    } else {
      waiting = false;
    }
  }
  if (interrupted) log("interrupted; run the same command again to continue.");
  else {
    log(`reached ${options.maxIterations} iterations; run again to continue.`);
    alert(options, ["the loop stopped", `reached ${options.maxIterations} iterations`]);
  }
}

main();
