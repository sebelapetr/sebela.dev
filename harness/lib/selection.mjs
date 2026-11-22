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

// A tracking issue names its phase folder in a line of its own: `Plan: .plan/<folder>`. The
// folder is the phase's name everywhere else — the branch `phase/<folder>`, the eval campaign,
// the loop's argument — and stays the same when the plan is archived in `.plan/done/`.
const PLAN_LINE = /^Plan: `?\.plan\/(?:done\/)?([A-Za-z0-9][A-Za-z0-9._-]*)\/?`?[ \t]*\r?$/m;

export function planLine(folder) {
  return `Plan: .plan/${folder}`;
}

// The phase folder an issue's text names, or null.
export function planFolder(body) {
  return PLAN_LINE.exec(String(body ?? ""))?.[1] ?? null;
}

// The one open issue whose text names the folder. issues: [{ number, body }].
export function trackingIssue(folder, issues) {
  const found = issues.filter((issue) => planFolder(issue.body) === folder);
  if (found.length === 1) return found[0];
  if (found.length === 0) {
    throw new PhaseWorkError(
      `no open tracking issue names the phase folder ${folder}: give the phase's tracking issue the line \`${planLine(folder)}\` (docs/git-workflow.md, Issues)`,
    );
  }
  throw new PhaseWorkError(
    `${found.length} open issues name the phase folder ${folder} (${found.map((issue) => `#${issue.number}`).join(", ")}); only the phase's tracking issue may carry the line \`${planLine(folder)}\``,
  );
}

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

// tracking: { number, title, blockedBy: [{ number, state, title }],
//             subIssues: [{ number, title, state, labels: [name], subIssues: count,
//                           blockedBy: [{ number, state }] }] in sub-issue order }
// Returns {
//   phase, tracking: { number, title },
//   status    "next"      `next` is the issue to take: the first eligible one in sub-issue order
//             "waiting"   open sub-issues, none an agent may take now — or the phase itself
//                         waits for an open blocker of its tracking issue
//             "finished"  every sub-issue is closed
//             "empty"     the phase has no sub-issues yet
//   next: { number, title } | null,
//   phaseBlockers: [{ number, title }]   open blockers of the tracking issue
//   progress: { closed, total },
//   open: [{ number, title, kind, openBlockers: [number] }]   open sub-issues, in order
// }
export function selectWork({ phase, tracking }) {
  const subIssues = tracking.subIssues ?? [];
  const open = subIssues.filter((issue) => issue.state !== "CLOSED").map(classify);
  const phaseBlockers = openOnly(tracking.blockedBy).map(({ number, title }) => ({
    number,
    title,
  }));
  const eligible = open.find((issue) => issue.kind === "eligible");
  const next =
    eligible && phaseBlockers.length === 0
      ? { number: eligible.number, title: eligible.title }
      : null;
  const status = next
    ? "next"
    : subIssues.length === 0
      ? "empty"
      : open.length === 0
        ? "finished"
        : "waiting";
  return {
    phase,
    tracking: { number: tracking.number, title: tracking.title },
    status,
    next,
    phaseBlockers,
    progress: { closed: subIssues.length - open.length, total: subIssues.length },
    open,
  };
}

const refs = (numbers) => numbers.map((number) => `#${number}`).join(", ");

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

// What the selection says, for a person or an agent to read.
export function workLines(work) {
  const { closed, total } = work.progress;
  const lines = [
    `phase ${work.phase} · tracking issue #${work.tracking.number} · ${closed}/${total} sub-issues closed`,
  ];
  if (work.phaseBlockers.length > 0) {
    lines.push(
      `waiting: the phase waits for ${refs(work.phaseBlockers.map((issue) => issue.number))} (open blockers of its tracking issue); nothing of it is started`,
    );
  }
  if (work.status === "next") lines.push(`next: #${work.next.number} ${work.next.title}`);
  else if (work.status === "empty")
    lines.push("empty: the tracking issue has no sub-issues yet; the phase is not broken down");
  else if (work.status === "finished") lines.push("finished: every sub-issue is closed");
  else if (work.phaseBlockers.length === 0)
    lines.push("waiting: no open sub-issue is work for an agent now");
  return [...lines, ...waitingLines(work)];
}

// --- between phases -----------------------------------------------------------------------

// The open phases and which of them may start, from the native links between their tracking
// issues — not from phase numbers. issues: the open issues, [{ number, title, body,
// blockedBy: [{ number, state }] }]; those without a plan line are not phases. Returns, in the
// order given, [{ folder, number, title, waitsFor: [{ number, folder | null }], mayStart }].
export function phaseOrder(issues) {
  const folders = new Map();
  for (const issue of issues) {
    const folder = planFolder(issue.body);
    if (folder) folders.set(issue.number, folder);
  }
  return issues
    .filter((issue) => folders.has(issue.number))
    .map((issue) => {
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
      };
    });
}

export function phaseLines(phases) {
  return phases.map((phase) => {
    const waits = phase.waitsFor
      .map((blocker) => `#${blocker.number}${blocker.folder ? ` (${blocker.folder})` : ""}`)
      .join(", ");
    return `${phase.folder} · #${phase.number} · ${phase.mayStart ? "may start" : `waits for ${waits}`}`;
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
