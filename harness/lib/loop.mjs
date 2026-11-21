// Decision logic of the phase loop. Pure functions only: no shell, no network, no agent.
// The table it implements is in .plan/00-overview/harness-prd.md ("The loop").

// What the orchestrator reports at the end of one unattended run (validated by --json-schema).
export const RUN_REPORT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["outcome", "issue", "cause", "summary"],
  properties: {
    outcome: {
      type: "string",
      enum: ["merged", "failed", "interrupted", "phase_done"],
      description:
        "merged: one issue was merged into the phase branch. failed: the issue could not be finished. interrupted: work on the issue stopped for a reason outside the issue, named in cause; its worktree and branch are kept. phase_done: no ready issue was left and the phase pull request is open or could not be opened.",
    },
    issue: {
      type: ["integer", "null"],
      description: "Number of the issue that was worked on, or null for phase_done.",
    },
    // A top-level field rather than a variant per outcome keeps the structured output flat.
    cause: {
      type: ["string", "null"],
      enum: ["usage_limit", "safeguard", "environment", null],
      description:
        "Why the work was interrupted; null unless outcome is interrupted. usage_limit: the usage limit was reached. safeguard: a model safeguard refused or stopped an agent (a usage-policy or AUP refusal). environment: the machine cannot run the work, such as low disk, a missing tool or credential, or a guard refusal that cannot be worked around without breaking a rule.",
    },
    summary: { type: "string", description: "Two or three sentences for the run log." },
  },
});

export const RETRY_LABEL = "agent-retry";
export const FAILED_LABEL = "agent-failed";

const LIMIT_PATTERN =
  /usage limit|rate limit|limit reached|limit will reset|resets? at|too many requests|overloaded/i;
const LIMIT_STATUSES = new Set([429, 529]);

// What a model safeguard looks like in Claude Code's output: the API ends with stop reason
// "refusal" and Claude Code prints "... appears to violate our Usage Policy
// (https://www.anthropic.com/legal/aup) ...", or the request is rejected as an invalid_request with
// policy wording ("Output blocked by content filtering policy").
const SAFEGUARD_PATTERN =
  /usage policy|acceptable use|legal\/aup|\bAUP\b|content filtering policy|\bsafeguard/i;

function parseJson(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const lastLine = trimmed.split("\n").filter(Boolean).at(-1);
    try {
      return JSON.parse(lastLine);
    } catch {
      return null;
    }
  }
}

// Turns the raw result of `claude -p --output-format json` into one of:
//   { kind: "limit" }                                   usage limit or overload: wait and retry
//   { kind: "safeguard" }                               a model safeguard refused the run itself
//   { kind: "report", outcome, issue, cause, summary }  the orchestrator finished and reported
//   { kind: "crash", detail }                           anything else
// A finished report wins: safeguards that stopped a subagent are the orchestrator's to report.
export function classifyRun({ exitCode, stdout, stderr }) {
  const result = parseJson(stdout);

  if (!result) {
    const text = `${stderr ?? ""}\n${stdout ?? ""}`;
    if (SAFEGUARD_PATTERN.test(text)) return { kind: "safeguard" };
    if (LIMIT_PATTERN.test(text)) return { kind: "limit" };
    return {
      kind: "crash",
      detail: `exit ${exitCode}, no JSON result: ${text.trim().slice(0, 500)}`,
    };
  }

  if (result.is_error) {
    if (LIMIT_STATUSES.has(result.api_error_status)) return { kind: "limit" };
    if (
      result.stop_reason === "refusal" ||
      result.safety_stops > 0 ||
      SAFEGUARD_PATTERN.test(result.result ?? "")
    ) {
      return { kind: "safeguard" };
    }
    if (LIMIT_PATTERN.test(result.result ?? "")) {
      return { kind: "limit" };
    }
    return {
      kind: "crash",
      detail:
        `${result.subtype ?? "error"}: ${result.terminal_reason ?? ""} ${result.result ?? ""}`.trim(),
    };
  }

  const report = result.structured_output;
  if (result.subtype !== "success" || !report || typeof report.outcome !== "string") {
    return { kind: "crash", detail: `${result.subtype ?? "unknown"}: no structured report` };
  }
  return {
    kind: "report",
    outcome: report.outcome,
    issue: report.issue ?? null,
    cause: report.cause ?? null,
    summary: report.summary ?? "",
  };
}

// Decides what the loop does after a run.
//   run                  result of classifyRun
//   consecutiveFailures  failed runs in a row so far
//   lastSafeguard        { issue } when the run before was stopped by a safeguard, else null
//   issueLabels          labels of the reported issue (only needed when it failed)
//   maxConsecutiveFailures
// Returns { next, label, consecutiveFailures, lastSafeguard, reason }:
//   next           "continue" | "wait" | "stop" | "done"
//   label          label to add to the reported issue, or null
//   lastSafeguard  what the loop passes to the next decision
//   reason         why it waits, retries or stops: "usage_limit" | "safeguard" |
//                  "safeguard_repeated" | "environment" | "failures", or null
export function decideNext({
  run,
  consecutiveFailures,
  lastSafeguard = null,
  issueLabels = [],
  maxConsecutiveFailures = 3,
}) {
  const decision = (
    next,
    { label = null, failures = consecutiveFailures, safeguard = null, reason = null } = {},
  ) => ({
    next,
    label,
    consecutiveFailures: failures,
    lastSafeguard: safeguard,
    reason,
  });
  const interrupted = run.kind === "report" && run.outcome === "interrupted";

  // A usage limit is not the issue's fault, also when it stops a run halfway through an issue. An
  // interruption without a cause comes from an orchestrator that knew only the usage limit.
  if (run.kind === "limit" || (interrupted && (run.cause ?? "usage_limit") === "usage_limit")) {
    return decision("wait", { safeguard: lastSafeguard, reason: "usage_limit" });
  }

  // A safeguard is not the issue's fault either and often passes on a second try. Twice in a row
  // on the same issue it will not; an unknown issue (the run itself was refused) counts as the same.
  if (run.kind === "safeguard" || (interrupted && run.cause === "safeguard")) {
    const issue = run.issue ?? null;
    const repeated =
      lastSafeguard !== null &&
      (lastSafeguard.issue === null || issue === null || lastSafeguard.issue === issue);
    return repeated
      ? decision("stop", {
          safeguard: { issue: issue ?? lastSafeguard.issue },
          reason: "safeguard_repeated",
        })
      : decision("continue", { safeguard: { issue }, reason: "safeguard" });
  }

  // The machine cannot run the work: every further run would fail the same way.
  if (interrupted && run.cause === "environment") {
    return decision("stop", { reason: "environment" });
  }

  if (run.kind === "report" && run.outcome === "merged") {
    return decision("continue", { failures: 0 });
  }

  if (run.kind === "report" && run.outcome === "phase_done") {
    return decision("done", { failures: 0 });
  }

  const failures = consecutiveFailures + 1;
  const next = failures >= maxConsecutiveFailures ? "stop" : "continue";
  const reason = next === "stop" ? "failures" : null;

  if (run.kind === "report" && run.outcome === "failed" && run.issue !== null) {
    const label = issueLabels.includes(RETRY_LABEL) ? FAILED_LABEL : RETRY_LABEL;
    return decision(next, { label, failures, reason });
  }

  return decision(next, { failures, reason });
}

// What the owner tells the orchestrator for this start of the loop (`--note`), as a section
// appended to the prompt; empty without a note. The note adds to the instructions and never
// replaces a rule. The loop keeps no state, so the orchestrator records a note about an issue on
// that issue, where a later run finds it.
export function ownerNoteSection(note) {
  const text = (note ?? "").trim();
  if (!text) return "";
  return `

Note from the owner for this run, written when the loop was started:

"""
${text}
"""

Take it into account when you pick and handle the issue. It does not override your agent definition, docs/ or the guard. If it concerns an issue, first add it to that issue as a comment starting with \`Owner note:\`, unless the same comment is already there, so that a later run sees it too.`;
}

// The owner's note after an iteration: it stays while the loop only waits for the usage limit,
// because the same work continues, and ends with the first run that finished, so it is not
// repeated to the issues that follow.
export function noteAfter(note, next) {
  return next === "wait" ? (note ?? null) : null;
}

// What the loop says when the steward stops it (harness/lib/steward.mjs, decideStop): by its
// rules — a reached or projected eval ceiling, a run past the per-run stop, an unexpected paid CI
// run, a nearly full disk — or by the steward model's judgement that the work is inefficient.
//   stop    { by: "rules" | "model", reason }
//   issue   the issue being worked on, or null
//   spend   the spend line at the stop, or null
// Returns { log, alert: [line], comment }: the comment goes on the issue, where the next run and
// the owner find it.
export function stewardStop({ stop, issue, spend }) {
  const onIssue = issue ? ` on #${issue}` : "";
  const who = stop.by === "model" ? "the steward model" : "the steward's rules";
  return {
    log: `stopping: ${who} stopped the loop${onIssue}: ${stop.reason}`,
    alert: [`the steward stopped the loop${onIssue}`, stop.reason],
    comment: [
      `Loop note: ${who} stopped the phase loop: ${stop.reason}.`,
      ...(spend ? [spend] : []),
      "The worktree and branch are kept. Run the loop again when this is resolved.",
    ].join("\n\n"),
  };
}

// The issue comment after an iteration that paid for model evals: its spend line (expected
// before, actual after, the remainder of the phase ceiling). Null when nothing was paid.
export function spendComment({ line, paid, iteration }) {
  return paid ? `Loop note: paid eval spend of iteration ${iteration}.\n\n${line}` : null;
}

// What the loop tells the owner after a phase_done report, from what GitHub shows then:
//   pullRequest  the open pull request from the phase branch to the base ({ number }), null when
//                there is none, undefined when gh could not check
//   openIssues   the phase's open issues ([{ number, labels: [name] }]), null when gh could not list
// The phase is done only when its pull request is open and nothing but HITL issues is left; failed,
// blocked or unready issues, or a missing pull request, mean the loop stopped with nothing workable.
// Returns { status: "done" | "stopped", log: [line], alert: [line] }.
export function phaseEnd({ pullRequest, openIssues }) {
  const groups = { failed: [], hitl: [], other: [] };
  for (const issue of openIssues ?? []) {
    const labels = issue.labels ?? [];
    const group = labels.includes(FAILED_LABEL)
      ? "failed"
      : labels.includes("hitl")
        ? "hitl"
        : "other";
    groups[group].push(`#${issue.number}`);
  }
  const list = (name, numbers) => (numbers.length ? [`${name}: ${numbers.join(", ")}`] : []);
  const unknownIssues =
    openIssues == null ? ["could not list the phase's open issues with gh"] : [];

  const prLine =
    pullRequest === undefined
      ? "could not check the phase pull request with gh"
      : pullRequest === null
        ? "no phase pull request"
        : `draft pull request #${pullRequest.number} is open`;

  if (pullRequest && groups.failed.length === 0 && groups.other.length === 0) {
    return {
      status: "done",
      log: [
        `phase done: ${prLine}; mark it ready for review when the phase is complete`,
        ...list("remaining HITL", groups.hitl),
        ...unknownIssues,
      ],
      alert: ["phase done", prLine, ...list("HITL", groups.hitl)],
    };
  }

  const issues = [
    ...list("agent-failed", groups.failed),
    ...list("blocked or not ready", groups.other),
    ...list("HITL", groups.hitl),
  ];
  return {
    status: "stopped",
    log: ["phase stopped: no workable issue left", ...issues, ...unknownIssues, prLine],
    alert: ["phase stopped: no workable issue left", [...issues, prLine].join("; ")],
  };
}
