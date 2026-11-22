#!/usr/bin/env node
// The phase loop: runs the orchestrator unattended, one issue per iteration, until the phase is done.
// Design: .plan/00-overview/harness-prd.md. Decisions: ./lib/loop.mjs.
//
//   node harness/run-phase.mjs <phase-folder> [--base <branch>] [--wait-minutes 10] [--steward-minutes 5]
//                                       [--max-failures 3] [--max-iterations 50] [--no-notify]
//                                       [--note "<text for the orchestrator>"]
//
// It holds no state of its own: what is done and what is next is read from GitHub each time — the
// phase's tracking issue, its sub-issues in order and their native blockers (phase-work.mjs) — so
// the loop can be stopped (Ctrl+C) and started again at any point.

import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  FAILED_LABEL,
  RETRY_LABEL,
  RUN_REPORT_SCHEMA,
  classifyRun,
  decideNext,
  descendantsOf,
  noteAfter,
  ownerNoteSection,
  phaseEnd,
  phaseNotStarted,
  spendComment,
  stewardStop,
} from "./lib/loop.mjs";
import { newProblem, notify } from "./lib/notify.mjs";
import { currentWork, workChange } from "./lib/progress.mjs";
import { formatCost, iterationStats } from "./lib/phase-report.mjs";
import { PhaseWorkError } from "./lib/selection.mjs";
import { spendChange, spendLine } from "./lib/spend.mjs";
import { writePhaseReport } from "./phase-report.mjs";
import { phaseWorkOrNull } from "./phase-work.mjs";
import { checkReadiness } from "./preflight.mjs";
import { quiet, readLines, transcriptDir } from "./run-tools.mjs";
import {
  checkOnce,
  failedIssues,
  keptRunsFile,
  phaseSpend,
  phaseWorkNow,
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
    // After a stop the orchestrator's run gets an interrupt, then after this long a terminate
    // and after as long again a kill.
    stopGraceSeconds: 30,
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
    else if (arg === "--stop-grace-seconds") options.stopGraceSeconds = Number(argv[++i]);
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

// `command` is the work selection's program by the absolute path of the checkout the loop runs
// from: an agent whose shell sits in a worktree cut before that program existed still finds it.
function prompt({ phase, base, note, command }) {
  return `You are running unattended in the phase loop.

Phase: ${phase}
Phase branch: phase/${phase}
Base branch: ${base}

Handle exactly ONE issue, following your agent definition, docs/agents.md and docs/git-workflow.md:

1. Run \`git fetch origin\`. If phase/${phase} does not exist on origin, create it from origin/${base} and push it — but only once step 2 has said \`status: next\`, \`finished\` or \`waiting\`: do step 2 first.
2. Ask which issue is next: \`node ${command} next ${phase}\` (the same file as \`node harness/phase-work.mjs\` in the main checkout; use this path, so the command is found wherever your shell is). It reads the phase's tracking issue on GitHub and always prints a line \`status: <status>\`. Act on that line only:
   - \`status: next\`: the line \`next: #<n> <title>\` names the issue — the first open sub-issue, in sub-issue order, that is labelled \`ready-for-agent\`, is not labelled \`hitl\` or \`agent-failed\`, has no sub-issues of its own and whose native blockers are all closed. Take exactly that issue, with step 3.
   - \`status: finished\` (every sub-issue is closed) or \`status: waiting\` (the open sub-issues wait for a human, are blocked, failed or not released): go to step 4.
   - \`status: phase-waits\` or \`status: empty\`, no \`status:\` line at all, an empty answer or a failing command: the phase must not be worked on or ended. Change nothing — no branch, no archive, no pull request — and report interrupted with cause environment and what the command printed.
   Never choose an issue yourself by a label, by issue number or from a \`## Blocked by\` text, and never take an issue the command lists as blocked, waiting for a human, agent-failed or not ready. Always read the named issue with its comments (\`gh issue view <n> --comments\`): an \`Owner note\` there is binding, and you pass every owner note to the developer and the reviewer as written. If the issue's text (its \`## When\` section) or an owner note says the issue must still wait — for a merge, a date, a decision — do not start it and do not take a different issue instead: comment on the issue what it waits for and report interrupted with cause environment, so the owner decides. An issue labelled \`agent-retry\` failed once before: its comments say why. An issue may also have unfinished work from an interrupted run: if a branch \`*/<issue>-*\` or its worktree exists, continue it rather than starting over.
3. Take it through to an issue pull request against phase/${phase}, reviewed and with green CI, and squash-merge it. Then close the issue, run the docs-keeper and remove the worktree with its branch.
4. The phase end, only after \`status: finished\` or \`status: waiting\`: archive the plan once (docs/git-workflow.md, Phase pull request: \`git mv .plan/${phase} .plan/done/${phase}\` and update the references, on a short-lived branch merged into phase/${phase}; skip it when the folder is already in .plan/done/), then open the phase pull request from phase/${phase} to ${base} as a draft (\`gh pr create --draft\`), or update it if it exists, and report phase_done. If GitHub refuses the pull request (for example because the phase branch has no commits beyond ${base}), still report phase_done and say why in the summary. Never mark it ready for review, close or reopen it, whatever state you find it in: the owner switches it when the phase is complete, HITL issues included, which starts its paid model evals once. The guard refuses those commands.
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

// Everything a run has started and how to signal it. Claude Code's Bash tool starts each command
// in a session and process group of its own, so a signal to the orchestrator's process group
// misses an agent's command — a paid eval among them — and once the orchestrator is gone its
// children no longer hang below it. The run is therefore followed through the parents of the
// process list: every process found below the orchestrator is remembered, with its process
// group, and looked for again at every signal.
function runProcesses(child) {
  const known = new Map([[child.pid, child.pid]]);
  let ownGroup = null;
  const refresh = () => {
    const out = quiet("ps", ["-eo", "pid=,ppid=,pgid="]);
    if (out === null) return;
    const processes = out
      .split("\n")
      .map((line) => line.trim().split(/\s+/).map(Number))
      .filter((row) => row.length === 3 && row.every(Number.isInteger))
      .map(([pid, ppid, pgid]) => ({ pid, ppid, pgid }));
    ownGroup = processes.find((row) => row.pid === process.pid)?.pgid ?? ownGroup;
    for (const pid of [...known.keys()]) {
      for (const found of descendantsOf(processes, pid)) known.set(found.pid, found.pgid);
    }
  };
  const send = (target, signal) => {
    try {
      process.kill(target, signal);
      return true;
    } catch {
      return false;
    }
  };
  return {
    // Signals every process of the run and every process group it has, never the loop's own.
    signal(signal) {
      refresh();
      const groups = new Set([...known.values()].filter((pgid) => pgid !== ownGroup));
      for (const pgid of groups) send(-pgid, signal);
      // A process still in the loop's own group is signalled by itself.
      for (const [pid, pgid] of known) if (pgid === ownGroup) send(pid, signal);
    },
    // Whether anything of the run is still there.
    alive() {
      return [...known.keys()].some((pid) => send(pid, 0));
    },
  };
}

// `control.stop` is set to a function that ends the run (the steward's stop): an interrupt, then
// a terminate after `graceMs` and a kill after as long again, each to every process the run has
// started (runProcesses), until none of them is left. Ctrl+C in the loop's terminal takes the
// same path, and a second Ctrl+C kills at once. One interrupt alone can be ignored or lost, and a command
// the orchestrator started must not go on spending after the loop has stopped.
function runOrchestrator({
  mainRoot,
  phase,
  base,
  note,
  iteration,
  sessionId,
  control,
  logDir,
  graceMs,
}) {
  const args = [
    "-p",
    prompt({ phase, base, note, command: path.join(mainRoot, "harness", "phase-work.mjs") }),
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
        // The loop's record of the paid runs of every checkout: the runner adds the other
        // worktrees' runs to its own ledger, so the cumulative stops hold across them.
        SEBELA_EVAL_KEPT_RUNS: keptRunsFile(logDir),
        CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1",
        ENABLE_CLAUDEAI_MCP_SERVERS: "false",
      },
      stdio: ["ignore", "pipe", "pipe"],
      // Its own process group, so signals meant for the run never hit the loop. Ctrl+C in the
      // loop's terminal no longer reaches it by itself; the loop passes it on below.
      detached: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const run = runProcesses(child);
    const timers = [];
    let ending = null;
    // Resolves when nothing the run started is left.
    const end = () => {
      ending ??= new Promise((done) => {
        run.signal("SIGINT");
        const finish = () => {
          for (const timer of timers) clearTimeout(timer);
          clearInterval(watch);
          done();
        };
        timers.push(setTimeout(() => run.signal("SIGTERM"), graceMs));
        timers.push(setTimeout(() => run.signal("SIGKILL"), 2 * graceMs));
        // A last look after the kill, so the loop never waits for ever.
        timers.push(setTimeout(finish, 2 * graceMs + 2_000));
        const watch = setInterval(() => {
          if (!run.alive()) finish();
        }, 200);
      });
      return ending;
    };
    control.stop = end;
    // The run has its own process group, so Ctrl+C reaches it only through the loop: the first
    // one ends it as a stop does, a further one kills what is left at once.
    let interrupts = 0;
    const interrupt = () => {
      interrupts += 1;
      if (interrupts === 1) end();
      else run.signal("SIGKILL");
    };
    // The loop being ended from outside ends the run with it.
    const leave = () => {
      run.signal("SIGTERM");
      process.exit(143);
    };
    process.on("SIGINT", interrupt);
    process.once("SIGTERM", leave);
    process.once("SIGHUP", leave);
    child.on("close", async (exitCode) => {
      control.stop = () => ending ?? Promise.resolve();
      process.removeListener("SIGINT", interrupt);
      process.removeListener("SIGTERM", leave);
      process.removeListener("SIGHUP", leave);
      // After a stop, what the orchestrator had started is ended before the loop goes on.
      if (ending) await ending;
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
      'usage: run-phase.mjs <phase-folder> [--base <branch>] [--wait-minutes N] [--steward-minutes N] [--stop-grace-seconds N] [--max-failures N] [--no-notify] [--note "<text>"]',
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
  // What must not reach an issue comment or a notification: where the checkout lives, the home
  // folder and the machine's name (docs/permissions.md, Private infrastructure details).
  const hidden = { mainRoot, home: os.homedir(), host: os.hostname() };
  const stopForSteward = (stop, issue) => {
    const message = stewardStop({
      stop,
      issue,
      spend: spendLine(spendNow(), null),
      private: hidden,
    });
    log(`${RED}${message.log}${RESET} See ${path.relative(mainRoot, logDir)}.`);
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
    // The phase's issues are read from its tracking issue on GitHub, every time. A folder that
    // no tracking issue names, or that several name, cannot be worked on: stop before an agent
    // guesses. GitHub not answering is only said; the orchestrator asks again itself.
    let work;
    try {
      work = phaseWorkOrNull(options.phase);
    } catch (error) {
      if (!(error instanceof PhaseWorkError)) throw error;
      log(`${RED}not ready: ${error.message}${RESET}`);
      alert(options, ["the loop cannot start an iteration", error.message]);
      process.exitCode = 1;
      return;
    }
    if (!work) log(`${YELLOW}warning: could not read the phase's issues from GitHub${RESET}`);
    // A phase that has not started is not given to an agent, which would cut its branch and end
    // it: one whose tracking issue waits for another phase, and one without any issue.
    const notStarted = phaseNotStarted(work);
    if (notStarted) {
      log(`${RED}not ready: ${notStarted}${RESET}`);
      alert(options, ["the loop cannot start an iteration", notStarted]);
      process.exitCode = 1;
      return;
    }
    const progress = work?.progress;
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
      logDir,
      graceMs: options.stopGraceSeconds * 1000,
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
    const spendNote = spendComment({
      line: spend.line,
      paid: spend.paid,
      iteration,
      private: hidden,
    });
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
        work: phaseWorkNow(options.phase),
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
