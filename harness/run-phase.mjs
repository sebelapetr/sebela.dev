#!/usr/bin/env node
// The phase loop: runs the orchestrator unattended, one issue per iteration, until the phase is done.
// Design: .plan/00-overview/harness-prd.md. Decisions: ./lib/loop.mjs.
//
//   node harness/run-phase.mjs <phase-folder> [--base <branch>] [--wait-minutes 10] [--steward-minutes 5]
//                                       [--max-failures 3] [--max-iterations 50] [--no-notify]
//                                       [--note "<text for the orchestrator>"]
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
  noteAfter,
  ownerNoteSection,
  phaseEnd,
  spendComment,
  stewardStop,
} from "./lib/loop.mjs";
import { newProblem, notify } from "./lib/notify.mjs";
import { currentWork, workChange } from "./lib/progress.mjs";
import { formatCost, iterationStats } from "./lib/phase-report.mjs";
import { spendChange, spendLine } from "./lib/spend.mjs";
import { writePhaseReport } from "./phase-report.mjs";
import { checkReadiness } from "./preflight.mjs";
import { quiet, readLines, transcriptDir } from "./run-tools.mjs";
import {
  checkOnce,
  failedIssues,
  phaseProgressNow,
  phaseSpend,
  stopsBeforeIteration,
} from "./steward.mjs";
import { mainRootFrom } from "./worktree.mjs";

function parseArgs(argv) {
  const options = {
    base: "master",
    waitMinutes: 10,
    maxFailures: 3,
    maxIterations: 50,
    // The steward checks a running iteration this often: an issue, and any paid run in it, is in
    // progress for as long as the iteration runs.
    stewardMinutes: 5,
    notify: true,
    note: null,
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
    else if (arg === "--note") options.note = argv[++i] ?? "";
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

function prompt({ phase, base, note }) {
  return `You are running unattended in the phase loop.

Phase: ${phase}
Phase branch: phase/${phase}
Base branch: ${base}

Handle exactly ONE issue, following your agent definition, docs/agents.md and docs/git-workflow.md:

1. Run \`git fetch origin\`. If phase/${phase} does not exist on origin, create it from origin/${base} and push it.
2. Pick the next open issue labelled \`phase:${phase}\` and \`ready-for-agent\` whose blockers are closed. Skip issues labelled \`hitl\` or \`agent-failed\`. Always read the issue with its comments (\`gh issue view <n> --comments\`): an \`Owner note\` there is binding, and you pass every owner note to the developer and the reviewer as written. An issue labelled \`agent-retry\` failed once before: its comments say why. An issue may also have unfinished work from an interrupted run: if a branch \`*/<issue>-*\` or its worktree exists, continue it rather than starting over.
3. Take it through to an issue pull request against phase/${phase}, reviewed and with green CI, and squash-merge it. Then close the issue, run the docs-keeper and remove the worktree with its branch.
4. If no such issue is left, archive the plan once (docs/git-workflow.md, Phase pull request: \`git mv .plan/${phase} .plan/done/${phase}\` and update the references, on a short-lived branch merged into phase/${phase}; skip it when the folder is already in .plan/done/), then open the phase pull request from phase/${phase} to ${base} as a draft (\`gh pr create --draft\`), or update it if it exists, and report phase_done. If GitHub refuses the pull request (for example because the phase branch has no commits beyond ${base}), still report phase_done and say why in the summary. Never mark it ready for review, close or reopen it, whatever state you find it in: the owner switches it when the phase is complete, HITL issues included, which starts its paid model evals once. The guard refuses those commands.
5. If the issue cannot be finished, comment on the issue with what happened and why, remove the worktree, and report failed. Do not change labels; the loop does that.
6. If the work on the issue stops for a reason outside the issue, keep its worktree and branch, comment on the issue what is done and what remains, and report interrupted with its cause:
   - usage_limit: the usage limit was reached. The loop waits and continues the same issue.
   - safeguard: a model safeguard refused or stopped an agent (a usage-policy or AUP refusal, an invalid_request flagged by the API). The loop retries once at once and stops if it happens again.
   - environment: the machine cannot run the work, such as low disk, a missing tool or credential, or a guard refusal you cannot work around without breaking a rule. The loop stops and tells the owner.
   For every other outcome the cause is null.

Paid model evals: a paid eval command names this phase's campaign and its stage (\`--campaign ${phase} --stage issue\`; the variable SEBELA_EVAL_CAMPAIGN is set to ${phase} in this run) and spends from that campaign's own ceiling only (docs/testing.md, Running paid evals). Pass that to the developer. After a paid run, put the runner's final \`spend:\` line (expected before, actual after, remainder of the phase ceiling) into the issue comment and your report summary. A steward watches spend and efficiency and stops the loop when a ceiling or stop is reached or the work is wasteful: prefer a targeted check or a free \`--regrade\` to a full run, never repeat a paid run with unchanged input, and never run several full test suites at once.

Write the report summary in English; it goes to the loop's log.

Nobody can answer questions in this run. Never wait for input; when something needs the owner, record it on the issue.
Finish with the structured report.${ownerNoteSection(note)}`;
}

// `control.stop` is set to a function that ends the run (the steward's stop).
function runOrchestrator({ mainRoot, phase, base, note, iteration, sessionId, control }) {
  const args = [
    "-p",
    prompt({ phase, base, note }),
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
        // The phase names its eval campaign: a paid eval run in this loop spends from this
        // phase's ceiling or is refused (packages/llm-agent/evals/budget.py).
        SEBELA_EVAL_CAMPAIGN: phase,
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
    control.stop = stop;
    process.once("SIGINT", stop);
    child.on("close", (exitCode) => {
      control.stop = () => {};
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

// The open pull request from the phase branch to the base: { number }, null when there is none,
// undefined when gh fails.
function phasePullRequest(phase, base) {
  const out = quiet("gh", [
    "pr",
    "list",
    "--head",
    `phase/${phase}`,
    "--base",
    base,
    "--state",
    "open",
    "--json",
    "number",
  ]);
  if (out === null) return undefined;
  const [pr] = JSON.parse(out);
  return pr ? { number: pr.number } : null;
}

// The phase's open issues with their label names, or null when gh fails.
function openPhaseIssues(phase) {
  const out = quiet("gh", [
    "issue",
    "list",
    "--label",
    `phase:${phase}`,
    "--state",
    "open",
    "--limit",
    "200",
    "--json",
    "number,labels",
  ]);
  if (out === null) return null;
  return JSON.parse(out).map((issue) => ({
    number: issue.number,
    labels: issue.labels.map((label) => label.name),
  }));
}

// Why the loop stops, for the log and the notification.
function stopMessage(decision, run, consecutiveFailures) {
  const issue = decision.lastSafeguard?.issue ?? run.issue;
  const onIssue = issue ? ` on #${issue}` : "";
  if (decision.reason === "safeguard_repeated") {
    return {
      log: `stopping: a model safeguard stopped the work${onIssue} twice in a row; the worktree and branch are kept.`,
      alert: [`a model safeguard stopped the work${onIssue} twice`, "the loop stopped"],
    };
  }
  if (decision.reason === "environment") {
    return {
      log: `stopping: the environment cannot run the work${onIssue}: ${run.summary}`,
      alert: [`environment problem${onIssue}`, run.summary],
    };
  }
  return {
    log: `stopping after ${consecutiveFailures} failed runs in a row.`,
    alert: ["the loop stopped", `${consecutiveFailures} failed runs in a row`],
  };
}

// A note on the issue, where the next run and the owner find it; a failure to post is only logged.
function commentOnIssue(issue, body) {
  try {
    execFileSync("gh", ["issue", "comment", String(issue), "--body", body], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
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
// When a check says the loop must stop, `onStop` is called once with why.
function startSteward({ mainRoot, phase, sessionId, logDir, options, stewardState, onStop }) {
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
      if (verdict.stop) onStop(verdict.stop);
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
  if (!options.phase || (options.note !== null && !options.note.trim())) {
    console.error(
      'usage: run-phase.mjs <phase-folder> [--base <branch>] [--wait-minutes N] [--steward-minutes N] [--max-failures N] [--no-notify] [--note "<text>"]',
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

  // The steward compares with what had already failed when the loop started, and counts paid CI
  // runs from then on.
  const stewardState = {
    failedAtStart: failedIssues(options.phase),
    loopStartedAt: Date.now(),
  };
  const spendNow = () => phaseSpend({ mainRoot, phase: options.phase, logDir });
  // Ends the loop for a stop by the steward: the log, the notification and a note on the issue.
  const stopForSteward = (stop, issue) => {
    const message = stewardStop({ stop, issue, spend: spendLine(spendNow(), null) });
    log(`${RED}${message.log}${RESET} See ${logDir}.`);
    if (issue && !commentOnIssue(issue, message.comment)) {
      log(`  could not comment on #${issue}`);
    }
    alert(options, message.alert);
    process.exitCode = 1;
  };
  let consecutiveFailures = 0;
  // The safeguard stop of the run before, if any; a second one on the same issue stops the loop.
  let lastSafeguard = null;
  let waiting = false;
  // The owner's note goes to the orchestrator until the first run that finished.
  let note = options.note;
  if (note) log(`owner note for the first run: ${note.trim()}`);
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
    // A hard stop that is already there — the eval ceiling reached, an unexpected paid CI run, a
    // nearly full disk — stops the loop before an agent is started for nothing.
    if (options.stewardMinutes > 0) {
      const stop = stopsBeforeIteration({
        mainRoot,
        phase: options.phase,
        logDir,
        state: stewardState,
      });
      if (stop) {
        stopForSteward(stop, null);
        return;
      }
    }
    const spendBefore = spendNow();
    if (iteration === 1) log(spendLine(spendBefore, null));
    const progress = phaseProgressNow(options.phase);
    const done = progress ? ` (${progress.closed}/${progress.total} issues closed)` : "";
    log(`iteration ${iteration}: starting the orchestrator for ${options.phase}${done}`);
    const sessionId = randomUUID();
    const stopWatcher = startWatcher({ mainRoot, sessionId, iteration });
    const control = { stop: () => {} };
    let stewardStopped = null;
    const stopSteward = startSteward({
      mainRoot,
      phase: options.phase,
      sessionId,
      logDir,
      options,
      stewardState,
      onStop: (stop) => {
        if (stewardStopped) return;
        stewardStopped = stop;
        control.stop();
      },
    });
    const raw = await runOrchestrator({
      mainRoot,
      phase: options.phase,
      base: options.base,
      note,
      iteration,
      sessionId,
      control,
    });
    stopSteward();
    stopWatcher();
    const run = classifyRun(raw);

    // The spend line of every iteration: expected before, actual after, what is left of the
    // phase ceiling. It goes to the log, the iteration's record and, after a paid run, the issue.
    const spendAfter = spendNow();
    const paid = spendChange(spendBefore, spendAfter);
    const spend = { line: spendLine(spendAfter, paid), paid: paid !== null, summary: spendAfter };
    const transcript = readLines(path.join(transcriptDir(mainRoot), `${sessionId}.jsonl`)) ?? [];
    const workedOn = (run.kind === "report" ? run.issue : null) ?? currentWork(transcript).issue;

    if (stewardStopped) {
      // The run was ended from outside: it says nothing about the issue, so nothing is labelled.
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      fs.writeFileSync(
        path.join(logDir, `${stamp}-${iteration}.json`),
        JSON.stringify(
          {
            iteration,
            run,
            decision: { next: "stop", reason: "steward" },
            stewardStopped,
            spend,
            raw,
          },
          null,
          2,
        ),
      );
      log(`iteration ${iteration}: ${spend.line}`);
      stopForSteward(stewardStopped, workedOn);
      return;
    }

    const labels =
      run.kind === "report" && run.outcome === "failed" && run.issue ? issueLabels(run.issue) : [];
    const decision = decideNext({
      run,
      consecutiveFailures,
      lastSafeguard,
      issueLabels: labels,
      maxConsecutiveFailures: options.maxFailures,
    });
    consecutiveFailures = decision.consecutiveFailures;
    lastSafeguard = decision.lastSafeguard;
    note = noteAfter(note, decision.next);

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.writeFileSync(
      path.join(logDir, `${stamp}-${iteration}.json`),
      JSON.stringify({ iteration, run, decision, spend, raw }, null, 2),
    );

    const cost = formatCost(iterationStats({ iteration, run, raw }));
    const spent = cost ? ` (${cost})` : "";
    const what =
      run.kind === "report"
        ? `${run.outcome}${run.cause ? ` (${run.cause})` : ""}${run.issue ? ` #${run.issue}` : ""}${spent}: ${run.summary}`
        : `${run.kind}${spent}`;
    log(`iteration ${iteration}: ${what} -> ${decision.next}`);
    log(`iteration ${iteration}: ${spend.line}`);
    if (run.kind === "crash") log(`  ${run.detail}`);
    const spendNote = spendComment({ line: spend.line, paid: spend.paid, iteration });
    if (spendNote && workedOn && !commentOnIssue(workedOn, spendNote)) {
      log(`  could not comment the spend line on #${workedOn}`);
    }

    if (decision.label) {
      addLabel(run.issue, decision.label);
      log(`  labelled #${run.issue} ${decision.label}`);
    }

    if (decision.next === "done") {
      // The report says the phase is done; GitHub says whether a pull request exists and what is left.
      const end = phaseEnd({
        pullRequest: phasePullRequest(options.phase, options.base),
        openIssues: openPhaseIssues(options.phase),
      });
      for (const line of end.log) log(line);
      const report = await writePhaseReport({ mainRoot, phase: options.phase }).catch((error) =>
        log(`the phase report failed: ${error.message}`),
      );
      if (report) log(`phase report: ${report}`);
      alert(options, end.alert);
      return;
    }
    if (decision.next === "stop") {
      const message = stopMessage(decision, run, consecutiveFailures);
      log(`${message.log} See ${logDir}.`);
      alert(options, message.alert);
      process.exitCode = 1;
      return;
    }
    if (decision.reason === "safeguard") {
      log("a model safeguard stopped the run; retrying once at once.");
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
