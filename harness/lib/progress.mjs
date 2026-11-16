// Who works on what in a running iteration, read from the orchestrator's transcript, and how far
// the phase is. Pure — the loop and the steward gather the lines and the issues. Intent:
// docs/agents.md, "The phase loop".

const CREATE = /worktree\.mjs create (\S+)/;
const BRANCH_ISSUE = /^[a-z]+\/(\d+)-/;
const ISSUE = /(?:issue|#)\s*#?(\d+)/i;

// The orchestrator's tool calls, in order, with each call that puts an agent to work resolved to
// that agent: a dispatch names it (`subagent_type`); a SendMessage that continues a finished
// agent — objections back to the developer, fixes back to the reviewer — names it by the id
// Claude Code recorded when that agent finished.
export function* toolCalls(lines) {
  const agents = new Map();
  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const { agentId, agentType } = entry?.toolUseResult ?? {};
    if (agentId && agentType) agents.set(agentId, agentType);
    const content = entry?.message?.content;
    if (entry?.type !== "assistant" || !Array.isArray(content)) continue;
    for (const part of content) {
      if (part?.type !== "tool_use") continue;
      const input = part.input ?? {};
      const agent =
        input.subagent_type ?? (part.name === "SendMessage" ? agents.get(input.to) : undefined);
      yield { input, agent: agent ?? null };
    }
  }
}

// The orchestrator's transcript (JSONL lines) → { issue, branch, agent }, null where not known yet.
export function currentWork(lines) {
  const work = { issue: null, branch: null, agent: null };
  for (const { input, agent } of toolCalls(lines)) {
    const created = CREATE.exec(String(input.command ?? ""));
    if (created) {
      work.branch = created[1];
      const issue = BRANCH_ISSUE.exec(created[1]);
      if (issue) work.issue = Number(issue[1]);
    }
    if (agent) {
      work.agent = agent;
      const named = ISSUE.exec(`${input.description ?? ""} ${input.prompt ?? ""}`);
      if (named && work.issue === null) work.issue = Number(named[1]);
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
