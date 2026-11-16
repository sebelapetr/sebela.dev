// Who works on what in a running iteration, read from the orchestrator's transcript, and how far
// the phase is. Pure — the loop and the steward gather the lines and the issues. Intent:
// docs/agents.md, "The phase loop".

const CREATE = /worktree\.mjs create (\S+)/;
const BRANCH_ISSUE = /^[a-z]+\/(\d+)-/;
const ISSUE = /(?:issue|#)\s*#?(\d+)/i;

// The orchestrator's transcript (JSONL lines) → { issue, branch, agent }, null where not known yet.
export function currentWork(lines) {
  const work = { issue: null, branch: null, agent: null };
  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const content = entry?.message?.content;
    if (entry?.type !== "assistant" || !Array.isArray(content)) continue;
    for (const part of content) {
      if (part?.type !== "tool_use") continue;
      const created = CREATE.exec(String(part.input?.command ?? ""));
      if (created) {
        work.branch = created[1];
        const issue = BRANCH_ISSUE.exec(created[1]);
        if (issue) work.issue = Number(issue[1]);
      }
      if (part.input?.subagent_type) {
        work.agent = part.input.subagent_type;
        const named = ISSUE.exec(`${part.input.description ?? ""} ${part.input.prompt ?? ""}`);
        if (named && work.issue === null) work.issue = Number(named[1]);
      }
    }
  }
  return work;
}

// The phase's issues ({ state }) → closed of total.
export function phaseProgress(issues) {
  return {
    closed: issues.filter((issue) => issue.state === "CLOSED").length,
    total: issues.length,
  };
}

// One line: who works on what, for how long, and how far the phase is.
export function describeWork({ work, minutes, calls, context, progress }) {
  const who = work.issue
    ? `${work.agent ?? "orchestrator"} on #${work.issue}`
    : "orchestrator choosing an issue";
  const parts = [who, `${minutes} min`];
  if (calls > 0) parts.push(`${calls} calls`);
  if (context > 0) parts.push(`context ${Math.round(context / 1000)}k`);
  if (progress) parts.push(`phase ${progress.closed}/${progress.total}`);
  return parts.join(" · ");
}

// What the loop prints when the issue or the working agent changes; null when nothing did.
export function workChange(previous, current) {
  if (current.issue === null) return null;
  if (previous.issue === current.issue && previous.agent === current.agent) return null;
  const head = `#${current.issue}${current.branch ? ` ${current.branch}` : ""}`;
  return current.agent ? `${head} → ${current.agent}` : head;
}
