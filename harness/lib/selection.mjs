// Which issue of a phase is worked on next, read from GitHub's native structure and nothing
// else: the phase's tracking issue, the order of its sub-issues, their labels and the state of
// their native blockers. No `phase:` label, no `## Blocked by` text, no issue number decides.
// Pure — the caller reads GitHub (harness/phase-work.mjs). Intent: docs/agents.md, "Work
// selection"; decision: docs/decisions/0027.

export const READY_LABEL = "ready-for-agent";
export const HUMAN_LABEL = "hitl";
export const FAILED_LABEL = "agent-failed";

// The structure on GitHub is not what the selection needs: the owner must change it. Unlike a
// network failure it does not go away by asking again.
export class PhaseWorkError extends Error {
  constructor(message) {
    super(message);
    this.name = "PhaseWorkError";
  }
}

// --- the plan line ------------------------------------------------------------------------

// A tracking issue of a phase names its phase folder in a line of its own, from the first
// character of the line to its end: `Plan: .plan/<folder>`. The folder is the phase's name
// everywhere else — the branch `phase/<folder>`, the eval campaign, the loop's argument — and
// stays the same when the plan is archived in `.plan/done/`. A line inside a fenced code block
// or an HTML comment is an example or a hint, never the plan line; so is an indented or quoted one.
const PLAN_LINE = /^Plan: `?\.plan\/(?:done\/)?([A-Za-z0-9][A-Za-z0-9._-]*)\/?`?[ \t]*\r?$/m;
const FENCED = /^(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^\1[^\n]*$|(?![\s\S]))/gm;
const COMMENT = /<!--[\s\S]*?(?:-->|(?![\s\S]))/g;

export function planLine(folder) {
  return `Plan: .plan/${folder}`;
}

// The phase folder an issue's text names, or null.
// The text without its HTML comments. Removing one comment can leave the pieces of another
// (`<!<!-- x -->--`), so the removal repeats until nothing is left to remove.
function withoutComments(text) {
  let previous;
  do {
    previous = text;
    text = text.replace(COMMENT, "");
  } while (text !== previous);
  return text;
}

export function planFolder(body) {
  const text = withoutComments(String(body ?? "").replace(FENCED, ""));
  return PLAN_LINE.exec(text)?.[1] ?? null;
}

// Whose issues can name a phase: anybody may open an issue in a public repository, and an
// outsider's issue with a plan line must neither become a phase nor halt one by naming its
// folder a second time. GitHub's `authorAssociation` of the issue decides.
const TRUSTED_AUTHORS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const trusted = (issue) => TRUSTED_AUTHORS.has(issue.authorAssociation);
const NOT_TRUSTED = "its author is not the owner, a member or a collaborator";

// The issues that carry a plan line and are ignored for their author — all of them, or those
// that name `folder`. → [{ number, folder, authorAssociation }]
export function untrustedPlanIssues(issues, folder = null) {
  return issues
    .map((issue) => ({ issue, named: planFolder(issue.body) }))
    .filter(({ issue, named }) => named && !trusted(issue) && (folder === null || named === folder))
    .map(({ issue, named }) => ({
      number: issue.number,
      folder: named,
      authorAssociation: issue.authorAssociation ?? null,
    }));
}

export function ignoredLines(ignored) {
  return ignored.map(
    (issue) => `ignored: #${issue.number} names a plan folder, but ${NOT_TRUSTED}`,
  );
}

// The one open issue of a trusted author whose text names the folder: the phase's tracking
// issue. issues: [{ number, body, authorAssociation }]. An epic — a tracking issue without a
// plan line — is no phase, so no folder ever resolves to it.
export function trackingIssue(folder, issues) {
  const found = issues.filter((issue) => trusted(issue) && planFolder(issue.body) === folder);
  if (found.length === 1) return found[0];
  if (found.length === 0) {
    const ignored = untrustedPlanIssues(issues, folder).map((issue) => `#${issue.number}`);
    const outsiders =
      ignored.length > 0 ? `; ${ignored.join(", ")} names it but is ignored: ${NOT_TRUSTED}` : "";
    throw new PhaseWorkError(
      `no open tracking issue names the phase folder ${folder}: give the phase's tracking issue the line \`${planLine(folder)}\` (docs/git-workflow.md, Issues)${outsiders}`,
    );
  }
  throw new PhaseWorkError(
    `${found.length} open issues name the phase folder ${folder} (${found.map((issue) => `#${issue.number}`).join(", ")}); only the phase's tracking issue may carry the line \`${planLine(folder)}\``,
  );
}

// --- cycles -------------------------------------------------------------------------------

// The way from `start` back to itself along `edges` (Map of number → [number], "is blocked
// by"), as the numbers on it starting with `start`; null when there is none.
function cycleFrom(start, edges) {
  const seen = new Set();
  const walk = (number, path) => {
    for (const next of edges.get(number) ?? []) {
      if (next === start) return path;
      if (seen.has(next)) continue;
      seen.add(next);
      const found = walk(next, [...path, next]);
      if (found) return found;
    }
    return null;
  };
  return walk(start, [start]);
}

const refs = (numbers) => numbers.map((number) => `#${number}`).join(", ");
const cycleLine = (cycle) =>
  `cycle: ${[...cycle, cycle[0]].map((number) => `#${number}`).join(" → ")}`;

// --- one issue ----------------------------------------------------------------------------

const openOnly = (blockers) => (blockers ?? []).filter((blocker) => blocker.state !== "CLOSED");

// Why an open sub-issue is or is not work for an agent. The first that applies:
//   parent     it has sub-issues of its own: a tracking issue is never work, whatever it carries
//   failed     `agent-failed`: skipped until the owner looks
//   hitl       `hitl`: waits for a human
//   not-ready  no `ready-for-agent`: the owner has not released it
//   blocked    one of its native blockers is open — the blocker's state is read, because the
//              link to a closed blocker stays
//   eligible   an agent may take it
function classify(issue) {
  const labels = issue.labels ?? [];
  const openBlockers = openOnly(issue.blockedBy).map((blocker) => blocker.number);
  const kind =
    (issue.subIssues ?? 0) > 0
      ? "parent"
      : labels.includes(FAILED_LABEL)
        ? "failed"
        : labels.includes(HUMAN_LABEL)
          ? "hitl"
          : !labels.includes(READY_LABEL)
            ? "not-ready"
            : openBlockers.length > 0
              ? "blocked"
              : "eligible";
  return { number: issue.number, title: issue.title, kind, openBlockers };
}

// --- the phase ----------------------------------------------------------------------------

// tracking: { number, title, repository?, blockedBy: [{ number, state, title, folder? }],
//             subIssues: [{ number, title, state, labels: [name], subIssues: count, repository?,
//                           blockedBy: [{ number, state }] }] in sub-issue order }
// ignored:    issues that name the folder but are not the tracking issue (untrustedPlanIssues)
// phaseCycle: the tracking issues that block each other in a circle with this one, or null
// Returns {
//   phase, tracking: { number, title },
//   status    "next"         `next` is the issue to take: the first eligible one in sub-issue order
//             "waiting"      open sub-issues, none an agent may take now
//             "finished"     every sub-issue is closed
//             "empty"        the phase has no sub-issues yet: it is not broken down
//             "phase-waits"  the tracking issue has an open blocker: the phase has not started
//                            and nothing of it is selected, whatever its sub-issues are
//   next: { number, title } | null,
//   phaseBlockers: [{ number, title, folder }]   open blockers of the tracking issue
//   phaseCycle: [number] | null,
//   progress: { closed, total },
//   open: [{ number, title, kind, openBlockers: [number] }]   open sub-issues, in order
//   cycles: [[number]]   open sub-issues that block each other in a circle
//   ignored: [{ number, … }]
// }
// Throws PhaseWorkError for a sub-issue of another repository: its labels and blockers are not
// this repository's to trust, and the loop could not work on it.
export function selectWork({ phase, tracking, ignored = [], phaseCycle = null }) {
  const subIssues = tracking.subIssues ?? [];
  for (const issue of subIssues) {
    if (tracking.repository && issue.repository && issue.repository !== tracking.repository) {
      throw new PhaseWorkError(
        `sub-issue #${issue.number} of tracking issue #${tracking.number} belongs to another repository (${issue.repository}); a phase's sub-issues must be issues of ${tracking.repository}: remove it from the tracking issue`,
      );
    }
  }
  const open = subIssues.filter((issue) => issue.state !== "CLOSED").map(classify);
  const phaseBlockers = openOnly(tracking.blockedBy).map(({ number, title, folder }) => ({
    number,
    title,
    folder: folder ?? null,
  }));
  const eligible = open.find((issue) => issue.kind === "eligible");
  const status =
    phaseBlockers.length > 0
      ? "phase-waits"
      : eligible
        ? "next"
        : subIssues.length === 0
          ? "empty"
          : open.length === 0
            ? "finished"
            : "waiting";
  const edges = new Map(open.map((issue) => [issue.number, issue.openBlockers]));
  const cycles = [];
  for (const issue of open) {
    if (cycles.some((cycle) => cycle.includes(issue.number))) continue;
    const cycle = cycleFrom(issue.number, edges);
    if (cycle) cycles.push(cycle);
  }
  return {
    phase,
    tracking: { number: tracking.number, title: tracking.title },
    status,
    next: status === "next" ? { number: eligible.number, title: eligible.title } : null,
    phaseBlockers,
    phaseCycle,
    progress: { closed: subIssues.length - open.length, total: subIssues.length },
    open,
    cycles,
    ignored,
  };
}

// The open blockers of a phase's tracking issue, each with its phase folder when it is one.
export function phaseBlockerRefs(blockers) {
  return blockers
    .map((issue) => `#${issue.number}${issue.folder ? ` (${issue.folder})` : ""}`)
    .join(", ");
}

// The open sub-issues that are not work now, one line per reason, each issue with its open
// blockers. For the command's output, the loop's end and the phase report.
export function waitingLines(work) {
  const of = (kind) => work.open.filter((issue) => issue.kind === kind);
  const withBlockers = (issue, by) =>
    issue.openBlockers.length > 0
      ? `#${issue.number} (${by} ${refs(issue.openBlockers)})`
      : `#${issue.number}`;
  const line = (name, issues, by) =>
    issues.length > 0
      ? [`${name}: ${issues.map((issue) => withBlockers(issue, by)).join(", ")}`]
      : [];
  return [
    ...line("blocked", of("blocked"), "by"),
    ...line("waiting for a human (hitl)", of("hitl"), "blocked by"),
    ...line("agent-failed", of("failed"), "blocked by"),
    ...line("not ready-for-agent", of("not-ready"), "blocked by"),
    ...line("has sub-issues of its own", of("parent"), "blocked by"),
  ];
}

// What the selection says, for a person or an agent to read. The second line is always
// `status: <status>`: what a reader does next is keyed on it, never on a line being absent.
export function workLines(work) {
  const { closed, total } = work.progress;
  const lines = [
    `phase ${work.phase} · tracking issue #${work.tracking.number} · ${closed}/${total} sub-issues closed`,
    `status: ${work.status}`,
  ];
  if (work.status === "phase-waits") {
    lines.push(
      `waiting: the phase waits for ${phaseBlockerRefs(work.phaseBlockers)} (open blockers of its tracking issue); nothing of it is started`,
    );
    if (work.phaseCycle) {
      lines.push(`${cycleLine(work.phaseCycle)} — these tracking issues block each other`);
    }
  }
  if (work.status === "next") lines.push(`next: #${work.next.number} ${work.next.title}`);
  if (total === 0)
    lines.push("empty: the tracking issue has no sub-issues yet; the phase is not broken down");
  else if (work.status === "finished") lines.push("finished: every sub-issue is closed");
  else if (work.status === "waiting")
    lines.push("waiting: no open sub-issue is work for an agent now");
  return [
    ...lines,
    ...waitingLines(work),
    ...(work.cycles ?? []).map((cycle) => `${cycleLine(cycle)} — these issues block each other`),
    ...ignoredLines(work.ignored ?? []),
  ];
}

// --- between phases -----------------------------------------------------------------------

// The open phases and which of them may start, from the native links between their tracking
// issues — not from phase numbers. issues: the open issues, [{ number, title, body,
// authorAssociation, blockedBy: [{ number, state }] }]; those without a plan line of a trusted
// author are not phases (an epic has none). Returns, in the order given,
// [{ folder, number, title, waitsFor: [{ number, folder | null }], mayStart,
//    cycle: [number] | null }] — `cycle` names the tracking issues that block each other in a
// circle with this one: none of them can ever start until a link is removed.
export function phaseOrder(issues) {
  const folders = new Map();
  for (const issue of issues) {
    const folder = trusted(issue) ? planFolder(issue.body) : null;
    if (folder) folders.set(issue.number, folder);
  }
  const phases = issues.filter((issue) => folders.has(issue.number));
  const edges = new Map(
    phases.map((issue) => [
      issue.number,
      openOnly(issue.blockedBy)
        .map((blocker) => blocker.number)
        .filter((number) => folders.has(number)),
    ]),
  );
  return phases.map((issue) => {
    const waitsFor = openOnly(issue.blockedBy).map((blocker) => ({
      number: blocker.number,
      folder: folders.get(blocker.number) ?? null,
    }));
    return {
      folder: folders.get(issue.number),
      number: issue.number,
      title: issue.title,
      waitsFor,
      mayStart: waitsFor.length === 0,
      cycle: cycleFrom(issue.number, edges),
    };
  });
}

export function phaseLines(phases) {
  return phases.map((phase) => {
    const parts = [
      phase.folder,
      `#${phase.number}`,
      phase.mayStart ? "may start" : `waits for ${phaseBlockerRefs(phase.waitsFor)}`,
    ];
    if (phase.cycle) parts.push(cycleLine(phase.cycle));
    return parts.join(" · ");
  });
}

// --- incomplete answers -------------------------------------------------------------------

// A list GitHub cut short would silently hide a blocker or a label, so it is refused instead.
// connection: { totalCount, nodes }.
export function assertComplete(connection, what) {
  const got = connection?.nodes?.length ?? 0;
  const total = connection?.totalCount ?? got;
  if (got < total) {
    throw new PhaseWorkError(
      `GitHub returned only ${got} of ${total} ${what}; the selection refuses to decide from a partial list`,
    );
  }
}
