// Decision logic of the phase loop. Pure functions only: no shell, no network, no agent.
// The table it implements is in .plan/00-overview/harness-prd.md ("The loop").

// What the orchestrator reports at the end of one unattended run (validated by --json-schema).
export const RUN_REPORT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["outcome", "issue", "summary"],
  properties: {
    outcome: {
      type: "string",
      enum: ["merged", "failed", "phase_done"],
      description:
        "merged: one issue was merged into the phase branch. failed: the issue could not be finished. phase_done: no ready issue was left and the phase pull request is open.",
    },
    issue: {
      type: ["integer", "null"],
      description: "Number of the issue that was worked on, or null for phase_done.",
    },
    summary: { type: "string", description: "Two or three sentences for the run log." },
  },
});

export const RETRY_LABEL = "agent-retry";
export const FAILED_LABEL = "agent-failed";

const LIMIT_PATTERN =
  /usage limit|rate limit|limit reached|limit will reset|resets? at|too many requests|overloaded/i;
const LIMIT_STATUSES = new Set([429, 529]);

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
//   { kind: "report", outcome, issue, summary }         the orchestrator finished and reported
//   { kind: "crash", detail }                           anything else
export function classifyRun({ exitCode, stdout, stderr }) {
  const result = parseJson(stdout);

  if (!result) {
    const text = `${stderr ?? ""}\n${stdout ?? ""}`;
    if (LIMIT_PATTERN.test(text)) return { kind: "limit" };
    return {
      kind: "crash",
      detail: `exit ${exitCode}, no JSON result: ${text.trim().slice(0, 500)}`,
    };
  }

  if (result.is_error) {
    if (LIMIT_STATUSES.has(result.api_error_status) || LIMIT_PATTERN.test(result.result ?? "")) {
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
    summary: report.summary ?? "",
  };
}

// Decides what the loop does after a run.
//   run                  result of classifyRun
//   consecutiveFailures  failed runs in a row so far
//   issueLabels          labels of the reported issue (only needed when it failed)
//   maxConsecutiveFailures
// Returns { next, label, consecutiveFailures }:
//   next   "continue" | "wait" | "stop" | "done"
//   label  label to add to the reported issue, or null
export function decideNext({
  run,
  consecutiveFailures,
  issueLabels = [],
  maxConsecutiveFailures = 3,
}) {
  if (run.kind === "limit") {
    return { next: "wait", label: null, consecutiveFailures };
  }

  if (run.kind === "report" && run.outcome === "merged") {
    return { next: "continue", label: null, consecutiveFailures: 0 };
  }

  if (run.kind === "report" && run.outcome === "phase_done") {
    return { next: "done", label: null, consecutiveFailures: 0 };
  }

  const failures = consecutiveFailures + 1;
  const giveUp = failures >= maxConsecutiveFailures;

  if (run.kind === "report" && run.outcome === "failed" && run.issue !== null) {
    const label = issueLabels.includes(RETRY_LABEL) ? FAILED_LABEL : RETRY_LABEL;
    return { next: giveUp ? "stop" : "continue", label, consecutiveFailures: failures };
  }

  return { next: giveUp ? "stop" : "continue", label: null, consecutiveFailures: failures };
}
