#!/usr/bin/env node
// The phase loop: runs the orchestrator unattended, one issue per iteration, until the phase is done.
// Design: .plan/00-overview/harness-prd.md. Decisions: ./lib/loop.mjs.
//
//   node scripts/harness/run-phase.mjs <phase-folder> [--base <branch>] [--wait-minutes 10]
//                                       [--max-failures 3] [--max-iterations 50]
//
// It holds no state of its own: what is done is read from GitHub by the orchestrator each time,
// so the loop can be stopped (Ctrl+C) and started again at any point.

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { FAILED_LABEL, RETRY_LABEL, RUN_REPORT_SCHEMA, classifyRun, decideNext } from "./lib/loop.mjs";
import { mainRootFrom } from "./worktree.mjs";

function parseArgs(argv) {
  const options = { base: "master", waitMinutes: 10, maxFailures: 3, maxIterations: 50, _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--base") options.base = argv[++i];
    else if (arg === "--wait-minutes") options.waitMinutes = Number(argv[++i]);
    else if (arg === "--max-failures") options.maxFailures = Number(argv[++i]);
    else if (arg === "--max-iterations") options.maxIterations = Number(argv[++i]);
    else options._.push(arg);
  }
  options.phase = options._[0];
  return options;
}

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function prompt({ phase, base }) {
  return `You are running unattended in the phase loop.

Phase: ${phase}
Phase branch: phase/${phase}
Base branch: ${base}

Handle exactly ONE issue, following your agent definition, docs/agents.md and docs/git-workflow.md:

1. Run \`git fetch origin\`. If phase/${phase} does not exist on origin, create it from origin/${base} and push it.
2. Pick the next open issue labelled \`phase:${phase}\` and \`ready-for-agent\` whose blockers are closed. Skip issues labelled \`hitl\` or \`agent-failed\`. An issue labelled \`agent-retry\` failed once before: read its comments first.
3. Take it through to an issue pull request against phase/${phase}, reviewed and with green CI, and squash-merge it. Then close the issue, run the docs-keeper and remove the worktree with its branch.
4. If no such issue is left, open the phase pull request from phase/${phase} to ${base} (or update it if it exists) and report phase_done.

Write the report summary in English; it goes to the loop's log.
5. If the issue cannot be finished, comment on the issue with what happened and why, remove the worktree, and report failed. Do not change labels; the loop does that.

Nobody can answer questions in this run. Never wait for input; when something needs the owner, record it on the issue.
Finish with the structured report.`;
}

function runOrchestrator({ mainRoot, phase, base, iteration }) {
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
    "--name",
    `loop ${phase} #${iteration}`,
  ];
  return new Promise((resolve) => {
    const child = spawn("claude", args, {
      cwd: mainRoot,
      // Subagents must run in the foreground: a print-mode session ends when the orchestrator
      // stops, and a background developer would be cut off.
      env: { ...process.env, SEBELA_UNATTENDED: "1", CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1" },
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
  const out = execFileSync("gh", ["issue", "view", String(issue), "--json", "labels", "-q", ".labels[].name"], {
    encoding: "utf8",
  });
  return out.split("\n").filter(Boolean);
}

function addLabel(issue, label) {
  // An issue that has failed for good is no longer up for a retry.
  const remove = label === FAILED_LABEL ? ["--remove-label", RETRY_LABEL] : [];
  execFileSync("gh", ["issue", "edit", String(issue), "--add-label", label, ...remove], { stdio: "ignore" });
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

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.phase) {
    console.error("usage: run-phase.mjs <phase-folder> [--base <branch>] [--wait-minutes N] [--max-failures N]");
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

  let consecutiveFailures = 0;
  for (let iteration = 1; iteration <= options.maxIterations && !interrupted; iteration += 1) {
    log(`iteration ${iteration}: starting the orchestrator for ${options.phase}`);
    const raw = await runOrchestrator({ mainRoot, phase: options.phase, base: options.base, iteration });
    const run = classifyRun(raw);

    const labels = run.kind === "report" && run.outcome === "failed" && run.issue ? issueLabels(run.issue) : [];
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

    const what = run.kind === "report" ? `${run.outcome}${run.issue ? ` #${run.issue}` : ""}: ${run.summary}` : run.kind;
    log(`iteration ${iteration}: ${what} -> ${decision.next}`);
    if (run.kind === "crash") log(`  ${run.detail}`);

    if (decision.label) {
      addLabel(run.issue, decision.label);
      log(`  labelled #${run.issue} ${decision.label}`);
    }

    if (decision.next === "done") {
      log("phase done: the phase pull request is open for review.");
      return;
    }
    if (decision.next === "stop") {
      log(`stopping after ${consecutiveFailures} failed runs in a row. See ${logDir}.`);
      process.exitCode = 1;
      return;
    }
    if (decision.next === "wait") {
      log(`usage limit reached; waiting ${options.waitMinutes} minutes.`);
      iteration -= 1;
      await sleep(options.waitMinutes * 60_000);
    }
  }
  if (interrupted) log("interrupted; run the same command again to continue.");
  else log(`reached ${options.maxIterations} iterations; run again to continue.`);
}

main();
