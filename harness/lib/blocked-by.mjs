// The `## Blocked by` section of an issue's text against the issue's native blocked-by links.
// The native links are what the work selection reads (lib/selection.mjs); the section is kept
// beside them only during the migration (docs/decisions/0027), as a rendering of the links, and
// this check says where the two have drifted apart. Pure — harness/phase-work.mjs reads GitHub.

import { READY_LABEL } from "./selection.mjs";

const HEADING = /^##[ \t]+Blocked by[ \t]*\r?$/im;

// The text of the section, up to the next heading of the same or a higher level; null without one.
function section(body) {
  const text = String(body ?? "");
  const heading = HEADING.exec(text);
  if (!heading) return null;
  const rest = text.slice(heading.index + heading[0].length);
  const next = /^#{1,2}[ \t]+\S/m.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

// The issues the section names, in order, each once: `#123` and links to `/issues/123`. A link
// to a pull request is not an issue. Null when the issue has no such section.
export function textBlockers(body) {
  const text = section(body);
  if (text === null) return null;
  const numbers = [];
  for (const match of text.matchAll(/(?:\/issues\/|(?<![\w/])#)(\d+)\b/g)) {
    const number = Number(match[1]);
    if (!numbers.includes(number)) numbers.push(number);
  }
  return numbers;
}

// The section as a rendering of the native links: what `to-issues` writes while the section
// still exists.
export function renderBlockedBy(numbers) {
  const list =
    numbers.length > 0
      ? numbers.map((number) => `- #${number}`).join("\n")
      : "None - can start immediately.";
  return `## Blocked by\n\n${list}`;
}

// The numbers only a text names: their state decides whether they still matter, and the caller
// must ask GitHub for it.
export function textOnlyBlockers(issues) {
  const numbers = new Set();
  for (const issue of issues) {
    const linked = new Set((issue.blockedBy ?? []).map((blocker) => blocker.number));
    for (const number of textBlockers(issue.body) ?? []) {
      if (number !== issue.number && !linked.has(number)) numbers.add(number);
    }
  }
  return [...numbers].sort((a, b) => a - b);
}

// Where text and native links disagree about what an issue still waits for.
//   issues   the open issues: [{ number, title, body, labels: [name], blockedBy: [{ number, state }] }]
//   states   Map of issue number → "OPEN" | "CLOSED" | null (no issue) for textOnlyBlockers
// Only open blockers count: a closed blocker named on one side only is history. An issue without
// the section says nothing in text, which is a disagreement only where an agent may take the
// issue (`ready-for-agent`) and it has an open native blocker.
// Returns [{ number, title, hasSection, missingInText: [number], missingNatively: [number] }].
export function blockerDisagreements(issues, states) {
  const found = [];
  for (const issue of issues) {
    const named = textBlockers(issue.body);
    const hasSection = named !== null;
    if (!hasSection && !(issue.labels ?? []).includes(READY_LABEL)) continue;
    const blockers = issue.blockedBy ?? [];
    const linked = new Set(blockers.map((blocker) => blocker.number));
    const inText = new Set(named ?? []);
    const missingInText = blockers
      .filter((blocker) => blocker.state !== "CLOSED" && !inText.has(blocker.number))
      .map((blocker) => blocker.number)
      .sort((a, b) => a - b);
    const missingNatively = [...inText]
      .filter(
        (number) => number !== issue.number && !linked.has(number) && states.get(number) === "OPEN",
      )
      .sort((a, b) => a - b);
    if (missingInText.length > 0 || missingNatively.length > 0) {
      found.push({
        number: issue.number,
        title: issue.title,
        hasSection,
        missingInText,
        missingNatively,
      });
    }
  }
  return found;
}

const refs = (numbers) => numbers.map((number) => `#${number}`).join(", ");

// One line per issue: what differs and which side to change. The native links are the truth.
export function disagreementLines(disagreements) {
  return disagreements.map((entry) => {
    const parts = [];
    if (!entry.hasSection) {
      parts.push(
        `it has no \`## Blocked by\` section but is natively blocked by ${refs(entry.missingInText)}: add the section`,
      );
    } else if (entry.missingInText.length > 0) {
      parts.push(
        `the text does not name ${refs(entry.missingInText)}, which block it natively: add them to the section`,
      );
    }
    if (entry.missingNatively.length > 0) {
      parts.push(
        `the text names ${refs(entry.missingNatively)}, open, with no native link: add the link or take them out of the section`,
      );
    }
    return `#${entry.number} ${entry.title}: ${parts.join("; ")}`;
  });
}
