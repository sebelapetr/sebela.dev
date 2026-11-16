// Formats and lints the staged files of a commit for the pre-commit hook
// (docs/git-workflow.md, "Local hooks").
//
// What is checked is what will be committed: the staged content of every added or modified
// regular file. Prettier formats every file it supports, with the shared configuration and the
// checkout's ignore files; ESLint then checks the staged JavaScript and TypeScript files. Nothing
// else runs here: typecheck and tests belong to the handoff checks and CI.
//
// Unstaged work is never touched. A file whose working copy equals its staged content is formatted
// in place and staged again. A partially staged file is formatted from its staged content
// straight into the index, so its working copy keeps every unstaged edit as it was. File names
// travel NUL-separated or after `--`, never through a shell or as patterns.

import { spawnSync } from "node:child_process";
import { missingTools, runTool } from "./workspace-tools.mjs";

const REGULAR_FILE = new Set(["100644", "100755"]);
const LINTED = /\.(?:js|mjs|cjs|jsx|ts|tsx|mts|cts)$/;
const CHUNK = 100;

function git(root, args, input) {
  const run = spawnSync("git", args, { cwd: root, input, maxBuffer: 1024 * 1024 * 1024 });
  if (run.error) throw run.error;
  if (run.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${run.stderr.toString("utf8").trim()}`);
  }
  return run.stdout;
}

const nulSeparated = (buffer) => buffer.toString("utf8").split("\0").filter(Boolean);

// Added, modified and type-changed regular files of the index, with mode and blob.
function stagedFiles(root) {
  const fields = nulSeparated(
    git(root, [
      "diff",
      "--cached",
      "--raw",
      "-z",
      "--no-renames",
      "--no-abbrev",
      "--diff-filter=AMT",
    ]),
  );
  const files = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const [, mode, , blob] = fields[i].slice(1).split(" ");
    if (REGULAR_FILE.has(mode)) files.push({ path: fields[i + 1], mode, blob });
  }
  return files;
}

function chunks(items) {
  const result = [];
  for (let i = 0; i < items.length; i += CHUNK) result.push(items.slice(i, i + CHUNK));
  return result;
}

// Formats files whose working copy is the staged content, then stages the result.
function formatWhole(root, files, problems) {
  if (!files.length) return;
  for (const chunk of chunks(files.map((file) => file.path))) {
    const run = runTool(root, "prettier", [
      "--write",
      "--ignore-unknown",
      "--log-level=warn",
      "--",
      ...chunk,
    ]);
    if (run.status !== 0) problems.push(run.output || `prettier exited with ${run.status}`);
  }
  git(root, ["update-index", "-z", "--stdin"], files.map((file) => `${file.path}\0`).join(""));
}

// Formats the staged content of a partially staged file and replaces only its index entry.
function formatStaged(root, file, problems) {
  const info = runTool(root, "prettier", [`--file-info=${file.path}`]);
  if (info.status !== 0) {
    problems.push(info.output || `prettier --file-info exited with ${info.status}`);
    return;
  }
  const { ignored, inferredParser } = JSON.parse(info.stdout.toString("utf8"));
  if (ignored || !inferredParser) return;
  const content = git(root, ["cat-file", "blob", file.blob]);
  const run = runTool(root, "prettier", [`--stdin-filepath=${file.path}`], { input: content });
  if (run.status !== 0) {
    problems.push(run.output || `prettier exited with ${run.status} on ${file.path}`);
    return;
  }
  if (run.stdout.equals(content)) return;
  const blob = git(root, ["hash-object", "-w", "--stdin"], run.stdout).toString("utf8").trim();
  git(root, ["update-index", "-z", "--index-info"], `${file.mode} ${blob}\t${file.path}\0`);
  file.blob = blob;
}

function lint(root, whole, partial, problems) {
  for (const chunk of chunks(
    whole.filter((file) => LINTED.test(file.path)).map((file) => file.path),
  )) {
    const run = runTool(root, "eslint", ["--no-warn-ignored", "--", ...chunk]);
    if (run.status !== 0) problems.push(run.output || `eslint exited with ${run.status}`);
  }
  for (const file of partial.filter((entry) => LINTED.test(entry.path))) {
    const content = git(root, ["cat-file", "blob", file.blob]);
    const run = runTool(
      root,
      "eslint",
      ["--no-warn-ignored", "--stdin", `--stdin-filename=${file.path}`],
      {
        input: content,
      },
    );
    if (run.status !== 0)
      problems.push(run.output || `eslint exited with ${run.status} on ${file.path}`);
  }
}

// Formats and lints the staged files of the checkout at `root`, the worktree being committed in.
// Returns { ok, report }; `report` holds the tool output a developer needs to fix the commit.
// Throws when Git itself fails.
export function checkStagedFiles({ root }) {
  const staged = stagedFiles(root);
  if (!staged.length) return { ok: true, report: "" };
  const missing = missingTools(root, ["prettier", "eslint"]);
  if (missing) return { ok: false, report: missing };

  const unstaged = new Set(nulSeparated(git(root, ["diff", "--name-only", "-z", "--no-renames"])));
  const whole = staged.filter((file) => !unstaged.has(file.path));
  const partial = staged.filter((file) => unstaged.has(file.path));

  const problems = [];
  formatWhole(root, whole, problems);
  for (const file of partial) formatStaged(root, file, problems);
  if (!problems.length) lint(root, whole, partial, problems);
  return { ok: problems.length === 0, report: problems.join("\n\n") };
}
