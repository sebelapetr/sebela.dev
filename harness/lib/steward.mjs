// The steward's rules: it reads what the running phase loop leaves behind and says whether the run
// looks healthy. Pure — the caller gathers the facts (harness/steward.mjs). It only reports; it never
// changes anything. Intent: docs/agents.md, "The steward".

export const LIMITS = Object.freeze({
  iterationWarnMinutes: 45,
  iterationProblemMinutes: 90,
  idleWarnMinutes: 15,
  idleProblemMinutes: 30,
  callsWarn: 250,
  refusalRepeats: 3,
  modelEveryMinutes: 60,
});

// What the model returns when it is asked.
export const STEWARD_REPORT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["status", "findings"],
  properties: {
    status: { type: "string", enum: ["ok", "warn", "problem"] },
    findings: { type: "array", items: { type: "string" } },
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

const finding = (level, code, message) => ({ level, code, message });

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
  return findings;
}

// The model is asked when something looks wrong, and otherwise once an hour.
export function needsModel({
  findings,
  minutesSinceModel,
  everyMinutes = LIMITS.modelEveryMinutes,
}) {
  return findings.length > 0 || minutesSinceModel === null || minutesSinceModel >= everyMinutes;
}

const COLOURS = { ok: "\x1b[32m", warn: "\x1b[33m", problem: "\x1b[31m" };

// One console line: green, yellow or red.
export function formatVerdict({ status, findings }) {
  const colour = COLOURS[status] ?? COLOURS.warn;
  const detail = findings.length ? `: ${findings.join("; ")}` : "";
  return `${colour}[steward] ${status}${detail}\x1b[0m`;
}
