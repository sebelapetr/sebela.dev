// Whether an event may start paid model evals by itself (.github/workflows/model-evals.yml;
// docs/testing.md, CI). Plain Node, no dependencies.
//
// Usage: EVENT=<event name> HEAD_REF=<head branch> node scripts/checks/paid-evals-trigger.mjs
// Prints `paid-evals=true` or `paid-evals=false` on stdout, for $GITHUB_OUTPUT; the reason goes to
// stderr. Always exits 0: an unknown or missing event is a "no".
//
// Paid evals may start:
// - on a phase pull request: a `pull_request` event whose head branch is `phase/<phase-folder>`
//   (docs/git-workflow.md, Branches). The workflow itself limits the event to pull requests into
//   the main branch that are opened, reopened or marked ready for review and are not drafts;
// - by hand (`workflow_dispatch`), which is how a suite runs for any other change.
// Every other pull request starts none, whatever it changes: a maintenance change (a dependency
// update, a contract example, a comment) used to run a whole suite, each run charged (#337). Which
// suites a phase pull request then runs is decided per suite (mcp-admin-evals-affected.mjs).
//
// The head branch is text a contributor chooses. It is only compared here and never printed to
// stdout, so it cannot add lines to the output file.

import { pathToFileURL } from "node:url";

const PHASE_BRANCH = /^phase\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Whether `event` with the pull request's head branch `headRef` may start paid model evals. */
export function startsPaidEvals({ event, headRef }) {
  if (event === "workflow_dispatch") return true;
  return event === "pull_request" && typeof headRef === "string" && PHASE_BRANCH.test(headRef);
}

function main(env) {
  const event = env.EVENT ?? "";
  const headRef = env.HEAD_REF ?? "";
  const starts = startsPaidEvals({ event, headRef });
  if (event === "workflow_dispatch") {
    process.stderr.write("Started by hand: paid model evals may run.\n");
  } else if (starts) {
    process.stderr.write(
      `Phase pull request from ${headRef}: the suites it affects run their paid model evals.\n`,
    );
  } else {
    process.stderr.write(
      "This is not a phase pull request (head branch phase/<phase-folder>), so no paid model " +
        "evals start. When a change needs a suite, run it by hand: Actions, Model evals, Run " +
        "workflow, or `gh workflow run model-evals.yml --ref <branch> -f suite=<suite>`. " +
        "Every run is charged.\n",
    );
  }
  process.stdout.write(`paid-evals=${String(starts)}\n`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = main(process.env);
}
