#!/usr/bin/env node
// Fails when a tracked file is not formatted as the commit hook would format it, so a commit made
// without the hooks, or a file changed in the GitHub web editor, cannot land unformatted
// (docs/git-workflow.md, "Local hooks"; docs/testing.md, CI).
//
//   node scripts/checks/formatting.mjs     the working copy of every tracked file, from any folder
//
// The file set is the hook's: every tracked regular file, given to the checkout's own Prettier with
// `--ignore-unknown`, so the shared configuration, `.prettierignore` (lockfile and generated
// folders) and `.gitignore` apply exactly as they do on a commit, and file types Prettier does not
// support are skipped. Untracked files, symbolic links and files deleted from the working copy are
// left out. Nothing is changed. Exits with 1 when a file is not formatted or cannot be parsed, 2
// when the check cannot run. Plain Node; Prettier is the workspace's (`pnpm install`).

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { missingTools, runTool } from "../../harness/lib/workspace-tools.mjs";

const REGULAR_FILE = new Set(["100644", "100755"]);
// Paths per Prettier call: every start loads Prettier again, so few large calls, well below the
// command-line length limit.
const CHUNK = 1000;

function git(cwd, args) {
  const run = spawnSync("git", args, { cwd, maxBuffer: 1024 * 1024 * 1024 });
  if (run.error) throw run.error;
  if (run.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${run.stderr.toString("utf8").trim()}`);
  }
  return run.stdout.toString("utf8");
}

// Tracked regular files that exist in the working copy, relative to the checkout's top level.
function trackedFiles(root) {
  const files = new Set();
  for (const entry of git(root, ["ls-files", "-z", "--stage"]).split("\0")) {
    if (!entry) continue;
    const tab = entry.indexOf("\t");
    const [mode] = entry.slice(0, tab).split(" ");
    const file = entry.slice(tab + 1);
    if (
      REGULAR_FILE.has(mode) &&
      fs.lstatSync(path.join(root, file), { throwIfNoEntry: false })?.isFile()
    ) {
      files.add(file);
    }
  }
  return [...files];
}

function main() {
  const root = git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
  const missing = missingTools(root, ["prettier"]);
  if (missing) {
    process.stderr.write(`Formatting check cannot run: ${missing}\n`);
    return 2;
  }

  const files = trackedFiles(root);
  const problems = [];
  for (let i = 0; i < files.length; i += CHUNK) {
    const run = runTool(root, "prettier", [
      "--check",
      "--ignore-unknown",
      "--log-level=warn",
      "--",
      ...files.slice(i, i + CHUNK),
    ]);
    if (run.status !== 0) problems.push(run.output || `prettier exited with ${run.status}`);
  }

  if (!problems.length) {
    process.stdout.write(
      `Formatting check: ${files.length} tracked files checked, all formatted.\n`,
    );
    return 0;
  }
  process.stderr.write(
    `${problems.join("\n")}\n\nFormatting check: the files above are not formatted or cannot be ` +
      "parsed. Format them with `pnpm exec prettier --write -- <file>...` (the commit hook does " +
      "this for staged files) and commit them.\n",
  );
  return 1;
}

try {
  process.exitCode = main();
} catch (error) {
  process.stderr.write(`Formatting check cannot run: ${error.message}\n`);
  process.exitCode = 2;
}
