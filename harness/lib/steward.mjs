// The steward's rules: it reads what the running phase loop leaves behind and says whether the run
// looks healthy, what it spends and whether it works efficiently. Pure — the caller gathers the
// facts (harness/steward.mjs) and acts on the result (harness/run-phase.mjs). The rules report
// (`assess`) and name the hard stops (`hardStops`): a reached or projected eval ceiling, a run
// past the per-run stop, an unexpected paid CI run and a nearly full disk stop the loop whatever
// a model thinks. The model adds the efficiency judgement and may stop the loop too
// (`decideStop`). Intent: docs/agents.md, "The steward".

export const LIMITS = Object.freeze({
  iterationWarnMinutes: 45,
  iterationProblemMinutes: 90,
  idleWarnMinutes: 15,
  idleProblemMinutes: 30,
  callsWarn: 250,
  refusalRepeats: 3,
  modelEveryMinutes: 60,
  // The same findings are put to the model again after this long, new ones at once.
  modelRepeatMinutes: 15,
  // Spend of the phase's eval campaign from this share of its ceiling on is a warning.
  spendWarnShare: 0.8,
  // Free disk space (GB) below which the loop stops, and below which the steward warns.
  diskStopGb: 2,
  diskWarnGb: 5,
  // The 1-minute load average per core from which the machine counts as overloaded.
  loadWarnPerCore: 2,
  // Full test suites running at once, and review rounds on one issue, that are a warning.
  fullSuitesWarn: 2,
  reviewRoundsWarn: 3,
});

// What the model returns when it is asked.
export const STEWARD_REPORT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["status", "findings"],
  properties: {
    status: { type: "string", enum: ["ok", "warn", "problem"] },
    findings: { type: "array", items: { type: "string" } },
    // The model stops the loop only for inefficient work it can name (docs/agents.md).
    stop: { type: "boolean" },
    stopReason: { type: "string" },
  },
};

const REFUSED = /hook error|has been denied|permission .*denied|was denied/i;

function textOf(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => part?.text ?? "").join(" ");
  return "";
}

// Summarises the lines of one session transcript (JSONL).
//   calls        model responses so far
//   context      tokens in the context at the latest response
//   idleMinutes  minutes since the latest entry, null when there is none
//   task         the first prompt, shortened
//   refusals     refused commands within the window, with how often each was refused
export function summarizeTranscript(lines, { now = Date.now(), windowMinutes = 15 } = {}) {
  let calls = 0;
  let context = 0;
  let last = null;
  let task = null;
  const commands = new Map();
  const refused = new Map();
  const since = now - windowMinutes * 60_000;

  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const time = Date.parse(entry?.timestamp ?? "");
    if (Number.isFinite(time)) last = Math.max(last ?? time, time);
    const content = entry?.message?.content;
    if (task === null && entry?.type === "user" && typeof content === "string")
      task = content.slice(0, 160);

    const usage = entry?.message?.usage;
    if (entry?.type === "assistant" && usage) {
      calls += 1;
      context =
        (usage.input_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0) +
        (usage.cache_creation_input_tokens ?? 0);
    }
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part?.type === "tool_use") {
        commands.set(part.id, String(part.input?.command ?? part.input?.file_path ?? part.name));
      } else if (
        part?.type === "tool_result" &&
        part.is_error &&
        REFUSED.test(textOf(part.content))
      ) {
        if (!Number.isFinite(time) || time < since) continue;
        const command = commands.get(part.tool_use_id) ?? "unknown";
        refused.set(command, (refused.get(command) ?? 0) + 1);
      }
    }
  }

  return {
    calls,
    context,
    idleMinutes: last === null ? null : Math.max(0, Math.round((now - last) / 60_000)),
    task,
    refusals: [...refused].map(([command, count]) => ({ command, count })),
  };
}

// What one session's transcript (JSONL lines) says the agent used: turns (model responses, each
// counted once however many lines it was written in), tokens and wall time in minutes from the
// first to the last entry. Null when the transcript cannot be read or holds no response:
// unknown, not zero.
export function usageOf(lines) {
  if (!lines) return null;
  const seen = new Set();
  let turns = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let first = null;
  let last = null;
  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const time = Date.parse(entry?.timestamp ?? "");
    if (Number.isFinite(time)) {
      first = Math.min(first ?? time, time);
      last = Math.max(last ?? time, time);
    }
    const usage = entry?.message?.usage;
    if (entry?.type !== "assistant" || !usage) continue;
    const id = entry.message.id;
    if (id !== undefined && seen.has(id)) continue;
    if (id !== undefined) seen.add(id);
    turns += 1;
    inputTokens += (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
    outputTokens += usage.output_tokens ?? 0;
    cacheReadTokens += usage.cache_read_input_tokens ?? 0;
  }
  if (turns === 0) return null;
  return {
    turns,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    minutes: Math.round((last - first) / 60_000),
  };
}

// `ps -eo pid=,ppid=,etimes=,args=` → [{ pid, ppid, seconds, command }]; null when there is no
// output to read.
export function parseProcesses(text) {
  if (typeof text !== "string") return null;
  const processes = [];
  for (const line of text.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!match) continue;
    processes.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      seconds: Number(match[3]),
      command: match[4],
    });
  }
  return processes;
}

// A whole suite, as opposed to a targeted check: the workspace's tests, what CI runs for a
// change, the browser tests and the stack checks, started without a package filter.
const PNPM_SUITE =
  /(?:^|[\s/])pnpm(?:\.c?js)?\s+(?:run\s+)?(test|ci:affected|test:e2e|test:web-stack|test:api-stack|test:production-stack)(?=\s|$)/;
const TURBO_SUITE = /(?:^|[\s/])turbo(?:\.js)?\s+run\s+(?:\S+\s+)*?test(?=\s|$)/;
const PLAYWRIGHT_SUITE = /(?:^|[\s/])playwright(?:\.js)?\s+test(?=\s|$)/;
const FILTERED = /(?:^|\s)(?:--filter|-F)(?:[=\s]|$)/;
// Programs that only mention a suite in their arguments.
const MENTIONS_ONLY = /^(?:\S*\/)?(?:grep|rg|sed|cat|echo|git|gh|tail|head|less)\s/;

function suiteKind(command) {
  if (MENTIONS_ONLY.test(command) || FILTERED.test(command)) return null;
  const pnpm = PNPM_SUITE.exec(command);
  if (pnpm) return `pnpm ${pnpm[1]}`;
  if (TURBO_SUITE.test(command)) return "turbo run test";
  if (PLAYWRIGHT_SUITE.test(command)) return "playwright test";
  return null;
}

// The full test suites running now, from parseProcesses: each counted once at the process that
// started it, not again for what it runs. Null when the processes are unknown.
export function fullSuites(processes) {
  if (!processes) return null;
  const byPid = new Map(processes.map((process) => [process.pid, process]));
  const kinds = new Map();
  for (const process of processes) {
    const kind = suiteKind(process.command);
    if (kind) kinds.set(process.pid, kind);
  }
  const startedBySuite = (process) => {
    const visited = new Set();
    let parent = byPid.get(process.ppid);
    while (parent && !visited.has(parent.pid)) {
      if (kinds.has(parent.pid)) return true;
      visited.add(parent.pid);
      parent = byPid.get(parent.ppid);
    }
    return false;
  };
  return processes
    .filter((process) => kinds.has(process.pid) && !startedBySuite(process))
    .map((process) => ({
      pid: process.pid,
      kind: kinds.get(process.pid),
      minutes: Math.round(process.seconds / 60),
    }));
}

const EVAL_JOB = /model evals$/;

// The paid model-eval runs of CI since `since` (ms): runs of the workflow `model-evals.yml` in
// which an eval job actually ran — under way, or finished other than skipped. A run whose eval
// jobs were all skipped cost nothing and is left out.
//   runs      from `gh run list --workflow model-evals.yml --json databaseId,event,headBranch,createdAt`
//   jobs      Map of run id → its jobs ([{ name, status, conclusion }]), null when they could not be read
//   branches  the phase branch and the branches of its issue pull requests
// A run is `unexpected` when a pull request of this phase started it: the loop keeps the phase
// pull request a draft and issue pull requests never run paid evals, so nothing in an unattended
// run should start one. A run started by hand (`workflow_dispatch`) is the owner's and is only
// reported. Returns { runs: [{ id, event, branch, createdAt, jobs, unexpected }], unknown: [id] }.
export function paidCiRuns({ runs, jobs, since, branches }) {
  const paid = [];
  const unknown = [];
  for (const run of runs) {
    const created = Date.parse(run.createdAt ?? "");
    if (Number.isFinite(created) && created < since) continue;
    const listed = jobs.get(run.databaseId);
    if (!listed) {
      unknown.push(run.databaseId);
      continue;
    }
    const ran = listed
      .filter((job) => EVAL_JOB.test(job.name ?? ""))
      .filter(
        (job) =>
          job.status === "in_progress" ||
          (job.status === "completed" && job.conclusion !== "skipped"),
      )
      .map((job) => job.name);
    if (ran.length === 0) continue;
    paid.push({
      id: run.databaseId,
      event: run.event,
      branch: run.headBranch,
      createdAt: run.createdAt,
      jobs: ran,
      unexpected: run.event === "pull_request" && branches.includes(run.headBranch),
    });
  }
  return { runs: paid, unknown };
}

const money = (value) => `${value.toFixed(4)} USD`;
const EPSILON = 1e-9;

// Why the loop must stop now, from the facts alone — no model is asked. Each is { code, reason }.
// Only what is known can stop the loop; what could not be measured is reported by `assess`.
export function hardStops(facts, limits = LIMITS) {
  const stops = [];
  const spend = facts.spend;
  if (spend && spend.ceilingUsd !== null && spend.spentUsd !== null) {
    const ceiling = `${spend.ceilingUsd.toFixed(2)} USD ceiling of the ${spend.campaign} eval campaign`;
    if (spend.spentUsd >= spend.ceilingUsd - EPSILON) {
      stops.push({
        code: "ceiling",
        reason: `the ${ceiling} is reached (${money(spend.spentUsd)} spent); its coverage stays pending until the owner grants more`,
      });
    } else if (spend.projectedUsd !== null && spend.projectedUsd > spend.ceilingUsd + EPSILON) {
      stops.push({
        code: "ceiling-projected",
        reason: `the paid eval run under way is projected to ${money(spend.projectedUsd)}, past the ${ceiling} (${money(spend.spentUsd)} spent)`,
      });
    }
  }
  if (spend && spend.runStopUsd !== null) {
    for (const run of spend.recent ?? []) {
      if (run.stage === "issue" && run.spentUsd > spend.runStopUsd + EPSILON) {
        stops.push({
          code: "run-stop",
          reason: `the issue eval run ${run.run} in ${run.source} spent ${money(run.spentUsd)}, past the ${spend.runStopUsd.toFixed(2)} USD per-run stop`,
        });
      }
    }
  }
  for (const run of facts.paidCi?.runs ?? []) {
    if (run.unexpected) {
      stops.push({
        code: "paid-ci",
        reason: `an unexpected paid CI eval run started on ${run.branch} (run ${run.id}: ${run.jobs.join(", ")}); the loop starts none, so check who made the pull request ready`,
      });
    }
  }
  const free = facts.machine?.freeDiskGb;
  if (typeof free === "number" && free < limits.diskStopGb) {
    stops.push({
      code: "disk",
      reason: `only ${free.toFixed(1)} GB of disk space are free, below the ${limits.diskStopGb} GB the loop needs`,
    });
  }
  return stops;
}

// What is worth the model's judgement without being a warning: a paid run that was just made,
// locally or in CI. Whether it repeated one with unchanged input, or ran the whole catalogue
// where a targeted check or a free regrade would do, is for the model to say.
export function modelTriggers(facts) {
  const triggers = [];
  for (const run of facts.spend?.recent ?? []) {
    const expected = run.expectedUsd == null ? "unknown" : money(run.expectedUsd);
    triggers.push(
      `paid eval run ${run.run} in ${run.source} (${run.stage ?? "unknown stage"}, ${run.scope ?? "unknown scope"}): expected ${expected}, spent ${money(run.spentUsd)}`,
    );
  }
  for (const run of facts.paidCi?.runs ?? []) {
    if (run.new && !run.unexpected) {
      triggers.push(
        `paid CI eval run ${run.id} on ${run.branch}, started by ${run.event} (${run.jobs.join(", ")})`,
      );
    }
  }
  return triggers;
}

// Whether the loop stops after this check: a hard stop always, otherwise the model's stop when
// it names its reason. Returns { by: "rules" | "model", code, reason } or null.
export function decideStop({ hard, report }) {
  if (hard.length > 0) {
    return {
      by: "rules",
      code: hard[0].code,
      reason: hard.map((stop) => stop.reason).join("; "),
    };
  }
  const reason = typeof report?.stopReason === "string" ? report.stopReason.trim() : "";
  if (report?.stop === true && reason) return { by: "model", code: "efficiency", reason };
  return null;
}

const finding = (level, code, message) => ({ level, code, message });

// The spend and efficiency findings. A hard stop is also a problem here, so the line shows it.
function assessEfficiency(facts, limits) {
  const findings = [];
  for (const stop of hardStops(facts, limits)) {
    findings.push(finding("problem", stop.code, stop.reason));
  }
  const stopped = new Set(findings.map((item) => item.code));
  const spend = facts.spend;
  if (spend) {
    const unknown = spend.unknown.filter((item) => item.code !== "no-ledger");
    if (unknown.length > 0) {
      findings.push(
        finding(
          "warn",
          "spend-unknown",
          `eval spend is not fully known: ${unknown.map((item) => item.message).join("; ")}`,
        ),
      );
    }
    if (spend.ceilingUsd !== null && spend.spentUsd !== null && !stopped.has("ceiling")) {
      if (
        spend.issueStopUsd !== null &&
        spend.issueSpentUsd !== null &&
        spend.issueSpentUsd >= spend.issueStopUsd - EPSILON
      ) {
        findings.push(
          finding(
            "warn",
            "issue-stop",
            `issue eval runs reached their ${spend.issueStopUsd.toFixed(2)} USD stop; the runner refuses further issue runs`,
          ),
        );
      } else if (spend.spentUsd >= spend.ceilingUsd * limits.spendWarnShare) {
        findings.push(
          finding(
            "warn",
            "spend",
            `${money(spend.spentUsd)} of the ${spend.ceilingUsd.toFixed(2)} USD eval ceiling are spent`,
          ),
        );
      }
    }
  }
  if (facts.paidCi === null) {
    findings.push(
      finding("warn", "paid-ci-unknown", "the paid CI eval runs could not be read from GitHub"),
    );
  } else if (facts.paidCi?.unknown?.length > 0) {
    findings.push(
      finding(
        "warn",
        "paid-ci-unknown",
        `the jobs of model-eval run ${facts.paidCi.unknown.join(", ")} could not be read`,
      ),
    );
  }
  const machine = facts.machine;
  if (machine) {
    if (machine.freeDiskGb === null || machine.load1 === null) {
      findings.push(
        finding("warn", "machine-unknown", "the machine's load or free disk space cannot be read"),
      );
    }
    if (
      typeof machine.freeDiskGb === "number" &&
      machine.freeDiskGb < limits.diskWarnGb &&
      !stopped.has("disk")
    ) {
      findings.push(
        finding("warn", "disk", `only ${machine.freeDiskGb.toFixed(1)} GB of disk space are free`),
      );
    }
    if (
      typeof machine.load1 === "number" &&
      machine.cores > 0 &&
      machine.load1 >= machine.cores * limits.loadWarnPerCore
    ) {
      findings.push(
        finding(
          "warn",
          "load",
          `the machine's load is ${machine.load1.toFixed(1)} on ${machine.cores} cores`,
        ),
      );
    }
  }
  if ((facts.fullSuites?.length ?? 0) >= limits.fullSuitesWarn) {
    findings.push(
      finding(
        "warn",
        "full-suites",
        `${facts.fullSuites.length} full test suites run at once: ${facts.fullSuites.map((suite) => suite.kind).join(", ")}`,
      ),
    );
  }
  if ((facts.reviewRounds ?? 0) >= limits.reviewRoundsWarn) {
    findings.push(
      finding("warn", "review-rounds", `the issue is in review round ${facts.reviewRounds}`),
    );
  }
  return findings;
}

// Turns the gathered facts into findings, most severe first within each kind.
export function assess(facts, limits = LIMITS) {
  const findings = [];
  const { iterationMinutes, idleMinutes } = facts;

  if (facts.postgres !== "healthy") {
    findings.push(
      finding(
        "problem",
        "postgres",
        `Postgres is ${facts.postgres}; no worktree can be created or removed`,
      ),
    );
  }
  if (iterationMinutes >= limits.iterationProblemMinutes) {
    findings.push(
      finding("problem", "iteration", `the iteration has run for ${iterationMinutes} minutes`),
    );
  } else if (iterationMinutes >= limits.iterationWarnMinutes) {
    findings.push(
      finding("warn", "iteration", `the iteration has run for ${iterationMinutes} minutes`),
    );
  }
  if (idleMinutes === null) {
    findings.push(finding("warn", "idle", "no activity can be read from the run's transcripts"));
  } else if (idleMinutes >= limits.idleProblemMinutes) {
    findings.push(finding("problem", "idle", `no activity for ${idleMinutes} minutes`));
  } else if (idleMinutes >= limits.idleWarnMinutes) {
    findings.push(finding("warn", "idle", `no activity for ${idleMinutes} minutes`));
  }
  for (const { command, count } of facts.refusals ?? []) {
    if (count >= limits.refusalRepeats) {
      findings.push(
        finding("warn", "refusals", `refused ${count} times recently: ${command.slice(0, 120)}`),
      );
    }
  }
  for (const number of facts.failingPullRequests ?? []) {
    findings.push(finding("warn", "checks", `CI is failing on pull request #${number}`));
  }
  if ((facts.agent?.calls ?? 0) >= limits.callsWarn) {
    findings.push(
      finding("warn", "calls", `the current agent has made ${facts.agent.calls} calls`),
    );
  }
  for (const number of facts.newFailedIssues ?? []) {
    findings.push(finding("warn", "failed-issue", `issue #${number} was labelled agent-failed`));
  }
  for (const name of facts.leftoverWorktrees ?? []) {
    findings.push(finding("warn", "leftover", `worktree ${name} belongs to a merged pull request`));
  }
  findings.push(...assessEfficiency(facts, limits));
  return findings;
}

// The model is asked at the first check, at once when a finding is new or something is worth its
// judgement (`triggers`: a paid run), again after `repeatMinutes` while the same findings last,
// and otherwise once an hour. `changed` says whether the findings differ from those it last saw;
// a caller that does not track it is asked for any finding once `repeatMinutes` have passed.
export function needsModel({
  findings,
  minutesSinceModel,
  changed = false,
  triggers = [],
  everyMinutes = LIMITS.modelEveryMinutes,
  repeatMinutes = LIMITS.modelRepeatMinutes,
}) {
  if (minutesSinceModel === null) return true;
  if (triggers.length > 0) return true;
  if (findings.length > 0 && (changed || minutesSinceModel >= repeatMinutes)) return true;
  return minutesSinceModel >= everyMinutes;
}

const COLOURS = { ok: "\x1b[32m", warn: "\x1b[33m", problem: "\x1b[31m" };

// One console line: green, yellow or red; what is happening (`line`), then what was found.
export function formatVerdict({ status, findings, line }) {
  const colour = COLOURS[status] ?? COLOURS.warn;
  const what = line ? ` · ${line}` : "";
  const detail = findings.length ? `: ${findings.join("; ")}` : "";
  return `${colour}[steward] ${status}${what}${detail}\x1b[0m`;
}
