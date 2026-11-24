// The `hitl` label against the assignee of an issue. The label is what the work selection reads
// (lib/selection.mjs); the assignee is the same fact made visible on GitHub for people: an issue
// that waits for the owner is assigned, an issue an agent may take is not. This is a report for
// the owner. Nothing that selects work reads an assignee: every agent acts through the owner's
// account, so an assignee cannot tell an agent from a person, and a value set by mistake must
// not change what an unattended loop does. Pure — harness/phase-work.mjs reads GitHub.

import { HUMAN_LABEL } from "./selection.mjs";

// issues: the open issues, [{ number, title, labels: [name], assignees: [login] }].
// → the issues where the two disagree: [{ number, title, hitl, assignees: [login] }]
export function assigneeDisagreements(issues) {
  return issues
    .map((issue) => ({
      number: issue.number,
      title: issue.title,
      hitl: (issue.labels ?? []).includes(HUMAN_LABEL),
      assignees: issue.assignees ?? [],
    }))
    .filter((issue) => issue.hitl !== issue.assignees.length > 0);
}

export function assigneeLines(disagreements) {
  return disagreements.map((entry) =>
    entry.hitl
      ? `#${entry.number} ${entry.title}: labelled \`hitl\` but has no assignee: assign the owner`
      : `#${entry.number} ${entry.title}: assigned to ${entry.assignees.join(", ")} but not labelled \`hitl\`: add the label if it waits for a person, or remove the assignee`,
  );
}
