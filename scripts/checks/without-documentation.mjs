// A change without its documentation (docs/testing.md, CI): documentation never counts as a change
// of an app or package, so CI and the release plan decide what a change affects on the change with
// its documentation left out. Which files are documentation: harness/lib/documentation.mjs, the
// rule the developer handoff hook applies too. Plain Node, no dependencies.
//
// Usage, from the repository root:
//   node scripts/checks/without-documentation.mjs head <base> [<head>]
//     Prints a commit to compare <base> with instead of <head> (default HEAD): the tree of <head>
//     with every documentation file put back as it was at the merge base of <base> and <head>, as
//     a child of <head>. Turborepo's `--affected` and `turbo query affected` then see only the
//     files that are not documentation (TURBO_SCM_HEAD). It is <head> itself when no documentation
//     changed, and also when <base> is empty, all zeros or not in the history, which Turborepo then
//     treats as every package affected. The same change always gives the same commit.
//   node scripts/checks/without-documentation.mjs files <base> [<head>]
//     Prints the files <base>...<head> changes that are not documentation, one per line. Exits 1,
//     printing nothing, when <base> cannot be resolved, so a caller runs everything.
// Both explain themselves on standard error. Exits 2 on wrong usage.
//
// Why a commit and not Turborepo's task `inputs`: Turborepo 2.11 selects affected packages by any
// file changed in the package folder and ignores `inputs` for that, so a README edit would still
// select its package and every package that depends on it.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { isDocumentation } from "../../harness/lib/documentation.mjs";

/** Whether a changed file is documentation: the one rule, shared with the handoff hook. */
export { isDocumentation };

const USAGE =
  "Usage: without-documentation head|files <base> [<head>]\n" +
  "  head:  a commit like <head> with its documentation changes left out, for TURBO_SCM_HEAD\n" +
  "  files: the changed files that are not documentation\n";

// A fixed identity and date: the runners have no Git user, and the same change gives the same
// commit.
const IDENTITY = {
  GIT_AUTHOR_NAME: "documentation filter",
  GIT_AUTHOR_EMAIL: "documentation-filter@example.invalid",
  GIT_AUTHOR_DATE: "@0 +0000",
  GIT_COMMITTER_NAME: "documentation filter",
  GIT_COMMITTER_EMAIL: "documentation-filter@example.invalid",
  GIT_COMMITTER_DATE: "@0 +0000",
};

class GitError extends Error {}

function git(args, { cwd, env = {}, input } = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    input,
    env: { ...process.env, ...env },
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new GitError(`git ${args.join(" ")} failed: ${(result.stderr ?? "").trim()}`);
  }
  return result.stdout;
}

const nul = (text) => text.split("\0").filter(Boolean);

/** The merge base of base and head, or null when there is no usable base. */
function mergeBase(base, head, cwd) {
  if (!base || /^0+$/.test(base)) return null;
  try {
    return git(["merge-base", base, head], { cwd }).trim();
  } catch (error) {
    if (error instanceof GitError) return null;
    throw error;
  }
}

/** The files mergeBase...head changes, each side of a rename on its own. */
function changedFiles(from, head, cwd) {
  return nul(git(["diff", "--name-only", "--no-renames", "-z", from, head], { cwd }));
}

/** A child of head whose tree has the given files as they are at `from`. */
function restored(head, from, files, cwd) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "without-documentation-"));
  const env = { GIT_INDEX_FILE: path.join(folder, "index") };
  try {
    git(["read-tree", head], { cwd, env });
    const before = new Map(
      nul(git(["ls-tree", "-z", from, "--", ...files], { cwd })).map((entry) => {
        const [info, file] = entry.split("\t");
        const [mode, , object] = info.split(" ");
        return [file, `${mode} ${object}`];
      }),
    );
    const lines = files.map((file) => `${before.get(file) ?? `0 ${"0".repeat(40)}`}\t${file}\0`);
    git(["update-index", "-z", "--index-info"], { cwd, env, input: lines.join("") });
    // The documentation's old content may be missing from a partial clone; its name is enough.
    const tree = git(["write-tree", "--missing-ok"], { cwd, env }).trim();
    return git(["commit-tree", tree, "-p", head, "-m", "The change without its documentation"], {
      cwd,
      env: IDENTITY,
    }).trim();
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
}

/**
 * The change base...head without its documentation: `head`, the commit to compare with instead of
 * head; `files`, the changed files that are not documentation; `documentation`, the ones left out.
 * Null when the base cannot be resolved. Runs Git in `cwd`, by default the current directory.
 */
export function withoutDocumentation(base, head = "HEAD", { cwd } = {}) {
  const headCommit = git(["rev-parse", "--verify", `${head}^{commit}`], { cwd }).trim();
  const from = mergeBase(base, headCommit, cwd);
  if (from === null) return null;
  const changed = changedFiles(from, headCommit, cwd);
  const documentation = changed.filter(isDocumentation);
  const files = changed.filter((file) => !isDocumentation(file));
  const commit =
    documentation.length === 0 ? headCommit : restored(headCommit, from, documentation, cwd);
  return { head: commit, files, documentation };
}

function main(argv) {
  const [command, base, head = "HEAD"] = argv;
  if (!["head", "files"].includes(command) || argv.length < 2 || argv.length > 3) {
    process.stderr.write(USAGE);
    return 2;
  }
  let change;
  try {
    change = withoutDocumentation(base, head);
  } catch (error) {
    if (!(error instanceof GitError)) throw error;
    process.stderr.write(`${error.message}\n`);
    return 1;
  }
  if (change === null) {
    process.stderr.write(`No comparison base (${base || "none"}): nothing is left out.\n`);
    if (command === "files") return 1;
    process.stdout.write(`${git(["rev-parse", "--verify", `${head}^{commit}`]).trim()}\n`);
    return 0;
  }
  if (change.documentation.length === 0) {
    process.stderr.write("No documentation changed.\n");
  } else {
    process.stderr.write("Documentation, which counts as no change of an app or package:\n");
    for (const file of change.documentation) process.stderr.write(`  ${file}\n`);
  }
  process.stderr.write(
    `${String(change.files.length)} changed files are not documentation${change.files.length > 0 ? ":" : "."}\n`,
  );
  for (const file of change.files) process.stderr.write(`  ${file}\n`);
  process.stdout.write(
    command === "head" ? `${change.head}\n` : change.files.map((file) => `${file}\n`).join(""),
  );
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = main(process.argv.slice(2));
}
