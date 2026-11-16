#!/usr/bin/env node
// Git pre-commit hook (started by ./pre-commit): formats and lints the staged files of the
// worktree the commit is made in. Behaviour: ../lib/staged-files.mjs. Typecheck and tests are not
// run here; they run at the developer handoff and in CI.

import { execFileSync } from "node:child_process";
import { checkStagedFiles } from "../lib/staged-files.mjs";

try {
  // Git starts the hook in the top level of the worktree being committed in.
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const { ok, report } = checkStagedFiles({ root });
  if (!ok) {
    process.stderr.write(
      `pre-commit: the staged files did not pass formatting and lint.\n\n${report}\n\n` +
        "Fix the problems, stage the files again and commit again.\n",
    );
    process.exit(1);
  }
} catch (error) {
  process.stderr.write(`pre-commit hook failed: ${error.message}\n`);
  process.exit(1);
}
