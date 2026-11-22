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
// The documented examples with placeholders only: the settings and the owner's secrets.
const EXAMPLE_ENV_FILES = new Set([".env.example", ".env.secrets.example"]);
const ENV_IN_COMMAND =
  /(^|[\s'"=/<>|;&(])\.env(?!(\.secrets)?\.example(?![\w.-]))(\.[\w.-]+)?(?=$|[\s'";&|)<>/*?{}[\]])/;
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
  return ENV_FILE_NAME.test(name) && !EXAMPLE_ENV_FILES.has(name);
}

function deny(reason) {
  return { reason };
}

// Each refusal also says how to reach the same goal allowed, so an agent does not guess.
const ENV_REASON =
  "Only .env.example, .env.secrets.example and .env.local inside the session's own worktree may be accessed; the owner's .env and .env.secrets never (docs/permissions.md). A command that needs a secret loads it itself through harness/with-secrets.mjs. If .env only appears as text in content you write, use the Edit or Write tool: they check the file you change, not its content.";

function allowedEnvPath(filePath, worktreeRoot) {
  return (
    EXAMPLE_ENV_FILES.has(path.basename(filePath)) ||
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
  if (segments.some((segment) => segment.startsWith(".env") && !EXAMPLE_ENV_FILES.has(segment))) {
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

// compose.yaml names its project `sebela`, so a Compose command without its own project name acts
// on the stack every worktree and loop shares: starting, stopping or rebuilding it recreates the
// shared Postgres and builds images on the small system disk. Agents use the disposable-project
// checks (`pnpm test:api-stack`, `pnpm test:web-stack`) or `-p <own name>`; inspecting is fine.
const SHARED_PROJECT = "sebela";
const STACK_SCRIPT = new RegExp(
  `${AT_COMMAND}pnpm(?:\\s+-{1,2}[\\w-]+)*\\s+(?:run\\s+)?stack:(?:up|down|seed)\\b`,
);
const COMPOSE_CALL = new RegExp(
  `${AT_COMMAND.replace("(?:\\w+=\\S*\\s+)*", "((?:\\w+=\\S*\\s+)*)")}(?:docker\\s+compose|docker-compose)\\b([^;&|\\n]*)`,
  "g",
);
const COMPOSE_CHANGES = new Set([
  "up",
  "down",
  "start",
  "stop",
  "restart",
  "rm",
  "create",
  "build",
  "run",
  "kill",
  "pause",
  "unpause",
  "scale",
]);
const COMPOSE_OPTIONS_WITH_VALUE = new Set([
  "-f",
  "--file",
  "-p",
  "--project-name",
  "--profile",
  "--env-file",
  "--project-directory",
  "--ansi",
  "--parallel",
  "--progress",
]);
const SHARED_STACK_REASON =
  "The shared Compose project `sebela` (compose.yaml) belongs to every worktree and loop; agents do not start, stop or rebuild it (docs/permissions.md). Use `pnpm test:api-stack` or `pnpm test:web-stack`, or `docker compose -p <your-own-name> …` with its own port, and remove the images afterwards; prefer verifying images in CI.";

function composeProjectOf(assignments, args) {
  let project = /(?:^|\s)COMPOSE_PROJECT_NAME=(\S+)/.exec(assignments ?? "")?.[1] ?? null;
  let subcommand = null;
  const words = args.trim().split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length && subcommand === null; i += 1) {
    const word = words[i].replace(/^['"]|['"]$/g, "");
    const [flag, inline] = word.split("=", 2);
    if (flag === "-p" || flag === "--project-name") {
      project = inline ?? words[(i += 1)] ?? "";
    } else if (word.startsWith("-p") && word.length > 2 && !word.startsWith("--")) {
      project = word.slice(2);
    } else if (word.startsWith("-")) {
      if (COMPOSE_OPTIONS_WITH_VALUE.has(flag) && inline === undefined) i += 1;
    } else {
      subcommand = word;
    }
  }
  return { project: project?.replace(/^['"]|['"]$/g, "") ?? null, subcommand };
}

function changesSharedStack(command) {
  if (STACK_SCRIPT.test(command)) return true;
  for (const [, assignments, args] of command.matchAll(COMPOSE_CALL)) {
    const { project, subcommand } = composeProjectOf(assignments, args);
    if (!COMPOSE_CHANGES.has(subcommand)) continue;
    if (project === null || project === "" || project === SHARED_PROJECT) return true;
  }
  return false;
}

// The production stack (`infra/`) may run on a machine where agents work, and access to Docker
// reaches every container on it: an agent never runs Docker against the production project, the
// production composition or its containers, and never runs the operating scripts (deploy, backup,
// restore, demo clear). Reading those files and the composition's tests stays allowed.
const PRODUCTION_PROJECT = "sebela-production";
const DOCKER_CALL = new RegExp(
  `${AT_COMMAND}(?:sudo\\s+(?:-\\S+\\s+)*)?(?:docker|docker-compose)\\b([^;&|\\n]*)`,
  "g",
);
const PRODUCTION_SCRIPT = new RegExp(
  `${AT_COMMAND}(?:sudo\\s+(?:-\\S+(?:\\s+[^-\\s]\\S*)?\\s+)*)?(?:(?:ba|z)?sh\\s+)?\\S*infra/scripts/(?:deploy|backup|restore|clear-demo)\\.sh\\b`,
);
const PRODUCTION_REASON =
  "Agents do not operate the production stack: no Docker command against the `sebela-production` project, the production composition or its containers, and no deploy, backup, restore or demo-clear script (docs/permissions.md). Read the files, run `node --test scripts/checks/` or `pnpm test:production-stack`, which use a disposable project, and leave operating production to the owner.";

function touchesProduction(command, assignments = "") {
  if (PRODUCTION_SCRIPT.test(command)) return true;
  for (const match of command.matchAll(DOCKER_CALL)) {
    const before = command.slice(Math.max(0, match.index - 200), match.index);
    const args = match[1] ?? "";
    if (new RegExp(`(?:^|[^\\w-])${PRODUCTION_PROJECT}(?![\\w])`).test(args)) return true;
    if (/infra\/production\/compose\.ya?ml/.test(args)) return true;
    if (
      new RegExp(`COMPOSE_PROJECT_NAME=${PRODUCTION_PROJECT}\\b`).test(
        before + match[0] + assignments,
      )
    )
      return true;
  }
  return false;
}

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

// --- reading a command the way the shell does ---------------------------------------------
//
// The rules below decide on words, not on spellings. `shellCommands` splits a command line into
// its simple commands — at ; & | ( ) and newlines outside quotes — and each into words with the
// quotes removed. Text inside quotes stays one word, so a commit message or a pull request body
// that mentions a command is not one. What the shell fills in at run time — a variable, a
// command substitution — is marked in the word with DYNAMIC: such a word cannot be read here. A
// substitution's own commands (`$(…)`, backticks, also inside double quotes) are read as
// commands too; a heredoc's body is text, except the substitutions of an unquoted heredoc.
// `open` says a quote or substitution never closed: what the shell would run is then unknown.
const DYNAMIC = "\u0000";
const isDynamic = (word) => typeof word === "string" && word.includes(DYNAMIC);

function closingParen(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const char = text[i];
    if (char === "\\") i += 1;
    else if (char === "'") {
      const end = text.indexOf("'", i + 1);
      if (end === -1) return -1;
      i = end;
    } else if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function shellCommands(command) {
  const commands = [];
  let open = false;

  const read = (text) => {
    let words = [];
    let word = null;
    let heredocs = [];
    const add = (piece) => {
      word = (word ?? "") + piece;
    };
    const endWord = () => {
      if (word !== null) words.push(word);
      word = null;
    };
    const endCommand = () => {
      endWord();
      if (words.length) commands.push(words);
      words = [];
    };
    // Reads the substitution that starts at `at` (a backtick or the parenthesis of `$(`),
    // hands its commands to `read` and returns where it ends.
    const substitution = (at) => {
      const end = text[at] === "`" ? text.indexOf("`", at + 1) : closingParen(text, at);
      if (end === -1) {
        open = true;
        read(text.slice(at + 1));
        return text.length;
      }
      read(text.slice(at + 1, end));
      return end + 1;
    };

    let i = 0;
    while (i < text.length) {
      const char = text[i];
      if (char === "'") {
        const end = text.indexOf("'", i + 1);
        if (end === -1) {
          open = true;
          add(text.slice(i + 1));
          break;
        }
        add(text.slice(i + 1, end));
        i = end + 1;
      } else if (char === '"') {
        add("");
        i += 1;
        while (i < text.length && text[i] !== '"') {
          if (text[i] === "\\" && i + 1 < text.length) {
            add(text[i + 1]);
            i += 2;
          } else if (text[i] === "`" || (text[i] === "$" && text[i + 1] === "(")) {
            add(DYNAMIC);
            i = substitution(text[i] === "`" ? i : i + 1);
          } else if (text[i] === "$") {
            add(DYNAMIC);
            i += 1;
          } else {
            add(text[i]);
            i += 1;
          }
        }
        if (i >= text.length) open = true;
        i += 1;
      } else if (char === "\\") {
        if (text[i + 1] !== "\n" && text[i + 1] !== undefined) add(text[i + 1]);
        i += 2;
      } else if (char === "`" || (char === "$" && text[i + 1] === "(")) {
        add(DYNAMIC);
        i = substitution(char === "`" ? i : i + 1);
      } else if (char === "$") {
        add(DYNAMIC);
        i += 1;
      } else if (char === "<" && text[i + 1] === "<" && text[i + 2] !== "<") {
        // A heredoc: its delimiter, quoted or not; the body starts after this line.
        i += 2;
        const strip = text[i] === "-";
        if (strip) i += 1;
        while (text[i] === " " || text[i] === "\t") i += 1;
        let delimiter = "";
        let quoted = false;
        while (i < text.length && !/[\s;&|()<>]/.test(text[i])) {
          if (text[i] === "'" || text[i] === '"') {
            quoted = true;
            const end = text.indexOf(text[i], i + 1);
            if (end === -1) break;
            delimiter += text.slice(i + 1, end);
            i = end + 1;
          } else {
            if (text[i] === "\\") {
              quoted = true;
              i += 1;
            }
            delimiter += text[i] ?? "";
            i += 1;
          }
        }
        if (delimiter) heredocs.push({ delimiter, quoted, strip });
      } else if (char === "\n") {
        endCommand();
        i += 1;
        for (const { delimiter, quoted, strip } of heredocs) {
          const body = [];
          let closed = false;
          while (i < text.length && !closed) {
            const end = text.indexOf("\n", i);
            const line = text.slice(i, end === -1 ? text.length : end);
            i = end === -1 ? text.length : end + 1;
            if ((strip ? line.replace(/^\t+/, "") : line) === delimiter) closed = true;
            else body.push(line);
          }
          if (!quoted) {
            // An unquoted heredoc still runs the substitutions in its body.
            const inner = body.join("\n");
            for (let at = 0; at < inner.length; at += 1) {
              if (inner[at] === "\\") at += 1;
              else if (inner[at] === "`" || (inner[at] === "$" && inner[at + 1] === "(")) {
                const from = inner[at] === "`" ? at : at + 1;
                const end =
                  inner[from] === "`" ? inner.indexOf("`", from + 1) : closingParen(inner, from);
                read(inner.slice(from + 1, end === -1 ? inner.length : end));
                at = end === -1 ? inner.length : end;
              }
            }
          }
        }
        heredocs = [];
      } else if (char === "&" && (text[i - 1] === ">" || text[i + 1] === ">")) {
        // 2>&1 and &> are redirections, not the end of a command.
        add(char);
        i += 1;
      } else if (/[;&|()]/.test(char)) {
        endCommand();
        i += 1;
      } else if (/\s/.test(char)) {
        endWord();
        i += 1;
      } else {
        add(char);
        i += 1;
      }
    }
    endCommand();
  };

  read(String(command));
  return { commands, open };
}

const programOf = (word) => (isDynamic(word) ? word : path.basename(word ?? ""));
const ASSIGNMENT = /^[A-Za-z_]\w*=/;
// Words that run the command that follows them, with their own options in between.
const COMMAND_WRAPPERS = new Set([
  "{",
  "!",
  "if",
  "then",
  "else",
  "elif",
  "do",
  "while",
  "until",
  "time",
  "command",
  "builtin",
  "exec",
  "nohup",
  "env",
  "sudo",
  "xargs",
  "timeout",
  "nice",
  "ionice",
  "stdbuf",
  "setsid",
]);
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh"]);

// Every simple command a command line runs, as words: those written out, and those handed to a
// shell as text (`sh -c '…'`, `eval …`), each also behind wrappers such as `command`, `exec`,
// `time`, `nohup`, `env` or `{`. Each is { words, from } where `from` is the index of the
// program's own word, after assignments and wrappers.
function invocations(command) {
  const { commands, open } = shellCommands(command);
  const found = [];
  const queue = [...commands];
  for (let guard = 0; queue.length > 0 && guard < 500; guard += 1) {
    const words = queue.shift();
    let from = 0;
    while (from < words.length) {
      const word = words[from];
      if (ASSIGNMENT.test(word)) from += 1;
      else if (COMMAND_WRAPPERS.has(programOf(word))) {
        from += 1;
        // The wrapper's own options, and a value such as timeout's duration.
        while (from < words.length && (words[from].startsWith("-") || /^\d/.test(words[from]))) {
          from += 1;
        }
      } else break;
    }
    const program = programOf(words[from]);
    if (SHELLS.has(program)) {
      const at = words.findIndex((word, index) => index > from && /^-[a-z]*c$/.test(word));
      if (at !== -1 && words[at + 1] !== undefined) {
        queue.push(...shellCommands(words[at + 1].replaceAll(DYNAMIC, "$")).commands);
      }
    } else if (program === "eval") {
      const text = words
        .slice(from + 1)
        .join(" ")
        .replaceAll(DYNAMIC, "$");
      queue.push(...shellCommands(text).commands);
    }
    found.push({ words, from });
  }
  return { found, open };
}

// --- gh --------------------------------------------------------------------------------------
//
// The phase pull request stays a draft until the owner switches it: marking it ready starts the
// paid model evals of the phase, once, on its final state (docs/git-workflow.md, Phase pull
// request). No agent creates a pull request whose head is `phase/*` without `--draft`, marks one
// ready, closes or reopens it — with `gh pr …` or the same change through `gh api` — and only the
// orchestrator merges, only into a phase branch. In the loop and in a subagent such a call is
// refused; in an interactive main session the owner is asked, so the change happens only on the
// owner's own confirmation.
//
// gh is read in its parsed form: the command group and the verb are found by skipping flags.
// A call that cannot be identified is treated like the guarded call it may be: a flag before the
// group (`gh -R o/r workflow run …` — every rule below would otherwise read past it), a group or
// verb the shell fills in or that gh does not have (an alias or an extension can be anything),
// and a flag between `pr` and a guarded verb. `--help` and `--version` only print.
const GH_FLAGS_WITH_VALUE = new Set(["-R", "--repo", "--hostname"]);
const GH_PRINTS_ONLY = new Set(["--help", "-h", "--version"]);
const GH_GROUPS = new Set([
  "agent-task",
  "alias",
  "api",
  "attestation",
  "auth",
  "browse",
  "cache",
  "co",
  "codespace",
  "completion",
  "config",
  "copilot",
  "extension",
  "gist",
  "gpg-key",
  "help",
  "issue",
  "label",
  "org",
  "pr",
  "preview",
  "project",
  "release",
  "repo",
  "ruleset",
  "run",
  "search",
  "secret",
  "ssh-key",
  "status",
  "variable",
  "version",
  "workflow",
]);
// What the phase loop never needs (also UNATTENDED_FORBIDDEN above, on the command as written).
const GH_LOOP_FORBIDDEN = new Set([
  "api",
  "repo",
  "secret",
  "auth",
  "label",
  "workflow",
  "ruleset",
  "variable",
]);
// Groups whose calls some rule here guards; an unidentifiable call may be one of them.
const GH_GUARDED = new Set(["pr", "api", "workflow", "secret", "variable"]);
// `gh alias` and `gh extension` make gh run what no rule can read.
const GH_INDIRECT = new Set(["alias", "extension"]);
const PR_VERBS = new Set([
  "checkout",
  "checks",
  "close",
  "comment",
  "create",
  "new",
  "diff",
  "edit",
  "list",
  "ls",
  "lock",
  "merge",
  "ready",
  "reopen",
  "revert",
  "review",
  "status",
  "unlock",
  "update-branch",
  "view",
]);
const PR_STATE_VERBS = new Set(["ready", "close", "reopen"]);
const PR_CREATE_VERBS = new Set(["create", "new"]);
const PR_GUARDED_VERBS = new Set([...PR_STATE_VERBS, ...PR_CREATE_VERBS, "merge"]);
const PR_STATE_OPTIONS_WITH_VALUE = new Set(["-c", "--comment"]);
// Options of `gh pr create` that take the next word as their value.
const PR_CREATE_OPTIONS_WITH_VALUE = new Set([
  "-a",
  "--assignee",
  "-B",
  "--base",
  "-b",
  "--body",
  "-F",
  "--body-file",
  "-H",
  "--head",
  "-l",
  "--label",
  "-m",
  "--milestone",
  "-p",
  "--project",
  "-r",
  "--reviewer",
  "-R",
  "--repo",
  "-T",
  "--template",
  "-t",
  "--title",
  "--recover",
]);
// Its short options without a value, which may be written together (`-df`).
const PR_CREATE_SHORT_SWITCHES = /^-[dfwe]+$/;
const PR_MERGE_OPTIONS_WITH_VALUE = new Set([
  "-A",
  "--author-email",
  "-b",
  "--body",
  "-F",
  "--body-file",
  "--match-head-commit",
  "-t",
  "--subject",
]);
const PR_STATE_MUTATIONS =
  /\b(markPullRequestReadyForReview|convertPullRequestToDraft|closePullRequest|reopenPullRequest|mergePullRequest|enablePullRequestAutoMerge)\b/;
const PHASE_PR_REASON =
  "The phase pull request stays a draft until the owner switches it: no agent marks a phase pull request ready, closes or reopens it (docs/git-workflow.md, Phase pull request; docs/permissions.md). Marking it ready starts the phase's paid model evals. Leave it as it is, report what is done and let the owner change its state.";
const PHASE_PR_DRAFT_REASON =
  "A phase pull request is only ever created as a draft: `gh pr create --draft --base <base> --head phase/<phase-folder> …` (docs/git-workflow.md, Phase pull request; docs/permissions.md). Without --draft it starts the phase's paid model evals at once. The owner marks it ready when the phase is complete.";
const PR_CREATE_UNKNOWN =
  "Could not confirm that this does not create a phase pull request without --draft, so it is not created (docs/permissions.md). Name the head in plain text with --head <branch> — not from a variable or a substitution, and not after a `cd`, `git switch` or `git checkout` in the same command — keep gh's flags after `gh pr create`, without --repo, and pass a long body with --body-file <file>. A draft (--draft) is always allowed.";
const PHASE_PR_UNKNOWN =
  "Could not confirm that this is not a phase pull request, so its state is not changed (docs/permissions.md). Name a pull request of this repository by its number, in plain text, with gh's flags after the verb and without --repo; to close an issue use `gh issue close <number>`.";
const GH_UNREADABLE_REASON =
  "Could not confirm what this gh call does, so it is refused (docs/permissions.md): write the command group and the verb in plain text straight after `gh` — `gh pr view 12 --repo <owner>/<repo>`, not `gh -R <owner>/<repo> pr view 12` — and do not take them from a variable, a substitution, an alias or an extension.";
const MERGE_UNKNOWN_REASON =
  "Only the orchestrator merges, only a pull request of this repository named by its number in plain text, only into a phase branch and with --squash: `gh pr merge <number> --squash --delete-branch`, with no flag before `merge` (docs/git-workflow.md).";

const isPhaseBranch = (name) => /^(?:[^:/\s]+:)?phase\/\S+$/.test(name ?? "");

// A change of the checked-out branch earlier in the same command line: the branch the hook saw
// is then not the branch a later command acts on.
const BRANCH_CHANGING_GIT = new Set([
  "switch",
  "checkout",
  "branch",
  "rebase",
  "bisect",
  "worktree",
]);
function changesBranch(found) {
  return found.some(({ words, from }) => {
    const git = programOf(words[from]) === "git" ? gitInvocation(words.slice(from)) : null;
    return git !== null && (isDynamic(git.sub) || BRANCH_CHANGING_GIT.has(git.sub));
  });
}

// A gh call from the words after `gh`: { prints } for one that only prints help or a version,
// else { group, verb, args, flaggedGroup, flaggedVerb } — `flaggedGroup` when a flag stands
// before the command group, `flaggedVerb` when one stands between the group and its verb.
function readGh(words) {
  let i = 0;
  const skipFlags = () => {
    let flagged = false;
    while (i < words.length && words[i].startsWith("-")) {
      if (GH_PRINTS_ONLY.has(words[i])) return null;
      flagged = true;
      i += GH_FLAGS_WITH_VALUE.has(words[i]) ? 2 : 1;
    }
    return flagged;
  };
  const flaggedGroup = skipFlags();
  if (flaggedGroup === null || i >= words.length) return { prints: true };
  const group = words[i];
  i += 1;
  const rest = words.slice(i);
  const flaggedVerb = skipFlags();
  if (flaggedVerb === null) return { prints: true };
  const args = words.slice(i + 1);
  if (args.some((word) => GH_PRINTS_ONLY.has(word))) return { prints: true };
  return { group, verb: words[i], args, rest, flaggedGroup, flaggedVerb };
}

// The head branch `gh pr create` was given and whether it asks for a draft:
// { head (null when none is named), draft: true | false | null (not said) }.
function prCreateOptions(args) {
  let head = null;
  let draft = null;
  for (let i = 0; i < args.length; i += 1) {
    const word = args[i];
    const [option, inline] = word.split(/=(.*)/s);
    if (option === "--head") head = inline ?? args[(i += 1)] ?? "";
    else if (word === "-H") head = args[(i += 1)] ?? "";
    else if (/^-H./.test(word)) head = word.slice(2).replace(/^=/, "");
    else if (option === "--draft") draft = inline === undefined ? true : inline === "true";
    else if (PR_CREATE_SHORT_SWITCHES.test(word)) draft = word.includes("d") ? true : draft;
    else if (PR_CREATE_OPTIONS_WITH_VALUE.has(word)) i += 1;
  }
  return { head, draft };
}

function checkGh(fullCommand, facts) {
  const { restricted, unattended, isSubagent, lookupPrHead, lookupPrBase, currentBranch } = facts;
  // Only the owner, asked in an interactive main session, can let a guarded call through.
  const refuse = (reason) => (restricted ? deny(reason) : { reason, decision: "ask" });
  const headOf = (selector) => {
    try {
      return lookupPrHead(selector) || null;
    } catch {
      return null;
    }
  };
  const { found, open } = invocations(fullCommand);
  if (open && /\bgh\b/.test(fullCommand)) {
    // An open quote or substitution: what gh would be given is unknown.
    const guarded = /\b(pr|api|workflow|secret|variable)\b/.test(fullCommand);
    if (restricted || guarded) return refuse(GH_UNREADABLE_REASON);
  }
  const elsewhere = /\bGH_(REPO|HOST)=/.test(fullCommand);
  const branchKnown = Boolean(currentBranch) && !MOVES.test(fullCommand) && !changesBranch(found);

  for (const { words, from } of found) {
    if (programOf(words[from]) !== "gh") continue;
    const call = readGh(words.slice(from + 1));
    if (call.prints) continue;
    const { group, verb, args, rest, flaggedGroup, flaggedVerb } = call;

    const unreadable = isDynamic(group) || !GH_GROUPS.has(group);
    if (flaggedGroup || unreadable || GH_INDIRECT.has(group)) {
      if (restricted) return deny(GH_UNREADABLE_REASON);
      // Interactively only what may be a guarded call is put to the owner.
      if (unreadable || GH_GUARDED.has(group)) return refuse(GH_UNREADABLE_REASON);
      continue;
    }
    if (unattended && GH_LOOP_FORBIDDEN.has(group)) return deny(SETTINGS_REASON);

    if (group === "api") {
      const verdict = checkGhApi(rest, { refuse, headOf, elsewhere });
      if (verdict) return verdict;
      continue;
    }
    if (group !== "pr") continue;
    if (verb === undefined) continue;
    if (isDynamic(verb) || !PR_VERBS.has(verb)) return refuse(PHASE_PR_UNKNOWN);
    if (!PR_GUARDED_VERBS.has(verb)) continue;
    const otherRepository = elsewhere || args.some((word) => /^(--repo|-R)(=|$)/.test(word));

    if (verb === "merge") {
      const verdict = checkGhMerge(args, {
        flaggedVerb,
        otherRepository,
        isSubagent,
        lookupPrBase,
      });
      if (verdict) return verdict;
      continue;
    }
    if (PR_CREATE_VERBS.has(verb)) {
      const { head, draft } = prCreateOptions(args);
      if (
        draft === true &&
        !flaggedVerb &&
        !args.some((word) => isDynamic(word) && /^--draft/.test(word))
      ) {
        continue;
      }
      if (flaggedVerb || otherRepository) return refuse(PR_CREATE_UNKNOWN);
      // A head from a variable or a substitution, or — without --head — a branch this command
      // line may have changed, cannot be told from a phase branch.
      if (head === null ? !branchKnown : isDynamic(head)) return refuse(PR_CREATE_UNKNOWN);
      if (isPhaseBranch(head ?? currentBranch)) return refuse(PHASE_PR_DRAFT_REASON);
      continue;
    }
    if (flaggedVerb || otherRepository) return refuse(PHASE_PR_UNKNOWN);
    let selector = null;
    for (let i = 0; i < args.length && selector === null; i += 1) {
      if (PR_STATE_OPTIONS_WITH_VALUE.has(args[i])) i += 1;
      else if (!args[i].startsWith("-")) selector = args[i];
    }
    let head;
    if (selector === null) {
      // Without a selector gh acts on the pull request of the checked-out branch.
      if (!branchKnown) return refuse(PHASE_PR_UNKNOWN);
      head = currentBranch;
    } else if (isDynamic(selector)) {
      return refuse(PHASE_PR_UNKNOWN);
    } else if (isPhaseBranch(selector)) {
      head = selector;
    } else {
      head = headOf(selector);
      if (!head) return refuse(PHASE_PR_UNKNOWN);
    }
    if (isPhaseBranch(head)) return refuse(PHASE_PR_REASON);
  }
  return null;
}

// `gh pr merge` in its parsed form: only the orchestrator, only this repository's pull request
// by number, only into a phase branch, only with --squash.
function checkGhMerge(args, { flaggedVerb, otherRepository, isSubagent, lookupPrBase }) {
  if (isSubagent) return deny("Only the orchestrator merges, and only into a phase branch.");
  if (flaggedVerb || otherRepository || args.some((word) => /^https?:\/\//.test(word))) {
    return deny(MERGE_UNKNOWN_REASON);
  }
  let selector = null;
  for (let i = 0; i < args.length && selector === null; i += 1) {
    if (PR_MERGE_OPTIONS_WITH_VALUE.has(args[i])) i += 1;
    else if (!args[i].startsWith("-")) selector = args[i];
  }
  if (selector === null || !/^\d+$/.test(selector)) return deny(MERGE_UNKNOWN_REASON);
  let base;
  try {
    base = lookupPrBase(Number(selector));
  } catch {
    base = null;
  }
  if (!base) return deny(`Could not confirm the base branch of #${selector}; not merging.`);
  if (PROTECTED_BRANCHES.has(base)) {
    return deny("Pull requests into master are merged by the owner only.");
  }
  if (!args.some((word) => word === "--squash" || /^-[a-z]*s[a-z]*$/.test(word))) {
    return deny("Issue pull requests are merged into the phase branch with --squash.");
  }
  return null;
}

// `gh api …` from its words: a state change of a pull request through REST or GraphQL.
function checkGhApi(words, { refuse, headOf, elsewhere }) {
  const has = (pattern) => words.some((word) => pattern.test(word));
  const method = () => {
    for (let i = 0; i < words.length; i += 1) {
      const inline = /^(?:-X|--method)=?(.+)$/.exec(words[i])?.[1];
      if (inline) return inline.toUpperCase();
      if (words[i] === "-X" || words[i] === "--method") return (words[i + 1] ?? "").toUpperCase();
    }
    return null;
  };
  if (words.some(isDynamic) && has(/graphql|pulls|issues/)) {
    // An endpoint, a field or a query the shell fills in cannot be read.
    return refuse(PHASE_PR_UNKNOWN);
  }
  if (words.includes("graphql") || has(/(^|\/)graphql$/)) {
    // A mutation names its pull request by a node ID, and a query read from a file cannot be
    // seen at all: neither can be matched to a pull request, so both count as a phase one.
    if (has(PR_STATE_MUTATIONS) || has(/=@/) || words.includes("--input")) {
      return refuse(PHASE_PR_REASON);
    }
    if (has(/\bupdatePullRequest\b/) && has(/\bstate\b/)) return refuse(PHASE_PR_REASON);
    return null;
  }
  // Merging through the REST endpoint: a phase pull request is merged by the owner only.
  const merged = words
    .map((word) => /(?:^|\/)pulls\/(\d+)\/merge(?:\?.*)?$/.exec(word)?.[1])
    .find(Boolean);
  if (merged && method() === "PUT") {
    const head = elsewhere ? null : headOf(merged);
    if (!head) return refuse(PHASE_PR_UNKNOWN);
    return isPhaseBranch(head) ? refuse(PHASE_PR_REASON) : null;
  }
  const number = words
    .map((word) => /(?:^|\/)(?:pulls|issues)\/(\d+)(?:\?.*)?$/.exec(word)?.[1])
    .find(Boolean);
  if (!number) return null;
  const fields = [];
  for (let i = 0; i < words.length; i += 1) {
    const inline = /^(?:-f|-F|--field|--raw-field)=?(.+)$/.exec(words[i])?.[1];
    if (inline) fields.push(inline);
    else if (/^(?:-f|-F|--field|--raw-field)$/.test(words[i])) fields.push(words[i + 1] ?? "");
  }
  const changesState =
    fields.some((field) => /^(?:state|draft)=/.test(field)) || words.includes("--input");
  if (!changesState) return null;
  if (elsewhere) return refuse(PHASE_PR_UNKNOWN);
  const head = headOf(number);
  if (!head) return refuse(PHASE_PR_UNKNOWN);
  return isPhaseBranch(head) ? refuse(PHASE_PR_REASON) : null;
}

// --- the stage and campaign of a paid eval run -------------------------------------------------
//
// A paid eval run in the loop spends from the loop's phase campaign at the stage `issue`
// (packages/llm-agent/evals/budget.py). Declaring `--stage phase-pr` lifts both stops for issue
// runs, and that run belongs to CI after the owner makes the phase pull request ready; setting
// or clearing SEBELA_EVAL_CAMPAIGN renames the campaign the loop named, and
// SEBELA_EVAL_KEPT_RUNS hides the spend of the other worktrees from the runner. The loop and
// subagents do none of these; an interactive main session asks the owner. The rule reads the
// words of each simple command, so quoted text that mentions the option or a variable — a commit
// message, an issue comment, a search pattern — is not refused.
const EVAL_VARIABLE = /^SEBELA_EVAL_(?:CAMPAIGN|KEPT_RUNS)$/;
const EVAL_VARIABLE_ASSIGNED = /^SEBELA_EVAL_(?:CAMPAIGN|KEPT_RUNS)=/;
// Programs whose arguments set or clear variables for what follows.
const VARIABLE_PROGRAMS = new Set(["export", "declare", "typeset", "readonly", "local", "unset"]);
const PHASE_PR_STAGE_REASON =
  "A paid eval run with `--stage phase-pr` is the phase pull request's run: it belongs to CI, after the owner marks the phase pull request ready, and is never started by an agent (docs/testing.md, Running paid evals; docs/permissions.md). Run the issue's affected cases with `--stage issue`, written in plain text, within the stops for issue runs.";
const EVAL_VARIABLE_REASON =
  "SEBELA_EVAL_CAMPAIGN and SEBELA_EVAL_KEPT_RUNS are set by the phase loop and are not set, changed or cleared by an agent: they name the phase's eval campaign and the loop's record of what was spent (docs/testing.md, Running paid evals; docs/permissions.md). Name the phase's own campaign with `--campaign <phase-folder>`.";

function checkEvalStage(fullCommand, { restricted }) {
  const refuse = (reason) => (restricted ? deny(reason) : { reason, decision: "ask" });
  for (const { words, from } of invocations(fullCommand).found) {
    for (let i = 0; i < words.length; i += 1) {
      const word = words[i];
      // The stage of a run, also one the shell fills in: `--stage "$STAGE"` cannot be read.
      const stage =
        word === "--stage" ? words[i + 1] : word.startsWith("--stage=") ? word.slice(8) : null;
      if (stage !== null && i >= from && (stage === "phase-pr" || isDynamic(stage))) {
        return refuse(PHASE_PR_STAGE_REASON);
      }
      // An assignment in front of the program, or among env's arguments.
      if (EVAL_VARIABLE_ASSIGNED.test(word) && i < from) return refuse(EVAL_VARIABLE_REASON);
    }
    const program = programOf(words[from]);
    const args = words.slice(from + 1);
    if (VARIABLE_PROGRAMS.has(program)) {
      if (args.some((word) => EVAL_VARIABLE.test(word) || EVAL_VARIABLE_ASSIGNED.test(word))) {
        return refuse(EVAL_VARIABLE_REASON);
      }
    }
    // env's own way of dropping a variable, wherever env stands among the wrappers.
    const env = words.findIndex((word, index) => index <= from && programOf(word) === "env");
    if (env !== -1) {
      const dropped = words.slice(env + 1).some((word, index, list) => {
        if (word.startsWith("--unset=")) return EVAL_VARIABLE.test(word.slice(8));
        if (/^-u./.test(word)) return EVAL_VARIABLE.test(word.slice(2));
        return (word === "-u" || word === "--unset") && EVAL_VARIABLE.test(list[index + 1] ?? "");
      });
      if (dropped) return refuse(EVAL_VARIABLE_REASON);
    }
  }
  return null;
}

// Returns null when the call may proceed, { reason } when it must be refused, or
// { reason, decision: "ask" } when only the owner's confirmation may let it through.
//   toolName, toolInput   from the hook input
//   mainRoot              absolute path of the main checkout
//   cwd                   directory the session runs in
//   isSubagent            the call comes from a subagent
//   unattended            the call comes from the phase loop
//   lookupPrBase(number)  returns the base branch of a pull request
//   lookupPrHead(selector) returns the head branch of a pull request named by number, URL or
//                         branch; throws or returns nothing when it cannot be found
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
  lookupPrHead = () => null,
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
    if (restricted && touchesProduction(command)) return deny(PRODUCTION_REASON);
    if (restricted && changesSharedStack(command)) return deny(SHARED_STACK_REASON);
    if (restricted && mentionsContext(command)) {
      return deny(
        ".context/ holds the owner's private notes; agents do not read it (docs/permissions.md). To search the checkout, leave it out with --exclude-dir=.context (grep) or -path ./.context -prune (find).",
      );
    }
    return (
      checkEvalStage(command, { restricted }) ??
      checkGh(command, {
        restricted,
        unattended,
        isSubagent,
        lookupPrHead,
        lookupPrBase,
        currentBranch,
      }) ??
      checkPush(command, { currentBranch })
    );
  }

  return null;
}
