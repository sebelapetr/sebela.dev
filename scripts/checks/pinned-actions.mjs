// The pinned-actions check's decision (docs/testing.md, CI): which `uses:` references of a GitHub
// Actions workflow are not pinned. A third-party action or reusable workflow must name a full
// 40-character commit SHA followed by its version as a trailing comment
// (`uses: actions/checkout@<sha> # v7.0.1`), so a moved tag cannot change what CI runs and
// Dependabot can keep the comment current. A Docker action must name an image digest. Local
// actions and workflows of this repository (`./...`) are allowed. Plain Node, no dependencies;
// `pinned-actions.test.mjs` runs it on the repository's workflows.

const USES =
  /^\s*(?:-\s+)?uses:\s*(?<value>["']?)(?<reference>[^\s"'#]+)\k<value>\s*(?<comment>#.*)?$/;
const FULL_SHA = /@[0-9a-f]{40}$/;
const IMAGE_DIGEST = /@sha256:[0-9a-f]{64}$/;
const VERSION_COMMENT = /^#\s*\S/;

function reasonFor(reference, comment) {
  if (reference.startsWith("./")) return undefined;
  if (reference.startsWith("docker://")) {
    return IMAGE_DIGEST.test(reference) ? undefined : "not pinned to an image digest";
  }
  if (!FULL_SHA.test(reference)) return "not pinned to a full commit SHA";
  if (!VERSION_COMMENT.test(comment ?? "")) return "no version comment after the SHA";
  return undefined;
}

/**
 * The `uses:` references of a workflow's text that are not pinned, each with its 1-based line and
 * the reason, in the order of the file.
 *
 * @param {string} text
 * @returns {{ line: number, reference: string, reason: string }[]}
 */
export function unpinnedActions(text) {
  const found = [];
  text.split("\n").forEach((content, index) => {
    const match = USES.exec(content);
    if (!match?.groups) return;
    const { reference, comment } = match.groups;
    const reason = reasonFor(reference, comment);
    if (reason !== undefined) found.push({ line: index + 1, reference, reason });
  });
  return found;
}
