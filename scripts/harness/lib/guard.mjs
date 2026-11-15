// Rules enforced before a tool call (the PreToolUse hook). Pure: the caller supplies the facts.
// Intent and reasons: docs/permissions.md.

import path from "node:path";

const FILE_EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const FILE_READ_TOOLS = new Set(["Read", "Grep", "Glob"]);
const PROTECTED_BRANCHES = new Set(["master", "main"]);

// A command counts only where it is actually invoked: at the start, or after ; & | ( or a newline.
// Text that merely mentions it (an argument, a heredoc) does not count.
// Leading variable assignments (FOO=bar cmd) and `env` still leave the command in command position.
const AT_COMMAND = String.raw`(?:^|[;&|(\n]\s*)(?:env\s+)?(?:\w+=\S*\s+)*`;
const GIT_OPTIONS = String.raw`(?:\s+(?:-C\s+\S+|-c\s+\S+|--git-dir=\S+|--work-tree=\S+))*`;
const PUSH = new RegExp(`${AT_COMMAND}git${GIT_OPTIONS}\\s+push\\b[^;&|\\n]*`);
const MERGE = new RegExp(`${AT_COMMAND}gh\\s+pr\\s+merge\\b[^;&|\\n]*`);

export function invokesPrMerge(command) {
  return MERGE.test(String(command ?? ""));
}

const ENV_FILE_NAME = /^\.env(\..+)?$/;
const ENV_IN_COMMAND = /(^|[\s'"=/<>|;&(])\.env(?!\.example(?![\w.-]))(\.[\w.-]+)?(?=$|[\s'";&|)<>])/;
const CONTEXT_IN_COMMAND = /(^|[\s'"=/<>|;&(])\.context(\/|(?=$|[\s'";&|)<>]))/;

function isInside(child, parent) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function filePathOf(toolInput) {
  return toolInput?.file_path ?? toolInput?.notebook_path ?? toolInput?.path ?? null;
}

function isEnvFile(filePath) {
  const name = path.basename(filePath);
  return ENV_FILE_NAME.test(name) && name !== ".env.example";
}

function deny(reason) {
  return { reason };
}

// Grep's glob and Glob's pattern can reach files that the searched directory does not name.
function checkSearchPattern({ toolName, toolInput, restricted }) {
  const pattern = toolName === "Grep" ? toolInput?.glob : toolName === "Glob" ? toolInput?.pattern : null;
  if (!pattern) return null;
  const segments = String(pattern).split(/[\\/]/);
  if (segments.some((segment) => segment.startsWith(".env") && segment !== ".env.example")) {
    return deny("Environment files are off limits; only .env.example may be read (docs/permissions.md).");
  }
  const contextAt = segments.indexOf(".context");
  if (restricted && contextAt !== -1 && segments.slice(contextAt + 1).join("/") !== "README.md") {
    return deny(".context/ holds the owner's private notes; agents do not read it (docs/permissions.md).");
  }
  return null;
}

// The harness that governs the loop. Unattended runs change it only inside a worktree, through a
// pull request; never in the main checkout, and never inside any .git directory.
const HARNESS_DIRS = [".claude", ".github", path.join("scripts", "harness")];
const HARNESS_IN_COMMAND = /(^|[\s'"=/<>|;&(])(\.claude\/settings|\.git\/(hooks|config)\b)/;

function isHarnessFile(filePath, mainRoot) {
  if (filePath.split(path.sep).includes(".git")) return true;
  if (isInside(filePath, path.join(mainRoot, ".worktrees"))) return false;
  return HARNESS_DIRS.some((dir) => isInside(filePath, path.join(mainRoot, dir)));
}

function checkFileTool({ toolName, toolInput, mainRoot, cwd, restricted, unattended, realpath }) {
  const fromPattern = checkSearchPattern({ toolName, toolInput, restricted });
  if (fromPattern) return fromPattern;
  const raw = filePathOf(toolInput);
  if (!raw) return null;
  // Where the file really is, past any symbolic link.
  const filePath = realpath(path.resolve(cwd ?? mainRoot, raw));

  if (isEnvFile(filePath)) {
    return deny("Environment files are off limits; only .env.example may be read (docs/permissions.md).");
  }

  const contextDir = path.join(mainRoot, ".context");
  if (
    restricted &&
    isInside(filePath, contextDir) &&
    filePath !== path.join(contextDir, "README.md")
  ) {
    return deny(".context/ holds the owner's private notes; agents do not read it (docs/permissions.md).");
  }

  if (FILE_EDIT_TOOLS.has(toolName) && unattended && isHarnessFile(filePath, mainRoot)) {
    return deny("The phase loop does not change the harness in the main checkout or inside .git (docs/permissions.md).");
  }

  if (FILE_EDIT_TOOLS.has(toolName)) {
    const worktrees = path.join(mainRoot, ".worktrees");
    const inCode =
      isInside(filePath, path.join(mainRoot, "apps")) ||
      isInside(filePath, path.join(mainRoot, "packages"));
    if (inCode && !isInside(filePath, worktrees)) {
      return deny(
        "App and package code is never edited in the main checkout. Create a worktree for the issue (docs/git-workflow.md).",
      );
    }
  }
  return null;
}

// "+refs/heads/master", "HEAD:master", "master" all name master. HEAD is the checked-out branch.
function branchNamedBy(ref, currentBranch) {
  const name = ref.replace(/^\+/, "").replace(/^refs\/heads\//, "");
  return name === "HEAD" ? currentBranch : name;
}

// What the phase loop never needs: changing the repository's settings, secrets or credentials.
const UNATTENDED_FORBIDDEN = new RegExp(
  `${AT_COMMAND}(gh\\s+(api|repo|secret|auth|label|workflow|ruleset|variable)\\b|git\\s+config\\b)`,
);

// The command may run somewhere other than the directory the hook looked at.
const MOVES = /(^|[;&|(\n]\s*)(cd|pushd)\s|\s-C\s|--git-dir=|--work-tree=|\bGIT_DIR=|\bGIT_WORK_TREE=/;

function checkPush(fullCommand, { currentBranch }) {
  const command = fullCommand.match(PUSH)?.[0]?.replace(/['"]/g, "");
  if (!command) return null;
  if (/\s--(all|mirror|branches)\b/.test(command)) {
    return deny("Push one named branch, not all of them (docs/git-workflow.md).");
  }
  if (/\s(--force(-with-lease)?|-f)(\s|=|$)/.test(command) || /[\s:]\+[\w/.-]+/.test(command)) {
    return deny("Force-pushing is not allowed (docs/git-workflow.md).");
  }
  const masterRefused = deny("Nobody but the owner changes master; push your issue or phase branch instead.");
  // After "git push": options, then the remote, then refspecs.
  const afterPush = command.slice(command.search(/\spush\b/) + 5);
  const positional = afterPush.trim().split(/\s+/).filter((part) => part && !part.startsWith("-"));
  const refspecs = positional.slice(1);
  const branchKnown = Boolean(currentBranch) && !MOVES.test(fullCommand);
  const unknownBranch = deny("Name the branch to push explicitly (git push origin <branch>).");
  if (refspecs.length === 0) {
    // A bare push goes to the upstream of the checked-out branch.
    if (!branchKnown) return unknownBranch;
    return PROTECTED_BRANCHES.has(currentBranch) ? masterRefused : null;
  }
  const refs = refspecs.flatMap((spec) => spec.split(":"));
  if (!branchKnown && refs.some((ref) => ref.replace(/^\+/, "") === "HEAD")) return unknownBranch;
  const destinations = refs.map((ref) => branchNamedBy(ref, currentBranch));
  return destinations.some((name) => PROTECTED_BRANCHES.has(name)) ? masterRefused : null;
}

function checkMerge(fullCommand, { isSubagent, lookupPrBase }) {
  const command = fullCommand.match(MERGE)?.[0];
  if (!command) return null;
  if (isSubagent) {
    return deny("Only the orchestrator merges, and only into a phase branch.");
  }
  if (/\s(--repo|-R)(\s|=)/.test(command) || /https?:\/\//.test(command) || /\bGH_(REPO|HOST)=/.test(fullCommand)) {
    return deny("Merge pull requests of this repository only, by number.");
  }
  const number = command.match(/\bgh\s+pr\s+merge\s+(?:[^\s-]\S*\s+)*?(\d+)\b/)?.[1];
  if (!number) {
    return deny("Name the pull request number explicitly so its base branch can be checked.");
  }
  let base = null;
  try {
    base = lookupPrBase(Number(number));
  } catch {
    base = null;
  }
  if (!base) return deny(`Could not confirm the base branch of #${number}; not merging.`);
  if (PROTECTED_BRANCHES.has(base)) {
    return deny("Pull requests into master are merged by the owner only.");
  }
  if (!/--squash\b/.test(command)) {
    return deny("Issue pull requests are merged into the phase branch with --squash.");
  }
  return null;
}

// Returns null when the call may proceed, or { reason } when it must be refused.
//   toolName, toolInput   from the hook input
//   mainRoot              absolute path of the main checkout
//   cwd                   directory the session runs in
//   isSubagent            the call comes from a subagent
//   unattended            the call comes from the phase loop
//   lookupPrBase(number)  returns the base branch of a pull request
//   currentBranch         branch checked out where the command runs
//   realpath(path)        resolves symbolic links (the hook passes a real one)
export function evaluateToolCall({
  toolName,
  toolInput,
  mainRoot,
  cwd,
  isSubagent = false,
  unattended = false,
  lookupPrBase = () => null,
  currentBranch = null,
  realpath = (p) => p,
}) {
  const restricted = isSubagent || unattended;

  if (FILE_EDIT_TOOLS.has(toolName) || FILE_READ_TOOLS.has(toolName)) {
    return checkFileTool({ toolName, toolInput, mainRoot, cwd, restricted, unattended, realpath });
  }

  if (toolName === "Bash") {
    const command = String(toolInput?.command ?? "");
    if (ENV_IN_COMMAND.test(command)) {
      return deny("Environment files are off limits; only .env.example may be read (docs/permissions.md).");
    }
    if (unattended && HARNESS_IN_COMMAND.test(command)) {
      return deny("The phase loop does not change the harness in the main checkout or inside .git (docs/permissions.md).");
    }
    if (unattended && UNATTENDED_FORBIDDEN.test(command)) {
      return deny("The phase loop does not change repository settings, secrets or credentials (docs/permissions.md).");
    }
    if (restricted && CONTEXT_IN_COMMAND.test(command)) {
      return deny(".context/ holds the owner's private notes; agents do not read it (docs/permissions.md).");
    }
    return checkPush(command, { currentBranch }) ?? checkMerge(command, { isSubagent, lookupPrBase });
  }

  return null;
}
