// Conventional Commits check for the commit-msg hook. The rules are those of docs/git-workflow.md
// ("Commits"): `<type>(<scope>): <summary>` with one of the documented types, an optional
// lower-case scope and `!` for a breaking change, a summary in lower case without a trailing
// period, and a blank line before any body.
//
// The headers Git writes itself pass by default, as the commit-msg hook needs. CI narrows that
// (scripts/checks/commit-messages.mjs): `autosquash: false` refuses `fixup!`, `squash!` and
// `amend!` where no squash merge will remove them, and `merge: false` refuses `Merge …` for a
// pull request title that becomes the squash commit's header.

export const COMMIT_TYPES = ["feat", "fix", "docs", "refactor", "test", "chore", "ci"];

const FORM = "<type>(<scope>): <summary>";
const HEADER = /^(?<type>[a-z]+)(?:\((?<scope>[a-z0-9][a-z0-9-]*)\))?!?: (?<summary>\S.*)$/;
// Messages Git writes itself for merges, reverts and autosquash commits.
const MERGE = /^Merge /;
const REVERT = /^Revert "/;
const AUTOSQUASH = /^(fixup|squash|amend)! /;
const SCISSORS = /^# -+ >8 -+$/m;

// What Git keeps of the message with the default cleanup: no comment lines, nothing below the
// scissors line, no trailing blank lines.
function cleanMessage(text) {
  const scissors = text.search(SCISSORS);
  const kept = scissors === -1 ? text : text.slice(0, scissors);
  return kept
    .split("\n")
    .filter((line) => !line.startsWith("#"))
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/^\n+|\n+$/g, "");
}

// Returns { valid, errors }; each error is one sentence a developer can act on.
export function checkCommitMessage(text, { autosquash = true, merge = true } = {}) {
  const message = cleanMessage(String(text ?? ""));
  if (!message) return { valid: false, errors: ["The commit message is empty."] };
  const [header, second] = message.split("\n");
  if (REVERT.test(header) || (merge && MERGE.test(header))) return { valid: true, errors: [] };
  if (AUTOSQUASH.test(header)) {
    if (autosquash) return { valid: true, errors: [] };
    return {
      valid: false,
      errors: [
        `"${header}" is an autosquash commit; only an issue branch is squash-merged, so fold it ` +
          "into the commit it amends (git rebase --autosquash) before it reaches this branch.",
      ],
    };
  }

  const errors = [];
  const match = header.match(HEADER);
  if (!match) {
    errors.push(
      `The first line "${header}" is not in Conventional Commits form ${FORM}: a lower-case type, ` +
        "an optional lower-case scope in parentheses, a colon, one space and the summary.",
    );
  } else {
    const { type, summary } = match.groups;
    if (!COMMIT_TYPES.includes(type)) {
      errors.push(`The type "${type}" is not allowed; use one of ${COMMIT_TYPES.join(", ")}.`);
    }
    if (/^\p{Lu}/u.test(summary)) {
      errors.push(`The summary "${summary}" must start in lower case.`);
    }
    if (summary.endsWith(".")) {
      errors.push(`The summary "${summary}" must not end with a period.`);
    }
  }
  if (second !== undefined && second !== "") {
    errors.push("Separate the first line from the body with a blank line.");
  }
  return { valid: errors.length === 0, errors };
}
