// Whether CI's quality job runs the tests of every package for the full coverage figure and keeps
// the coverage site for GitHub Pages (.github/workflows/ci.yml; docs/testing.md, Coverage). Plain
// Node, no dependencies.
//
// Usage: EVENT=<event name> node scripts/checks/coverage-full-run.mjs <base> [<head>]
// Prints `full-run=true` or `full-run=false` on stdout, for $GITHUB_OUTPUT; the reason goes to
// stderr. Always exits 0.
//
// The full run happens on a push (CI runs on pushes to master only) that changes a file other than
// documentation, and on a push whose base cannot be resolved, since anything may have changed.
// Documentation selects no work (docs/testing.md, CI): a push of documentation alone, a merged
// changelog pull request among them, cannot change the figure, so nothing runs and the published
// badge stays as it is. Which files are documentation: harness/lib/documentation.mjs, through
// without-documentation.mjs. A pull request, or a run started by hand, never runs it.

import { pathToFileURL } from "node:url";

import { withoutDocumentation } from "./without-documentation.mjs";

/**
 * Whether the full coverage run happens for `event` with `files`, the changed files that are not
 * documentation, or null when the base could not be resolved.
 */
export function fullCoverageRun({ event, files }) {
  if (event !== "push") return false;
  return files === null || files.length > 0;
}

function changedCode(base, head) {
  try {
    return withoutDocumentation(base, head)?.files ?? null;
  } catch {
    // A base Git cannot read is no base: everything may have changed.
    return null;
  }
}

function main(env, argv) {
  const event = env.EVENT ?? "";
  const [base = "", head = "HEAD"] = argv;
  const files = event === "push" ? changedCode(base, head) : [];
  const full = fullCoverageRun({ event, files });
  if (event !== "push") {
    process.stderr.write(`A ${event || "run"} event: the coverage of what it ran is enough.\n`);
  } else if (files === null) {
    process.stderr.write("No comparison base: every package's tests run for the full figure.\n");
  } else if (full) {
    process.stderr.write(
      `${String(files.length)} changed files are not documentation: every package's tests run.\n`,
    );
  } else {
    process.stderr.write(
      "Only documentation changed: the figure cannot change, so the full run and the site are skipped.\n",
    );
  }
  process.stdout.write(`full-run=${String(full)}\n`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = main(process.env, process.argv.slice(2));
}
