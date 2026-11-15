// Rules enforced before a tool call (the PreToolUse hook). Pure: the caller supplies the facts.
// Intent and reasons: docs/permissions.md.

import path from "node:path";

const FILE_EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const FILE_READ_TOOLS = new Set(["Read", "Grep", "Glob"]);
const PROTECTED_BRANCHES = new Set(["master", "main"]);

// A command counts only where it is actually invoked: at the start, or after ; & | ( or a newline.
// Text that merely mentions it (an argument, a heredoc) does not count.
const AT_COMMAND = String.raw`(?:^|[;&|(\n]\s*)`;
const PUSH = new RegExp(`${AT_COMMAND}git\\s+push\\b[^;&|\\n]*`);
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

function checkFileTool({ toolName, toolInput, mainRoot, cwd, restricted }) {
  const raw = filePathOf(toolInput);
  if (!raw) return null;
  const filePath = path.resolve(cwd ?? mainRoot, raw);

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

function checkPush(fullCommand) {
  const command = fullCommand.match(PUSH)?.[0];
  if (!command) return null;
  if (/\s(--force(-with-lease)?|-f)(\s|=|$)/.test(command) || /\s\+[\w/.-]+/.test(command)) {
    return deny("Force-pushing is not allowed (docs/git-workflow.md).");
  }
  const targets = command.trim().split(/\s+/).flatMap((part) => part.split(":"));
  if (targets.some((part) => PROTECTED_BRANCHES.has(part))) {
    return deny("Nobody but the owner changes master; push your issue or phase branch instead.");
  }
  return null;
}

function checkMerge(fullCommand, { isSubagent, lookupPrBase }) {
  const command = fullCommand.match(MERGE)?.[0];
  if (!command) return null;
  if (isSubagent) {
    return deny("Only the orchestrator merges, and only into a phase branch.");
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
export function evaluateToolCall({
  toolName,
  toolInput,
  mainRoot,
  cwd,
  isSubagent = false,
  unattended = false,
  lookupPrBase = () => null,
}) {
  const restricted = isSubagent || unattended;

  if (FILE_EDIT_TOOLS.has(toolName) || FILE_READ_TOOLS.has(toolName)) {
    return checkFileTool({ toolName, toolInput, mainRoot, cwd, restricted });
  }

  if (toolName === "Bash") {
    const command = String(toolInput?.command ?? "");
    if (ENV_IN_COMMAND.test(command)) {
      return deny("Environment files are off limits; only .env.example may be read (docs/permissions.md).");
    }
    if (restricted && CONTEXT_IN_COMMAND.test(command)) {
      return deny(".context/ holds the owner's private notes; agents do not read it (docs/permissions.md).");
    }
    return checkPush(command) ?? checkMerge(command, { isSubagent, lookupPrBase });
  }

  return null;
}
