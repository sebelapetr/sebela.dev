// The checks a developer agent must pass before it hands off its work: lint and typecheck of the
// parts it changed, in the worktree it changed them in (docs/permissions.md, "Hooks"). A general
// agent passes the same checks when it changed CI, script, infrastructure or harness files.
//
// checkHandoff finds the worktrees from the agent's own actions (files it edited or wrote, commands
// it ran) and the session's directory, selects in each the workspace packages changed since the
// branch left its phase branch (or master), and runs their `lint` and `typecheck` with their
// dependents, plus the root lint tasks, through the worktree's own Turborepo. Tests stay with CI.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { checkoutOf, missingTools, runTool } from "./workspace-tools.mjs";
import { isDocumentation } from "./documentation.mjs";

// Tools whose calls change files or run commands; reading a worktree does not make it the agent's.
const ACTING_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit", "Bash"]);
// Changes to these affect every package (Turborepo treats them the same way).
const WORKSPACE_FILES = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "turbo.json",
  ".nvmrc",
]);
const MEMBER_FOLDERS = ["apps", "packages"];
// What no developer agent owns and a general agent changes (docs/agents.md, Roles): CI, scripts,
// infrastructure and the harness. A general agent's handoff is checked when it changed these.
export const GENERAL_AGENT_AREAS = Object.freeze([".github/", "scripts/", "infra/", "harness/"]);
// The branches an issue branch is cut from (docs/git-workflow.md).
const BASE_REFS = [
  "refs/heads/master",
  "refs/heads/main",
  "refs/heads/phase",
  "refs/remotes/origin/master",
  "refs/remotes/origin/main",
  "refs/remotes/origin/phase",
];
const TIMEOUT_MS = 15 * 60 * 1000;
const REPORT_LINES = 150;

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function stringsIn(value, found = []) {
  if (typeof value === "string") found.push(value);
  else if (value && typeof value === "object")
    for (const item of Object.values(value)) stringsIn(item, found);
  return found;
}

// What changes files for certain: the edit tools, and a shell command that runs `git commit`.
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const GIT_COMMIT = /(?:^|[\s;&|(])git(?:\s+-[Cc]\s+\S+|\s+--?[\w-]+(?:=\S+)?)*\s+commit(?=\s|$)/;
const editsOrCommits = (block) =>
  EDIT_TOOLS.has(block.name) ||
  (block.name === "Bash" && GIT_COMMIT.test(String(block.input?.command ?? "")));

function* toolUses(transcriptText) {
  for (const line of String(transcriptText).split("\n")) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry?.type !== "assistant" || !Array.isArray(entry.message?.content)) continue;
    for (const block of entry.message.content) {
      if (block?.type === "tool_use") yield block;
    }
  }
}

// Whether the transcript records an edit or a commit anywhere.
export function actedIn(transcriptText) {
  for (const block of toolUses(transcriptText)) if (editsOrCommits(block)) return true;
  return false;
}

// Worktree folders `<mainRoot>/.worktrees/<name>` named in the tool calls a transcript records, in
// order of first appearance. Only acting tools count; prompts, tool results and reads do not.
// With `editsOnly`, only edits and commits count: a command that tests, lists or searches in a
// worktree does not make it the agent's.
export function worktreesNamedIn(transcriptText, mainRoot, { editsOnly = false } = {}) {
  // The path must start where a path can start, so `/x/<mainRoot>/...` does not count.
  const pattern = new RegExp(
    `(?<![\\w.~/-])${escapeRegExp(path.join(mainRoot, ".worktrees"))}/([^/\\s'"\`;&|()<>\\\\]+)`,
    "g",
  );
  const found = [];
  for (const block of toolUses(transcriptText)) {
    if (editsOnly ? !editsOrCommits(block) : !ACTING_TOOLS.has(block.name)) continue;
    for (const text of stringsIn(block.input)) {
      for (const [, name] of text.matchAll(pattern)) {
        const root = path.join(mainRoot, ".worktrees", name);
        if (!name.startsWith(".") && !found.includes(root)) found.push(root);
      }
    }
  }
  return found;
}

// What to check for the changed files (paths relative to the checkout): null when nothing changed,
// { all: true } when the change base is unknown (null) or workspace-wide configuration changed,
// otherwise { all: false, packages } with the names of the changed members, sorted. Root files
// need no package and documentation (documentation.mjs) counts as no change; the root checks
// always run. With `areas` (path prefixes) there is something to check only when a changed file
// lies in one of them; an unknown change base still selects everything.
export function selectChecks(changedFiles, members, { areas = null } = {}) {
  if (changedFiles === null) return { all: true };
  if (!changedFiles.length) return null;
  if (areas && !changedFiles.some((file) => areas.some((area) => file.startsWith(area)))) {
    return null;
  }
  const packages = new Set();
  for (const file of changedFiles) {
    if (WORKSPACE_FILES.has(file)) return { all: true };
    if (isDocumentation(file)) continue;
    const member = members.find((candidate) => file.startsWith(`${candidate.dir}/`));
    if (member) packages.add(member.name);
  }
  return { all: false, packages: [...packages].sort() };
}

// Turborepo arguments for a selection: lint and typecheck of the selected packages and their
// dependents, the root lint and the hard-coded configuration check.
export function turboArguments(selection) {
  const args = [
    "run",
    "lint",
    "typecheck",
    "lint:root",
    "check:config",
    "--continue",
    "--output-logs=errors-only",
  ];
  if (selection.all) return args;
  return [...args, "--filter=//", ...selection.packages.map((name) => `--filter=${name}...`)];
}

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 1 << 28,
  });
}

// The merge base with the nearest branch the issue branch can have been cut from, or null.
function changeBase(root) {
  const current = git(root, ["symbolic-ref", "-q", "HEAD"]).trim();
  const refs = git(root, ["for-each-ref", "--format=%(refname)", ...BASE_REFS])
    .split("\n")
    .filter((ref) => ref && ref !== current && !ref.endsWith("/HEAD"));
  let best = null;
  for (const ref of refs) {
    let base;
    try {
      base = git(root, ["merge-base", "HEAD", ref]).trim();
    } catch {
      continue;
    }
    const distance = Number(git(root, ["rev-list", "--count", `${base}..HEAD`]).trim());
    if (best === null || distance < best.distance) best = { base, distance };
  }
  return best?.base ?? null;
}

// Files changed since the change base, committed or not, plus untracked files; null when there
// is no base to compare with.
function changedFiles(root) {
  let base;
  try {
    base = changeBase(root);
  } catch {
    base = null;
  }
  if (!base) return null;
  const list = (args) => git(root, args).split("\0").filter(Boolean);
  const files = new Set([
    ...list(["diff", "--name-only", "-z", "--no-renames", base]),
    ...list(["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
  return [...files];
}

function workspaceMembers(root) {
  const members = [];
  for (const folder of MEMBER_FOLDERS) {
    let entries = [];
    try {
      entries = fs.readdirSync(path.join(root, folder), { withFileTypes: true });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = `${folder}/${entry.name}`;
      try {
        const { name } = JSON.parse(fs.readFileSync(path.join(root, dir, "package.json"), "utf8"));
        if (name) members.push({ dir, name });
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  }
  return members;
}

const tail = (text) => text.split("\n").slice(-REPORT_LINES).join("\n");

// Runs the handoff checks. `transcriptText` is the agent's transcript, `cwd` the directory its
// session runs in. Returns { results } with one { worktree, command, ok, report } per worktree
// that has changes; no results when the agent changed nothing. With `areas`, a worktree is checked
// only when its changes touch one of those path prefixes (selectChecks). With `editsOnly` (a
// general agent, which also researches and reviews), a worktree is the agent's only when it
// edited or committed there, and the session's folder only when it edited or committed at all.
// Throws when the worktrees or their changes cannot be determined.
export function checkHandoff({
  mainRoot,
  cwd,
  transcriptText,
  env = process.env,
  areas = null,
  editsOnly = false,
}) {
  const roots = [];
  const session = !editsOnly || actedIn(transcriptText) ? [cwd] : [];
  for (const candidate of [
    ...session,
    ...worktreesNamedIn(transcriptText, mainRoot, { editsOnly }),
  ]) {
    if (!candidate || !fs.existsSync(candidate)) continue;
    const root = checkoutOf(candidate, mainRoot);
    // The main checkout holds no developer work (docs/git-workflow.md); only worktrees are checked.
    if (root && fs.realpathSync(root) !== fs.realpathSync(mainRoot) && !roots.includes(root))
      roots.push(root);
  }

  const results = [];
  for (const worktree of roots) {
    const selection = selectChecks(changedFiles(worktree), workspaceMembers(worktree), { areas });
    if (!selection) continue;
    const args = turboArguments(selection);
    const command = `turbo ${args.join(" ")}`;
    const missing = missingTools(worktree, ["turbo"]);
    if (missing) {
      results.push({ worktree, command, ok: false, report: missing });
      continue;
    }
    const run = runTool(worktree, "turbo", args, { env, timeout: TIMEOUT_MS });
    results.push({ worktree, command, ok: run.status === 0, report: tail(run.output) });
  }
  return { results };
}
