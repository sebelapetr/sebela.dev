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
const ENV_IN_COMMAND =
  /(^|[\s'"=/<>|;&(])\.env(?!\.example(?![\w.-]))(\.[\w.-]+)?(?=$|[\s'";&|)<>/*?{}[\]])/;
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

// Each refusal also says how to reach the same goal allowed, so an agent does not guess.
const ENV_REASON =
  "Only .env.example and .env.local inside the session's own worktree may be accessed (docs/permissions.md). If .env only appears as text in content you write, use the Edit or Write tool: they check the file you change, not its content.";

function allowedEnvPath(filePath, worktreeRoot) {
  return (
    path.basename(filePath) === ".env.example" ||
    (path.basename(filePath) === ".env.local" && worktreeRoot && isInside(filePath, worktreeRoot))
  );
}

function checkEnvironmentReference(filePath, { worktreeRoot, realpath }) {
  const resolved = realpath(filePath);
  return resolved !== null &&
    allowedEnvPath(filePath, worktreeRoot) &&
    allowedEnvPath(resolved, worktreeRoot)
    ? null
    : deny(ENV_REASON);
}

// Grep's glob and Glob's pattern can reach files that the searched directory does not name.
function checkSearchPattern({
  toolName,
  toolInput,
  restricted,
  cwd,
  mainRoot,
  worktreeRoot,
  realpath,
}) {
  const pattern =
    toolName === "Grep" ? toolInput?.glob : toolName === "Glob" ? toolInput?.pattern : null;
  if (!pattern) return null;
  const segments = String(pattern).split(/[\\/]/);
  if (segments.some((segment) => segment.startsWith(".env") && segment !== ".env.example")) {
    if (/[*?{}[\]]/.test(pattern)) return deny(ENV_REASON);
    const base = path.resolve(cwd ?? mainRoot, toolInput?.path ?? ".");
    const verdict = checkEnvironmentReference(path.resolve(base, pattern), {
      worktreeRoot,
      realpath,
    });
    if (verdict) return verdict;
  }
  const contextAt = segments.indexOf(".context");
  if (restricted && contextAt !== -1 && segments.slice(contextAt + 1).join("/") !== "README.md") {
    return deny(
      ".context/ holds the owner's private notes; agents do not read it (docs/permissions.md).",
    );
  }
  return null;
}

// The harness that governs the loop. Unattended runs change it only inside a worktree, through a
// pull request; never in the main checkout, and never inside any .git directory.
const HARNESS_DIRS = [".claude", ".github", "harness"];
const SETTINGS_IN_COMMAND = /(^|[\s'"=/<>|;&(])\.claude\/settings/;
const GIT_INTERNALS_IN_COMMAND = /(^|[\s'"=/<>|;&(])\.git\/(hooks|config)\b/;
const HARNESS_REASON =
  "The phase loop does not change the harness in the main checkout or inside .git (docs/permissions.md). To read a harness file, use the Read or Grep tool, or a plain cat, grep, head or sed -n.";

// Splits a shell command into its simple commands (separated by ; & | or newlines) as lists of
// words without quotes. It fails closed: null for anything the shell could read differently from
// this parser — a backslash outside single quotes, any expansion ($, braces, globs, ~ is harmless
// and kept), a subshell, a comment, redirection into a file, a heredoc or an unbalanced quote.
// Discarding output (2>&1, >/dev/null) is fine.
function simpleCommands(command) {
  const cleaned = command
    .replace(/(^|\s)\d?>&\d(?=\s|$)/g, " ")
    .replace(/(^|\s)\d?>\s*\/dev\/null(?=\s|$)/g, " ");
  const commands = [];
  let words = [];
  let word = null;
  let quote = null;
  const endWord = () => {
    if (word !== null) words.push(word);
    word = null;
  };
  const chars = [...cleaned];
  for (let i = 0; i < chars.length; i += 1) {
    const char = chars[i];
    if (quote === "'") {
      if (char === "'") quote = null;
      else word += char;
    } else if (quote === '"') {
      if (char === '"') quote = null;
      else if (char === "$" || char === "`") return null;
      else if (char === "\\" && /[$`"\\\n]/.test(chars[i + 1] ?? "")) return null;
      else word += char;
    } else if (char === "'" || char === '"') {
      quote = char;
      word ??= "";
    } else if (/[\\$`<>(){}*?[\]#]/.test(char)) {
      return null;
    } else if (/[;&|\n]/.test(char)) {
      endWord();
      if (words.length) commands.push(words);
      words = [];
    } else if (/\s/.test(char)) {
      endWord();
    } else {
      word = (word ?? "") + char;
    }
  }
  if (quote) return null;
  endWord();
  if (words.length) commands.push(words);
  return commands;
}

// What a git invocation runs: the subcommand and its arguments. `unsafe` when anything could
// make git read other configuration than the repository's: words in front of git (`env`,
// variable assignments) or a global option other than the few that only say where or how to
// print (`-c`, `--config-env`, `--exec-path`, `--attr-source`, …). Null when the words do not
// invoke git.
// Only -C: --git-dir and --work-tree could point git at another repository and its configuration.
const GIT_PLACE_OPTIONS = new Set(["-C"]);
const GIT_SAFE_OPTIONS = new Set([
  "--no-pager",
  "-P",
  "-p",
  "--paginate",
  "--no-replace-objects",
  "--no-optional-locks",
  "--literal-pathspecs",
  "--glob-pathspecs",
  "--noglob-pathspecs",
  "--icase-pathspecs",
]);
function gitInvocation(words) {
  let i = 0;
  if (words[i] === "env") i += 1;
  while (i < words.length && /^[A-Za-z_]\w*=/.test(words[i])) i += 1;
  if (path.basename(words[i] ?? "") !== "git") return null;
  let unsafe = i > 0;
  const plain = words[i] === "git";
  i += 1;
  while (i < words.length && words[i].startsWith("-")) {
    const [option, value] = words[i].split(/=(.*)/);
    if (GIT_PLACE_OPTIONS.has(option)) i += value === undefined ? 2 : 1;
    else {
      if (!GIT_SAFE_OPTIONS.has(words[i])) unsafe = true;
      i += 1;
    }
  }
  // Only the git on the PATH can be trusted to be git; ./git or tools/git could be anything.
  return { sub: words[i], args: words.slice(i + 1), unsafe, plain };
}

// Programs that only read and print, with the arguments that keep them so.
const READ_ONLY_GIT = new Set(["diff", "show", "log", "status", "ls-files", "grep", "blame"]);
// Options of those that write a file or run a program — --output, -O (open in a pager), external
// diff and text conversion drivers — also abbreviated, as git accepts any unique prefix.
const GIT_WRITING_OPTIONS = [
  "output",
  "output-directory",
  "open-files-in-pager",
  "ext-diff",
  "textconv",
];
function writesOrRuns(arg) {
  if (/^-[^-]/.test(arg)) return arg.includes("O");
  if (!arg.startsWith("--")) return false;
  const name = arg.slice(2).split("=")[0];
  return name.length > 0 && GIT_WRITING_OPTIONS.some((option) => option.startsWith(name));
}
function readsOnly(words) {
  const [program, ...args] = words;
  if (["cd", "cat", "head", "tail", "grep", "wc", "ls", "diff", "echo"].includes(program)) {
    return true;
  }
  // GNU sed takes options after the files too, so no other argument may be an option.
  if (program === "sed") {
    return (
      args[0] === "-n" &&
      /^\d+(,\d+)?p$/.test(args[1] ?? "") &&
      args.slice(2).every((arg) => !arg.startsWith("-"))
    );
  }
  const git = gitInvocation(words);
  return Boolean(
    git?.plain && !git.unsafe && READ_ONLY_GIT.has(git.sub) && !git.args.some(writesOrRuns),
  );
}

function isReadOnlyCommand(command) {
  const commands = simpleCommands(command);
  return commands !== null && commands.every(readsOnly);
}

// `git config` forms that only print: a key with --get or --get-all (or alone), --list, and the
// newer `git config get <key>` and `git config list`. Anything else — a value, edit, set, unset,
// a section rename — is a change.
const GIT_CONFIG_PRINT_FLAGS = new Set([
  "--get",
  "--get-all",
  "--list",
  "-l",
  "--show-origin",
  "--show-scope",
  "--local",
  "--worktree",
  "--null",
  "-z",
  "--name-only",
  "--includes",
]);
function readsGitConfig(args) {
  if (!args.every((arg) => !arg.startsWith("-") || GIT_CONFIG_PRINT_FLAGS.has(arg))) return false;
  const values = args.filter((arg) => !arg.startsWith("-"));
  const isKey = (value) => /^[\w-]+(\.[^\s]+)?\.[\w-]+$/.test(value ?? "");
  if (values[0] === "get") return values.length === 2 && isKey(values[1]);
  if (values[0] === "list") return values.length === 1;
  if (values.length === 0) return args.includes("--list") || args.includes("-l");
  return values.length === 1 && isKey(values[0]);
}

// Configuration through the environment reaches every git command, hooks included: the
// GIT_CONFIG_* variables, and HOME, XDG_CONFIG_HOME or any GIT_* variable that points git at other
// configuration files or another repository.
const GIT_CONFIG_ENVIRONMENT =
  /\bGIT_CONFIG(_COUNT|_KEY_|_VALUE_|_PARAMETERS|_GLOBAL|_SYSTEM|_NOSYSTEM)?\b/;
const GIT_FILES_ENVIRONMENT = /(^|[\s;&|(])(export\s+)?(HOME|XDG_CONFIG_HOME|GIT_[A-Z_]+)=/;
const GIT_WORD = /(^|[\s/])git(\s|$)/;
// `config` as a word, git's `-c <name>=<value>` (not python's or sh's `-c <code>`), and the
// options that point git at other configuration or programs.
const CONFIG_WORD = /(^|\s)(config(\s|$)|-c\s*[^\s=]+=|--config-env|--exec-path)/;

// Whether a command could change Git configuration, for good or for one command. It fails
// closed: git run by another program (a wrapper such as `sh -c` or `stdbuf`) together with a
// configuration word counts as a change, and so does a command the parser cannot read in which
// git is not plainly invoked with its subcommand first.
function changesGitConfig(command) {
  if (GIT_CONFIG_ENVIRONMENT.test(command)) return true;
  if (GIT_FILES_ENVIRONMENT.test(command) && /\bgit\b/.test(command)) return true;
  const commands = simpleCommands(command);
  if (commands === null) return unreadableGitChange(command);
  return commands.some((words) => {
    const git = gitInvocation(words);
    if (git) return git.unsafe || (git.sub === "config" && !readsGitConfig(git.args));
    const text = words.join(" ");
    return GIT_WORD.test(text) && CONFIG_WORD.test(text);
  });
}

// For a command the parser cannot read: every git invocation must start plainly — nothing in
// front of git, only safe or place options, and a subcommand other than config — before the
// first word the shell could expand. Expansions after the subcommand cannot set configuration.
const GIT_AT_COMMAND =
  /(^|[;&|(\n]\s*)(?:(?:do|then|else|elif|!)\s+)?([^\s;&|=]+=[^\s;&|]*\s+|env\s+)*([^\s;&|]*\/)?git(\s+|$)([^;&|\n]*)/g;
function unreadableGitChange(command) {
  // Quotes are dropped, not honoured: git and a configuration word count wherever they appear,
  // a commit message included (write such a message to a file and use git commit -F).
  const plain = command.replace(/['"\\]/g, "");
  for (const match of plain.matchAll(GIT_AT_COMMAND)) {
    if (match[2]) return true;
    const words = match[5].split(/\s+/).filter(Boolean);
    let i = 0;
    while (i < words.length && words[i].startsWith("-")) {
      const [option, value] = words[i].split(/=(.*)/);
      if (/[$`{}*?[\]()]/.test(words[i])) return true;
      if (GIT_PLACE_OPTIONS.has(option)) i += value === undefined ? 2 : 1;
      else if (GIT_SAFE_OPTIONS.has(words[i])) i += 1;
      else return true;
    }
    // A closing parenthesis only ends a command substitution such as $(git ls-files).
    const sub = words[i]?.replace(/\)+$/, "");
    if (!sub || /[$`{}*?[\]()]/.test(sub) || sub === "config") return true;
  }
  // Anywhere else — after =, inside $( ), behind a wrapper — git with a configuration word counts.
  return GIT_WORD.test(plain) && CONFIG_WORD.test(plain);
}

// Leaving .context out of a search (`--exclude-dir=.context`, `-path ./.context -prune`,
// `':!.context'`) does not read it; every other mention still counts.
const CONTEXT_EXCLUSIONS = [
  /--exclude-dir=(['"]?)\.context\1(?=\s|$)/g,
  /-path\s+(['"]?)\.\/\.context\1\s+-prune(?=\s|$)/g,
  /(['"]):(?:!|\(exclude\))\.context\1(?=\s|$)/g,
];
function mentionsContext(command) {
  const rest = CONTEXT_EXCLUSIONS.reduce((text, pattern) => text.replace(pattern, " "), command);
  return CONTEXT_IN_COMMAND.test(rest);
}

// The one place in the main checkout's .claude/ that agents write to: their own memory, shared
// by every worktree and ignored by git.
const AGENT_MEMORY_DIR = path.join(".claude", "agent-memory-local");

function isHarnessFile(filePath, mainRoot) {
  if (filePath.split(path.sep).includes(".git")) return true;
  if (isInside(filePath, path.join(mainRoot, ".worktrees"))) return false;
  // Only inside an agent's own folder; the folder's README stays the owner's.
  const memoryDir = path.join(mainRoot, AGENT_MEMORY_DIR);
  if (
    isInside(filePath, memoryDir) &&
    path.dirname(filePath) !== memoryDir &&
    filePath !== memoryDir
  )
    return false;
  return HARNESS_DIRS.some((dir) => isInside(filePath, path.join(mainRoot, dir)));
}

function checkFileTool({
  toolName,
  toolInput,
  mainRoot,
  cwd,
  restricted,
  unattended,
  realpath,
  worktreeRoot,
}) {
  const fromPattern = checkSearchPattern({
    toolName,
    toolInput,
    restricted,
    cwd,
    mainRoot,
    worktreeRoot,
    realpath,
  });
  if (fromPattern) return fromPattern;
  const raw = filePathOf(toolInput);
  if (!raw) return null;
  // Both the path as written and where it really lands past symbolic links must pass.
  const lexical = path.resolve(cwd ?? mainRoot, raw);
  const resolved = realpath(lexical);
  if (resolved === null) {
    return deny("A symbolic link that cannot be resolved is not followed (docs/permissions.md).");
  }
  if (isEnvFile(lexical) || isEnvFile(resolved)) {
    const verdict = checkEnvironmentReference(lexical, { worktreeRoot, realpath });
    if (verdict) return verdict;
  }
  const facts = { toolName, mainRoot, restricted, unattended, worktreeRoot };
  return checkPath(lexical, facts) ?? (resolved === lexical ? null : checkPath(resolved, facts));
}

function checkPath(filePath, { toolName, mainRoot, restricted, unattended, worktreeRoot }) {
  if (isEnvFile(filePath) && !allowedEnvPath(filePath, worktreeRoot)) {
    return deny(ENV_REASON);
  }

  const contextDir = path.join(mainRoot, ".context");
  if (
    restricted &&
    isInside(filePath, contextDir) &&
    filePath !== path.join(contextDir, "README.md")
  ) {
    return deny(
      ".context/ holds the owner's private notes; agents do not read it (docs/permissions.md).",
    );
  }

  if (FILE_EDIT_TOOLS.has(toolName) && unattended && isHarnessFile(filePath, mainRoot)) {
    return deny(
      "The phase loop does not change the harness in the main checkout or inside .git (docs/permissions.md).",
    );
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
  `${AT_COMMAND}gh\\s+(api|repo|secret|auth|label|workflow|ruleset|variable)\\b`,
);
const SETTINGS_REASON =
  "The phase loop does not change repository settings, secrets or credentials (docs/permissions.md). To read a release of another repository, use `gh release view --repo <owner>/<repo>`; to read a Git setting, `git config --get <key>`; for a commit message that mentions configuration, write it to a file in .tmp/ and use `git commit -F <file>`.";

// The command may run somewhere other than the directory the hook looked at.
const MOVES =
  /(^|[;&|(\n]\s*)(cd|pushd)\s|\s-C\s|--git-dir=|--work-tree=|\bGIT_DIR=|\bGIT_WORK_TREE=/;

// Only static shell paths get the exception. Expansions and directory changes are ambiguous.
function checkShellEnvironment(command, facts) {
  if (!ENV_IN_COMMAND.test(command)) return null;
  if (MOVES.test(command) || /[$`\\*?{}[\]~]/.test(command)) return deny(ENV_REASON);
  const words = [];
  let word = "";
  let quote = null;
  for (const char of command) {
    if (quote) {
      if (char === quote) quote = null;
      else word += char;
    } else if (char === "'" || char === '"') quote = char;
    else if (/[\s;&|()<>=]/.test(char)) {
      if (word) words.push(word);
      word = "";
    } else word += char;
  }
  if (quote) return deny(ENV_REASON);
  if (word) words.push(word);
  const references = words.filter(isEnvFile);
  const mentions = [...command.matchAll(new RegExp(ENV_IN_COMMAND.source, "g"))];
  if (!references.length || references.length !== mentions.length) return deny(ENV_REASON);
  for (const reference of references) {
    const verdict = checkEnvironmentReference(
      path.resolve(facts.cwd ?? facts.mainRoot, reference),
      facts,
    );
    if (verdict) return verdict;
  }
  return null;
}

function checkPush(fullCommand, { currentBranch }) {
  const command = fullCommand.match(PUSH)?.[0]?.replace(/['"]/g, "");
  if (!command) return null;
  if (/\s--(all|mirror|branches)\b/.test(command)) {
    return deny("Push one named branch, not all of them (docs/git-workflow.md).");
  }
  if (/\s(--force(-with-lease)?|-f)(\s|=|$)/.test(command) || /[\s:]\+[\w/.-]+/.test(command)) {
    return deny(
      "Force-pushing is not allowed (docs/git-workflow.md). To bring a pushed branch up to date, run `git merge origin/phase/<phase>` instead of rebasing, then push normally.",
    );
  }
  const masterRefused = deny(
    "Nobody but the owner changes master; push your issue or phase branch instead.",
  );
  // After "git push": options, then the remote, then refspecs.
  const afterPush = command.slice(command.search(/\spush\b/) + 5);
  const positional = afterPush
    .trim()
    .split(/\s+/)
    .filter((part) => part && !part.startsWith("-"));
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
  if (
    /\s(--repo|-R)(\s|=)/.test(command) ||
    /https?:\/\//.test(command) ||
    /\bGH_(REPO|HOST)=/.test(fullCommand)
  ) {
    return deny("Merge pull requests of this repository only, by number.");
  }
  const number = command.match(/\bgh\s+pr\s+merge\s+(?:[^\s-]\S*\s+)*?(\d+)\b/)?.[1];
  if (!number) {
    return deny("Name the pull request number explicitly so its base branch can be checked.");
  }
  let base;
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
//   realpath(path)        resolves symbolic links; null when a link cannot be resolved
//   worktreeRoot          Git-confirmed root of the worktree containing the session
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
  worktreeRoot = null,
}) {
  const restricted = isSubagent || unattended;
  // The hook confirms Git ownership; both the session and the real directory must stay inside it.
  if (
    !worktreeRoot ||
    worktreeRoot === mainRoot ||
    !isInside(worktreeRoot, path.join(mainRoot, ".worktrees")) ||
    worktreeRoot === path.join(mainRoot, ".worktrees") ||
    !isInside(path.resolve(cwd ?? mainRoot), worktreeRoot) ||
    realpath(worktreeRoot) !== worktreeRoot ||
    !isInside(realpath(path.resolve(cwd ?? mainRoot)) ?? mainRoot, worktreeRoot)
  )
    worktreeRoot = null;

  if (FILE_EDIT_TOOLS.has(toolName) || FILE_READ_TOOLS.has(toolName)) {
    return checkFileTool({
      toolName,
      toolInput,
      mainRoot,
      cwd,
      restricted,
      unattended,
      realpath,
      worktreeRoot,
    });
  }

  if (toolName === "Bash") {
    const command = String(toolInput?.command ?? "");
    const environment = checkShellEnvironment(command, { mainRoot, cwd, worktreeRoot, realpath });
    if (environment) return environment;
    if (
      unattended &&
      (GIT_INTERNALS_IN_COMMAND.test(command) ||
        (SETTINGS_IN_COMMAND.test(command) && !isReadOnlyCommand(command)))
    ) {
      return deny(HARNESS_REASON);
    }
    if (unattended && (UNATTENDED_FORBIDDEN.test(command) || changesGitConfig(command))) {
      return deny(SETTINGS_REASON);
    }
    if (restricted && mentionsContext(command)) {
      return deny(
        ".context/ holds the owner's private notes; agents do not read it (docs/permissions.md). To search the checkout, leave it out with --exclude-dir=.context (grep) or -path ./.context -prune (find).",
      );
    }
    return (
      checkPush(command, { currentBranch }) ?? checkMerge(command, { isSubagent, lookupPrBase })
    );
  }

  return null;
}
