import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateToolCall, invokesPrMerge } from "./guard.mjs";

const mainRoot = "/repo";
const call = (toolName, toolInput, extra = {}) =>
  evaluateToolCall({ toolName, toolInput, mainRoot, cwd: mainRoot, ...extra });
const bash = (command, extra) => call("Bash", { command }, extra);
const ownRoot = "/repo/.worktrees/feat-1-x";
const own = { cwd: ownRoot, worktreeRoot: ownRoot, isSubagent: true, unattended: true };

// --- editing code in the main checkout -------------------------------------

test("editing app code in the main checkout is refused", () => {
  assert.ok(call("Edit", { file_path: "/repo/apps/api/src/index.ts" }));
  assert.ok(call("Write", { file_path: "/repo/packages/db/schema.ts" }));
});

test("editing app code inside a worktree is allowed", () => {
  assert.equal(
    call("Edit", { file_path: "/repo/.worktrees/feat-1-x/apps/api/src/index.ts" }),
    null,
  );
});

test("editing docs, plans and agent configuration in the main checkout is allowed", () => {
  assert.equal(call("Edit", { file_path: "/repo/docs/testing.md" }), null);
  assert.equal(call("Write", { file_path: "/repo/.plan/done/03-web/prd.md" }), null);
  assert.equal(call("Edit", { file_path: "/repo/.claude/agents/reviewer.md" }), null);
});

test("relative paths are resolved against the session directory", () => {
  assert.ok(call("Edit", { file_path: "apps/web/page.tsx" }));
});

test("reading code in the main checkout is allowed", () => {
  assert.equal(call("Read", { file_path: "/repo/apps/api/src/index.ts" }), null);
});

// --- environment files -----------------------------------------------------

test("environment files cannot be read or edited", () => {
  assert.ok(call("Read", { file_path: "/repo/.env" }));
  assert.ok(call("Read", { file_path: "/repo/.worktrees/x/.env.local" }));
  assert.ok(call("Edit", { file_path: "/repo/.env.production" }));
});

test("the example environment file can be read", () => {
  assert.equal(call("Read", { file_path: "/repo/.env.example" }), null);
});

test("the example secrets file can be read and edited like the example environment", () => {
  for (const tool of ["Read", "Edit", "Write"])
    assert.equal(call(tool, { file_path: "/repo/.env.secrets.example" }), null, tool);
  assert.equal(call("Read", { file_path: `${ownRoot}/.env.secrets.example` }, own), null);
  assert.equal(bash("cat .env.secrets.example"), null);
  assert.equal(call("Grep", { pattern: "KEY", glob: ".env.secrets.example" }), null);
});

test("the owner's secrets file is refused everywhere, in every form", () => {
  for (const file_path of [
    "/repo/.env.secrets",
    `${ownRoot}/.env.secrets`,
    `${ownRoot}/apps/mcp-admin/.env.secrets`,
  ]) {
    for (const tool of ["Read", "Write", "Edit"]) {
      assert.ok(call(tool, { file_path }), `${tool} ${file_path}`);
      assert.ok(call(tool, { file_path }, own), `${tool} ${file_path} from a worktree`);
    }
  }
  assert.ok(bash("cat /repo/.env.secrets"));
  assert.ok(bash("node --env-file=../../.env.secrets -e 1", own));
  assert.ok(call("Grep", { pattern: "KEY", glob: ".env.secrets" }));
  assert.ok(call("Glob", { pattern: "**/.env.secrets*" }));
});

test("shell commands naming an environment file are refused", () => {
  assert.ok(bash("cat .env"));
  assert.ok(bash("grep KEY ./.env.local"));
  assert.ok(bash("source /repo/.env && echo ok"));
});

test("shell commands naming only the example file are allowed", () => {
  assert.equal(bash("cat .env.example"), null);
  assert.equal(bash("cp .env.example /tmp/example"), null);
});

test("words that merely contain .env are not refused", () => {
  assert.equal(bash("pnpm test --filter dotenv"), null);
  assert.equal(bash("node harness/worktree.mjs create feat/1-env-docs"), null);
});

test("agents may read, create and edit local environment files inside their own worktree", () => {
  for (const tool of ["Read", "Write", "Edit", "MultiEdit"]) {
    assert.equal(call(tool, { file_path: ".env.local" }, own), null, tool);
    assert.equal(call(tool, { file_path: `${ownRoot}/apps/web/.env.local` }, own), null, tool);
  }
  assert.equal(
    call("Read", { file_path: "../../.env.local" }, { ...own, cwd: `${ownRoot}/apps/web` }),
    null,
  );
});

test("the local environment exception requires a confirmed worktree containing the session", () => {
  assert.ok(call("Read", { file_path: `${ownRoot}/.env.local` }, { cwd: ownRoot }));
  assert.ok(call("Read", { file_path: `${ownRoot}/.env.local` }, { ...own, cwd: mainRoot }));
  assert.ok(
    call("Read", { file_path: ".env.local" }, { ...own, worktreeRoot: mainRoot, cwd: mainRoot }),
  );
});

test("other worktrees, the main checkout and production environment files stay private", () => {
  for (const file_path of [
    "/repo/.env.local",
    "/repo/.worktrees/other/.env.local",
    `${ownRoot}-other/.env.local`,
    `${ownRoot}/.env`,
    `${ownRoot}/.env.production`,
    `${ownRoot}/.env.local.backup`,
  ]) {
    for (const tool of ["Read", "Write", "Edit"])
      assert.ok(call(tool, { file_path }, own), file_path);
  }
});

test("the local environment exception checks symbolic link destinations too", () => {
  for (const target of [
    "/repo/.env.local",
    "/outside/.env.local",
    `${ownRoot}/.env.production`,
    "/outside/plain.txt",
  ]) {
    const realpath = (p) => (p === `${ownRoot}/.env.local` ? target : p);
    assert.ok(call("Read", { file_path: ".env.local" }, { ...own, realpath }), target);
  }
  assert.ok(
    call(
      "Write",
      { file_path: ".env.local" },
      {
        ...own,
        realpath: (p) => (p === `${ownRoot}/.env.local` ? null : p),
      },
    ),
  );
  assert.equal(
    call(
      "Read",
      { file_path: ".env.local" },
      {
        ...own,
        realpath: (p) => (p === `${ownRoot}/.env.local` ? `${ownRoot}/config/.env.local` : p),
      },
    ),
    null,
  );
});

test("a linked session directory cannot turn another worktree into its own", () => {
  assert.ok(
    call(
      "Read",
      { file_path: ".env.local" },
      {
        ...own,
        realpath: (p) => p.replace(ownRoot, "/repo/.worktrees/other"),
      },
    ),
  );
});

test("search tools may name the exact local file in their own worktree", () => {
  assert.equal(call("Glob", { pattern: ".env.local" }, own), null);
  assert.equal(call("Grep", { pattern: "WEB_PORT", path: ownRoot, glob: ".env.local" }, own), null);
  assert.ok(call("Glob", { pattern: "**/.env.local" }, own));
  assert.ok(call("Glob", { pattern: "../other/.env.local" }, own));
  assert.ok(call("Grep", { pattern: "x", path: mainRoot, glob: ".env.local" }, own));
  assert.ok(call("Glob", { pattern: ".env*" }, own));
});

test("simple shell commands may use local environment files in their own worktree", () => {
  for (const command of [
    "cat .env.local",
    "sed -i 's/CUSTOM_SETTING=off/CUSTOM_SETTING=on/' .env.local",
    "cp .env.example .env.local",
    "node --env-file=.env.local app.mjs",
    `cat '${ownRoot}/apps/web/.env.local'`,
    `cat '${ownRoot}/folder with spaces/.env.local'`,
  ])
    assert.equal(bash(command, own), null, command);
});

test("shell commands cannot use the exception for foreign files or ambiguous paths", () => {
  for (const command of [
    "cat /repo/.env.local",
    "cat ../other/.env.local",
    "cat .env.production",
    "cat .env.local /repo/.env",
    "cd /repo && cat .env.local",
    "cat $OTHER/.env.local",
    "cat ~/.env.local",
    "cat ../*/.env.local",
    "cat '/other folder/.env.local'",
    "cat .env.local; cd /repo; cat .env.local",
    "cat .env.local; python -c \"open('.env.production')\"",
    "cat .env*",
    "cat .env.local*",
  ])
    assert.ok(bash(command, own), command);
  assert.ok(
    bash("cat .env.local", {
      ...own,
      realpath: (p) => (p === `${ownRoot}/.env.local` ? "/repo/.env.local" : p),
    }),
  );
});

// --- the owner's private notes ---------------------------------------------

test("subagents cannot read .context", () => {
  assert.ok(call("Read", { file_path: "/repo/.context/profile-notes.md" }, { isSubagent: true }));
  assert.ok(bash("cat .context/profile-notes.md", { isSubagent: true }));
});

test("unattended runs cannot read .context", () => {
  assert.ok(call("Grep", { path: "/repo/.context" }, { unattended: true }));
});

test("the .context readme stays readable", () => {
  assert.equal(call("Read", { file_path: "/repo/.context/README.md" }, { isSubagent: true }), null);
});

test("the owner's interactive session may read .context", () => {
  assert.equal(call("Read", { file_path: "/repo/.context/profile-notes.md" }), null);
});

// --- pushing ---------------------------------------------------------------

test("pushing to master is refused", () => {
  assert.ok(bash("git push origin master"));
  assert.ok(bash("git push origin HEAD:master"));
  assert.ok(bash("git push origin main"));
});

test("force-pushing is refused", () => {
  assert.ok(bash("git push --force origin feat/1-x"));
  assert.ok(bash("git push -f origin feat/1-x"));
  assert.ok(bash("git push --force-with-lease origin feat/1-x"));
  assert.ok(bash("git push origin +feat/1-x"));
});

test("pushing an issue or phase branch is allowed", () => {
  assert.equal(bash("git push -u origin feat/12-profile-api"), null);
  assert.equal(bash("git push origin phase/02-api-db"), null);
});

// --- merging ---------------------------------------------------------------

const lookup = (bases) => (number) => bases[number] ?? null;

test("the orchestrator may squash-merge into a phase branch", () => {
  const result = bash("gh pr merge 41 --squash --delete-branch", {
    lookupPrBase: lookup({ 41: "phase/02-api-db" }),
  });
  assert.equal(result, null);
});

test("merging into master is refused", () => {
  assert.ok(bash("gh pr merge 42 --merge", { lookupPrBase: lookup({ 42: "master" }) }));
});

test("merging without --squash into a phase branch is refused", () => {
  assert.ok(bash("gh pr merge 41 --merge", { lookupPrBase: lookup({ 41: "phase/02-api-db" }) }));
});

test("merging without a pull request number is refused", () => {
  assert.ok(bash("gh pr merge --squash", { lookupPrBase: lookup({}) }));
});

test("merging when the base cannot be confirmed is refused", () => {
  assert.ok(
    bash("gh pr merge 43 --squash", {
      lookupPrBase: () => {
        throw new Error("offline");
      },
    }),
  );
});

test("subagents never merge", () => {
  assert.ok(
    bash("gh pr merge 41 --squash", {
      isSubagent: true,
      lookupPrBase: lookup({ 41: "phase/02-api-db" }),
    }),
  );
});

test("a merge or push chained after another command is still checked", () => {
  assert.ok(bash("git fetch && git push origin master"));
  assert.ok(bash("cd x; gh pr merge 42 --merge", { lookupPrBase: lookup({ 42: "master" }) }));
});

test("text that only mentions a merge or a push is not treated as one", () => {
  assert.equal(bash("echo 'then run gh pr merge <number> --squash'"), null);
  assert.equal(
    bash("python3 - <<'EOF'\ndoc = '(`gh pr merge <number>`) and `git push origin master`'\nEOF"),
    null,
  );
});

test("a real merge is recognised for the post-merge reminder, a mention is not", () => {
  assert.equal(invokesPrMerge("gh pr merge 41 --squash --delete-branch"), true);
  assert.equal(invokesPrMerge("gh pr checks 41 --watch && gh pr merge 41 --squash"), true);
  assert.equal(
    invokesPrMerge("python3 - <<'EOF'\nx = 'merge with `gh pr merge <number>`'\nEOF"),
    false,
  );
  assert.equal(invokesPrMerge(undefined), false);
});

// --- review findings: refspec spellings, bare pushes, other repositories, search tools ---

test("pushing to master under another refspec spelling is refused", () => {
  assert.ok(bash("git push origin HEAD:refs/heads/master"));
  assert.ok(bash("git push origin feat/1-x:+master"));
  assert.ok(bash("git push origin refs/heads/main"));
});

test("a bare push is refused while master is checked out", () => {
  assert.ok(bash("git push", { currentBranch: "master" }));
  assert.ok(bash("git push origin", { currentBranch: "master" }));
  assert.equal(bash("git push", { currentBranch: "feat/1-x" }), null);
});

test("pushes that name every branch, or a quoted master, are refused", () => {
  assert.ok(bash("git push --all origin", { currentBranch: "feat/1-x" }));
  assert.ok(bash("git push --mirror origin", { currentBranch: "feat/1-x" }));
  assert.ok(bash("git push origin 'master'", { currentBranch: "feat/1-x" }));
});

test("a bare or HEAD push is refused when the branch it pushes cannot be known", () => {
  assert.ok(bash("git push"));
  assert.ok(bash("cd ../other && git push", { currentBranch: "feat/1-x" }));
  assert.ok(bash("git -C ../other push origin HEAD", { currentBranch: "feat/1-x" }));
  assert.equal(bash("cd x && git push origin feat/1-x", { currentBranch: "feat/1-x" }), null);
});

test("a merge that redirects gh to another repository through the environment is refused", () => {
  const lookupPrBase = lookup({ 41: "phase/02-api-db" });
  assert.ok(bash("GH_REPO=someone/else gh pr merge 41 --squash", { lookupPrBase }));
  assert.ok(bash("export GH_HOST=evil.example; gh pr merge 41 --squash", { lookupPrBase }));
});

test("merging a pull request of another repository is refused", () => {
  const lookupPrBase = lookup({ 41: "phase/02-api-db" });
  assert.ok(bash("gh pr merge 41 --squash --repo someone/else", { lookupPrBase }));
  assert.ok(bash("gh pr merge 41 --squash -R someone/else", { lookupPrBase }));
  assert.ok(bash("gh pr merge https://github.com/someone/else/pull/41 --squash", { lookupPrBase }));
});

test("search tools cannot be pointed at environment files by pattern", () => {
  assert.ok(call("Grep", { pattern: "KEY", path: "/repo", glob: ".env*" }));
  assert.ok(call("Glob", { pattern: "**/.env.local" }));
  assert.equal(call("Glob", { pattern: "**/.env.example" }), null);
});

test("search tools cannot be pointed at .context by pattern when restricted", () => {
  assert.ok(call("Glob", { pattern: ".context/**" }, { unattended: true }));
  assert.ok(
    call("Grep", { pattern: "x", path: "/repo", glob: ".context/*.md" }, { isSubagent: true }),
  );
});

test("unattended runs cannot change repository settings, secrets or credentials", () => {
  for (const command of [
    "gh api repos/x/y/branches/master/protection -X DELETE",
    "gh repo edit --visibility private",
    "gh secret set TOKEN",
    "gh auth token",
    "gh label delete trial",
    "gh workflow disable ci.yml",
    "git config core.hooksPath /dev/null",
    "cd x && gh api user",
  ]) {
    assert.ok(bash(command, { unattended: true }), command);
  }
  assert.equal(bash("gh pr view 4 --json state", { unattended: true }), null);
  assert.equal(bash("gh api user"), null);
});

test("unattended runs cannot edit the harness that governs them in the main checkout", () => {
  for (const file_path of [
    "/repo/.claude/settings.json",
    "/repo/.claude/agents/orchestrator.md",
    "/repo/harness/hooks/pre-tool-use.mjs",
    "/repo/.github/workflows/ci.yml",
    "/repo/.git/hooks/pre-commit",
    "/repo/.git/worktrees/feat-1-x/HEAD",
  ]) {
    assert.ok(call("Edit", { file_path }, { unattended: true }), file_path);
  }
  assert.ok(bash("sed -i s/x/y/ .claude/settings.json", { unattended: true }));
  assert.ok(bash("echo x > .git/hooks/pre-push", { unattended: true }));
});

test("unattended runs may change the harness inside a worktree, through a pull request", () => {
  assert.equal(
    call(
      "Edit",
      { file_path: "/repo/.worktrees/ci-1-x/.github/workflows/ci.yml" },
      { unattended: true },
    ),
    null,
  );
  assert.equal(call("Edit", { file_path: "/repo/docs/agents.md" }, { unattended: true }), null);
  assert.equal(bash("node harness/worktree.mjs list", { unattended: true }), null);
  assert.equal(call("Edit", { file_path: "/repo/.claude/settings.json" }), null);
});

test("a symbolic link does not hide where an edit really lands", () => {
  const realpath = (p) => p.replace("/repo/.worktrees/x/link", "/repo/.claude");
  assert.ok(
    call(
      "Edit",
      { file_path: "/repo/.worktrees/x/link/settings.json" },
      { unattended: true, realpath },
    ),
  );
  assert.ok(
    call(
      "Edit",
      { file_path: "/repo/.worktrees/x/apps/web/page.tsx" },
      {
        realpath: (p) => p.replace("/repo/.worktrees/x/apps", "/repo/apps"),
      },
    ),
  );
});

test("both the written and the resolved path are checked", () => {
  assert.ok(call("Read", { file_path: "/repo/.env" }, { realpath: () => "/repo/README.md" }));
  assert.ok(
    call(
      "Edit",
      { file_path: "/repo/.claude/settings.json" },
      { unattended: true, realpath: () => "/tmp/x" },
    ),
  );
  assert.equal(
    call("Read", { file_path: "/repo/docs/a.md" }, { realpath: () => "/repo/docs/b.md" }),
    null,
  );
});

test("a symbolic link that cannot be resolved is refused", () => {
  assert.ok(call("Write", { file_path: "/repo/.worktrees/x/dangling" }, { realpath: () => null }));
});

test("unattended agents may keep their shared memory in the main checkout, and nothing else there", () => {
  assert.equal(
    call(
      "Write",
      { file_path: "/repo/.claude/agent-memory-local/backend-developer/postgres.md" },
      { unattended: true },
    ),
    null,
  );
  assert.equal(
    call(
      "Edit",
      { file_path: "/repo/.claude/agent-memory-local/reviewer/MEMORY.md" },
      { unattended: true },
    ),
    null,
  );
  assert.ok(
    call(
      "Edit",
      { file_path: "/repo/.claude/agent-memory-local/../settings.json" },
      { unattended: true },
    ),
  );
  assert.ok(
    call("Write", { file_path: "/repo/.claude/agent-memory/reviewer/x.md" }, { unattended: true }),
  );
  assert.ok(
    call("Edit", { file_path: "/repo/.claude/agent-memory-local/README.md" }, { unattended: true }),
  );
});

// --- needless refusals (found in the phase 0–2 transcripts) ----------------

const loop = { unattended: true, isSubagent: true };

test("reading the harness settings with a read-only shell command is allowed", () => {
  for (const command of [
    "cd /repo/.worktrees/feat-1-x && cat .claude/settings.json",
    'grep -n -A6 "WorktreeCreate\\|WorktreeRemove" .claude/settings.json',
    "cat .claude/settings.json | head -40",
    "sed -n 1,80p .claude/settings.json",
    "git diff origin/phase/01-x...HEAD -- .claude/settings.json package.json 2>&1 | head",
    "git -C /repo/.worktrees/feat-1-x diff origin/phase/01-x...HEAD -- .claude/settings.json",
    "ls .claude && wc -l .claude/settings.json >/dev/null",
  ]) {
    assert.equal(bash(command, loop), null, command);
  }
});

test("anything that could write the harness settings through the shell is still refused", () => {
  for (const command of [
    "sed -i s/x/y/ .claude/settings.json",
    "cat x > .claude/settings.json",
    "cat .claude/settings.json | tee .claude/settings.json",
    "cp /tmp/s .claude/settings.json",
    "python3 - <<'EOF'\nopen('.claude/settings.json','w')\nEOF",
    "cat $(echo .claude/settings.json)",
    "sed -n 'w out' .claude/settings.json",
    "find .claude/settings.json -delete",
    "cat .git/config",
    "cat .git/hooks/pre-commit",
  ]) {
    assert.ok(bash(command, loop), command);
  }
});

test("what the shell would read differently from the guard is refused", () => {
  for (const command of [
    "cat \\' > .claude/settings.json \\'",
    'cat .claude/settings.json \\" > .claude/settings.json \\"',
    "git diff $X -- .claude/settings.json",
    'git diff "$X" -- .claude/settings.json',
    "git diff {--output=.claude/settings.json,} HEAD",
    "git diff --outpu* .claude/settings.json",
    "git grep -nO vi x -- .claude/settings.json",
    "git diff --ext-diff -- .claude/settings.json",
    "cat .claude/settings.json # > nothing",
    "sed -n 1,80p .claude/settings.json -i",
    "sed -n 1p .claude/settings.json --in-place",
  ]) {
    assert.ok(bash(command, loop), command);
  }
});

test("Git configuration cannot be changed around the parser", () => {
  for (const command of [
    "git -C . config core.hooksPath /dev/null",
    "git --no-pager config core.hooksPath x",
    "env git config core.hooksPath x",
    "A=1 git config core.hooksPath x",
    "/usr/bin/git config core.hooksPath x",
    'sh -c "git config core.hooksPath x"',
    "(git config core.hooksPath x)",
    "git config $(echo core.hooksPath x)",
    "git --no-pager -c core.hooksPath=/dev/null commit -m x",
    "git -C . -c core.hooksPath=x commit -m x",
    "git --config-env=core.hooksPath=X commit -m x",
    "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git commit -m x",
    "export GIT_CONFIG_PARAMETERS=x && git commit -m x",
  ]) {
    assert.ok(bash(command, loop), command);
  }
  assert.equal(bash("git -C /repo/.worktrees/feat-1-x config --get core.hooksPath", loop), null);
  assert.equal(bash('git commit -m "use git config for hooks"', loop), null);
});

test("Git configuration cannot be changed by quoting, wrappers, editors or other config files", () => {
  for (const command of [
    "g'i't config core.hooksPath /dev/null",
    'g"it" config core.hooksPath /dev/null',
    "stdbuf -o0 git config core.hooksPath /dev/null",
    "busybox git config core.hooksPath x",
    "git config edit",
    "git config set core.hooksPath x",
    "git config unset core.hooksPath",
    "git --attr-source HEAD config core.hooksPath x",
    "git --exec-path=/tmp/evil status",
    "HOME=/tmp/h git commit -m x",
    "XDG_CONFIG_HOME=/tmp/x git commit -m x",
    "GIT_DIR=/tmp/g git commit -m x",
    "env HOME=/tmp/h git commit -m x",
    "export HOME=/tmp/h && git commit -m x",
    "git config $X core.hooksPath",
    "for f in $(git config core.hooksPath x); do :; done",
    "x=$(git -c core.hooksPath=y commit -m z)",
    "T=1; git -c core.hooksPath=y commit -m z",
    'git commit -m "$(echo x)" && sh -c "git config core.hooksPath x"',
    "X=$(git config core.hooksPath /dev/null)",
    "x=$(git -c core.hooks$P=y commit -m z)",
    "x=$(git -c core.hooks:Path=y commit -m z)",
    "eval git commit -m 'x; git config core.hooksPath y' $(true)",
    "bash -c \"git commit -m 'git config core.hooksPath y'\" $(true)",
    "foo -m 'git config core.hooksPath x' $(true)",
    'git commit -m "x" && (sh -c "git config core.hooksPath x")',
    'git commit -m "$(echo config)" -c core.hooksPath=x',
  ]) {
    assert.ok(bash(command, loop), command);
  }
  for (const command of [
    "git config get core.hooksPath",
    "git config list",
    "git config --list",
    "git --no-pager log --oneline -3",
    "git -C /repo/.worktrees/feat-1-x status",
    "cd x && for f in $(git ls-files); do cat $f; done",
    "B=origin/phase/01-x; git show $B:package.json | grep -n node",
    "for c in a b; do git show --stat $c | head; done",
    'env -i PATH="$PATH" HOME="$HOME" docker compose config',
  ]) {
    assert.equal(bash(command, loop), null, command);
  }
});

test("abbreviated git options that write a file are refused on harness reads", () => {
  for (const command of [
    "git diff --outp=.claude/settings.json HEAD",
    "git diff --o=.claude/settings.json HEAD",
    "git grep --open x -- .claude/settings.json",
    "git show --te HEAD -- .claude/settings.json",
    "git diff --ext -- .claude/settings.json",
    "./git diff -- .claude/settings.json",
    "tools/git log -- .claude/settings.json",
    "git --git-dir=/tmp/x/.git log -- .claude/settings.json",
    "git --work-tree /tmp diff -- .claude/settings.json",
  ]) {
    assert.ok(bash(command, loop), command);
  }
  assert.equal(bash("git log --oneline -- .claude/settings.json", loop), null);
});

test("a commit message mentioning config in a command the guard cannot read points to -F", () => {
  const refusal = bash(
    'git add a && git commit -q -m "feat(config): share the lint config" && (cd packages/config && node --test)',
    loop,
  );
  assert.match(refusal.reason, /git commit -F/);
  assert.equal(bash('git commit -q -m "feat(config): share the lint config"', loop), null);
});

test("a refusal says how to do the same safely", () => {
  assert.match(bash("sed -i s/x/y/ .claude/settings.json", loop).reason, /Read or Grep tool/);
  assert.match(bash("python3 fix.py .env", loop).reason, /Edit or Write tool/);
  assert.match(
    bash("gh api repos/actions/checkout/releases/latest", loop).reason,
    /gh release view/,
  );
  assert.match(
    bash("git push --force-with-lease origin feat/1-x", loop).reason,
    /git merge origin\/phase/,
  );
  assert.match(bash("grep -rn x . | grep -v .context", loop).reason, /--exclude-dir=\.context/);
});

test("reading Git configuration is allowed, changing it is not", () => {
  for (const command of [
    "git config core.hooksPath",
    "git config --get core.hooksPath",
    "git config --list --show-origin",
    "pnpm install --frozen-lockfile 2>&1 | tail -5 && git config core.hooksPath",
  ]) {
    assert.equal(bash(command, loop), null, command);
  }
  for (const command of [
    "git config core.hooksPath /dev/null",
    "git config --unset core.hooksPath",
    "git config --global user.name x",
    "git config -e",
    "git config --add a.b c",
    "git config --replace-all a.b c",
    "git config --get core.hooksPath && git config core.hooksPath x",
    "git -c core.hooksPath=/dev/null commit -m x",
  ]) {
    assert.ok(bash(command, loop), command);
  }
});

test("leaving .context out of a search is not reading it", () => {
  for (const command of [
    "grep -rn slugify --exclude-dir=.context .",
    "grep -rn x --exclude-dir=node_modules --exclude-dir=.context --include=*.md .",
    "find . -path ./.git -prune -o -path ./.context -prune -o -type f -print",
    "git grep -n x -- . ':!.context'",
  ]) {
    assert.equal(bash(command, loop), null, command);
  }
  for (const command of [
    "ls -A .context",
    "grep -r x --exclude-dir=.context .context/",
    "find . -path ./.context -o -print",
    "find .context -type f",
  ]) {
    assert.ok(bash(command, loop), command);
  }
});

// --- everything else -------------------------------------------------------

test("ordinary commands pass", () => {
  assert.equal(bash("pnpm test"), null);
  assert.equal(bash("git status"), null);
  assert.equal(call("WebFetch", { url: "https://example.com" }), null);
});

// --- the shared Compose stack -------------------------------------------------

test("agents cannot start, stop or rebuild the shared Compose stack", () => {
  for (const command of [
    "pnpm stack:up",
    "pnpm --silent stack:down",
    "pnpm run stack:seed",
    "docker compose up --detach --wait",
    "docker compose --profile api up --build --detach",
    "docker compose -f compose.yaml down",
    "docker-compose restart postgres",
    "docker compose stop postgres",
    "docker compose rm -f api",
    "docker compose build api",
    "docker compose run --rm migrate",
    "docker compose -p sebela up -d",
    "docker compose --project-name=sebela down",
    "cd /repo && docker compose up -d",
    "COMPOSE_PROJECT_NAME=sebela docker compose up -d",
  ]) {
    assert.ok(bash(command, own), command);
    assert.ok(bash(command, { isSubagent: true }), command);
  }
});

test("agents may inspect the shared stack and use their own Compose project", () => {
  for (const command of [
    "docker compose ps",
    "docker compose logs postgres",
    "docker compose exec -T postgres psql -c 'select 1'",
    "docker compose config",
    "docker compose -p feat-232-check up -d",
    "docker compose --project-name feat-232-check down -v",
    "docker compose --project-name=feat-232-check build web",
    "COMPOSE_PROJECT_NAME=feat-232-check docker compose up -d",
    "pnpm test:api-stack",
    "pnpm --silent stack:api-keys create reviewer",
    "pnpm stack:logs",
  ]) {
    assert.equal(bash(command, own), null, command);
  }
});

test("the owner's interactive session may manage the shared stack", () => {
  assert.equal(bash("pnpm stack:up"), null);
  assert.equal(bash("docker compose up --detach --wait"), null);
});

// --- the production stack -------------------------------------------------------

test("agents cannot reach the production stack or run its scripts", () => {
  for (const command of [
    "docker exec sebela-production-api-1 env",
    "docker logs sebela-production-web-1",
    "docker inspect sebela-production-postgres-1",
    "docker cp sebela-production-api-1:/app/x .",
    "docker stop sebela-production-api-1",
    "docker compose -p sebela-production ps",
    "docker compose --project-name=sebela-production logs api",
    "docker compose -f compose.yaml -f infra/production/compose.yaml up -d",
    "docker compose --file infra/production/compose.yaml config",
    "COMPOSE_PROJECT_NAME=sebela-production docker compose exec api sh",
    "infra/scripts/deploy.sh rollback",
    "bash infra/scripts/restore.sh list",
    "sh ./infra/scripts/backup.sh",
    "sudo -u deploy infra/scripts/clear-demo.sh --confirm x",
  ]) {
    assert.ok(bash(command, own), command);
    assert.ok(bash(command, { isSubagent: true }), command);
  }
});

test("agents may still read the production scripts and test the composition", () => {
  for (const command of [
    "cat infra/scripts/deploy.sh",
    "sed -n 1,40p infra/production/compose.yaml",
    "node --test scripts/checks/production-stack.test.mjs",
    "pnpm test:production-stack",
    "docker ps",
  ]) {
    assert.equal(bash(command, own), null, command);
  }
});

test("the owner's interactive session may operate production", () => {
  assert.equal(bash("docker logs sebela-production-web-1"), null);
  assert.equal(bash("infra/scripts/deploy.sh rollback"), null);
});

// --- the state of a phase pull request (issue #371) --------------------------

const heads = (table) => (selector) => {
  if (!(selector in table)) throw new Error("no such pull request");
  return table[selector];
};
const phaseHeads = heads({ 50: "phase/07-ai-service", 51: "feat/12-thing" });
const inLoop = { unattended: true, lookupPrHead: phaseHeads };
const asSubagent = { isSubagent: true, lookupPrHead: phaseHeads };
const interactive = { lookupPrHead: phaseHeads };

test("the loop never marks a phase pull request ready, closes or reopens it", () => {
  for (const command of [
    "gh pr ready 50",
    "gh pr ready 50 --undo",
    "gh pr close 50",
    "gh pr close 50 --comment 'done' --delete-branch",
    "gh pr reopen 50",
    "cd x && gh pr ready 50",
    "gh pr checks 50 --watch; gh pr ready 50",
    "GH_PAGER=cat gh pr ready 50",
  ]) {
    for (const session of [inLoop, asSubagent, { ...inLoop, isSubagent: true }]) {
      const verdict = bash(command, session);
      assert.match(verdict?.reason ?? "", /phase pull request/, command);
      assert.notEqual(verdict.decision, "ask", command);
    }
  }
});

test("in an interactive session the owner is asked before a phase pull request changes state", () => {
  for (const command of ["gh pr ready 50", "gh pr close 50", "gh pr reopen 50"]) {
    const verdict = bash(command, interactive);
    assert.equal(verdict?.decision, "ask", command);
    assert.match(verdict.reason, /phase pull request/);
    assert.match(verdict.reason, /owner/);
  }
});

test("the state of an issue pull request may change", () => {
  for (const session of [inLoop, asSubagent, interactive]) {
    assert.equal(bash("gh pr ready 51", session), null);
    assert.equal(bash("gh pr close 51 --delete-branch", session), null);
    assert.equal(bash("gh pr reopen 51", session), null);
  }
});

test("a phase pull request named by its branch or URL is recognised", () => {
  const lookupPrHead = heads({
    "https://github.com/sebelapetr/sebela.dev/pull/50": "phase/07-ai-service",
  });
  assert.ok(bash("gh pr ready phase/07-ai-service", { unattended: true, lookupPrHead }));
  assert.ok(bash("gh pr close 'phase/07-ai-service'", { unattended: true, lookupPrHead }));
  assert.ok(
    bash("gh pr ready https://github.com/sebelapetr/sebela.dev/pull/50", {
      unattended: true,
      lookupPrHead,
    }),
  );
});

test("a state change without a named pull request acts on the checked-out branch", () => {
  const lookupPrHead = heads({});
  assert.ok(bash("gh pr ready", { ...inLoop, lookupPrHead, currentBranch: "phase/07-ai-service" }));
  assert.equal(
    bash("gh pr ready", { ...inLoop, lookupPrHead, currentBranch: "feat/12-thing" }),
    null,
  );
  // The branch is unknown, or the command moves elsewhere first: refused.
  assert.ok(bash("gh pr ready", { ...inLoop, lookupPrHead }));
  assert.ok(bash("cd ../x && gh pr close", { ...inLoop, lookupPrHead, currentBranch: "feat/1-x" }));
});

test("a state change whose pull request cannot be confirmed is refused", () => {
  assert.match(bash("gh pr ready 77", inLoop).reason, /Could not confirm/);
  assert.match(bash("gh pr close 77", asSubagent).reason, /Could not confirm/);
  assert.equal(bash("gh pr close 77", interactive).decision, "ask");
  assert.ok(bash("gh pr ready 51 --repo someone/else", inLoop));
  assert.ok(bash("gh pr ready 51 -R someone/else", asSubagent));
  assert.ok(bash("GH_REPO=someone/else gh pr ready 51", asSubagent));
});

test("the same state changes through gh api are refused for a phase pull request", () => {
  for (const command of [
    "gh api repos/sebelapetr/sebela.dev/pulls/50 -X PATCH -f state=closed",
    "gh api -X PATCH repos/sebelapetr/sebela.dev/pulls/50 -f state=open",
    "gh api --method PATCH /repos/sebelapetr/sebela.dev/issues/50 -f state=closed",
    "gh api repos/{owner}/{repo}/pulls/50 --method PATCH --field state=closed",
    "gh api repos/sebelapetr/sebela.dev/pulls/50 -X PATCH -F draft=false",
    "gh api repos/sebelapetr/sebela.dev/pulls/50 -X PATCH --input body.json",
    "gh api graphql -f query='mutation { markPullRequestReadyForReview(input: {pullRequestId: \"PR_x\"}) { clientMutationId } }'",
    "gh api graphql -f query='mutation { closePullRequest(input: {pullRequestId: \"PR_x\"}) { clientMutationId } }'",
    "gh api graphql -f query='mutation { reopenPullRequest(input: {pullRequestId: \"PR_x\"}) { clientMutationId } }'",
    "gh api graphql -f query='mutation { convertPullRequestToDraft(input: {pullRequestId: \"PR_x\"}) { clientMutationId } }'",
    "gh api graphql -F query=@mutation.graphql",
  ]) {
    assert.match(bash(command, asSubagent)?.reason ?? "", /phase pull request/, command);
    assert.equal(bash(command, interactive)?.decision, "ask", command);
  }
});

test("reading a pull request through gh api and changing an issue pull request stay allowed", () => {
  for (const command of [
    "gh api repos/sebelapetr/sebela.dev/pulls/50",
    "gh api repos/sebelapetr/sebela.dev/pulls/50/comments",
    "gh api repos/sebelapetr/sebela.dev/pulls/50/reviews -X POST -f event=COMMENT -f body=ok",
    "gh api repos/sebelapetr/sebela.dev/pulls/51 -X PATCH -f state=closed",
    "gh api repos/sebelapetr/sebela.dev/pulls/50 -X PATCH -f title='A better title'",
    "gh api graphql -f query='query { viewer { login } }'",
    "gh pr view 50 --json state",
    "gh pr edit 50 --body-file .tmp/body.md",
    "gh pr create --draft --base master --head phase/07-ai-service --title x --body y",
    "echo 'the owner runs gh pr ready 50'",
  ]) {
    assert.equal(bash(command, asSubagent), null, command);
    assert.equal(bash(command, interactive), null, command);
  }
});

// --- the gaps of the first guards (issue #384) -------------------------------------

const eachRestricted = [inLoop, asSubagent, { ...inLoop, isSubagent: true }];

test("the loop and subagents never declare the phase-PR stage of a paid eval run", () => {
  for (const command of [
    "uv run --locked python -m evals.run --all --campaign 07-ai-service --stage phase-pr --allowance 3.9",
    "node harness/with-secrets.mjs -- uv run --locked python -m evals.run --all --campaign 07-ai-service --stage phase-pr --allowance 3.9",
    "pnpm --filter @sebela/llm-agent eval -- --all --stage=phase-pr --allowance 3.9",
    "pnpm --silent eval --case S01-en --stage 'phase-pr' --allowance 1",
    'cd packages/llm-agent && pnpm eval --stage "phase-pr" --all --allowance 2',
    "pnpm eval --all --stage  phase-pr --allowance 2",
  ]) {
    for (const session of eachRestricted) {
      const verdict = bash(command, session);
      assert.match(verdict?.reason ?? "", /phase-pr/, command);
      assert.notEqual(verdict.decision, "ask", command);
    }
    assert.equal(bash(command, interactive)?.decision, "ask", command);
  }
});

test("the loop and subagents never set or clear the campaign the loop named", () => {
  for (const command of [
    "SEBELA_EVAL_CAMPAIGN=08-mcp-public pnpm eval --case S01-en --allowance 1",
    "export SEBELA_EVAL_CAMPAIGN=08-mcp-public",
    "env SEBELA_EVAL_CAMPAIGN=06-llm-agent pnpm eval --case S01-en --allowance 1",
    "cd packages/llm-agent && SEBELA_EVAL_CAMPAIGN= pnpm eval --campaign 08-mcp-public --case S01-en --allowance 1",
    "unset SEBELA_EVAL_CAMPAIGN; pnpm eval --campaign 08-mcp-public --case S01-en --allowance 1",
    "env -u SEBELA_EVAL_CAMPAIGN pnpm eval --campaign 08-mcp-public --case S01-en --allowance 1",
    "env --unset=SEBELA_EVAL_CAMPAIGN pnpm eval --campaign 08-mcp-public --case S01-en --allowance 1",
    "SEBELA_EVAL_KEPT_RUNS= pnpm eval --case S01-en --allowance 1",
    "unset SEBELA_EVAL_KEPT_RUNS",
  ]) {
    for (const session of eachRestricted) {
      const verdict = bash(command, session);
      assert.match(verdict?.reason ?? "", /SEBELA_EVAL/, command);
      assert.notEqual(verdict.decision, "ask", command);
    }
    assert.equal(bash(command, interactive)?.decision, "ask", command);
  }
});

test("an issue run, a free regrade and reading about the stage stay allowed", () => {
  for (const command of [
    "pnpm --silent eval --campaign 07-ai-service --stage issue --case S01-en --allowance 1",
    "pnpm --silent eval --campaign 07-ai-service --case S01-en --allowance 1",
    "uv run --locked python -m evals.run --regrade ../../.tmp/evals/llm-agent/run-1",
    "grep -rn -e '--stage phase-pr' docs packages/llm-agent",
    "grep -rn SEBELA_EVAL_CAMPAIGN= harness docs",
    "cat docs/testing.md",
    "uv run --locked pytest tests/evals -q",
  ]) {
    for (const session of [...eachRestricted, interactive]) {
      assert.equal(bash(command, session), null, command);
    }
  }
});

test("a phase pull request is only ever created as a draft", () => {
  const onPhase = { ...inLoop, currentBranch: "phase/07-ai-service" };
  for (const [command, session] of [
    ["gh pr create --base master --head phase/07-ai-service --title x --body y", inLoop],
    ["gh pr create --base master --head=phase/07-ai-service --title x --body y", inLoop],
    ["gh pr create -B master -H phase/07-ai-service -t x -b y", inLoop],
    ["gh pr create --head sebelapetr:phase/07-ai-service --title x --body y", inLoop],
    ["gh pr create --draft=false --head phase/07-ai-service --title x --body y", inLoop],
    ["gh pr create --head phase/07-ai-service --title x --body y --draft=false", inLoop],
    ["gh pr create --head phase/07-ai-service --title '--draft' --body '-d'", inLoop],
    ["gh pr create --head phase/07-ai-service --title x --body 'a; b --draft'", inLoop],
    ["gh pr create --base master --title x --body y", onPhase],
    ["gh pr create --fill", onPhase],
    ["git fetch && gh pr create --base master --head phase/07-ai-service --fill", inLoop],
  ]) {
    assert.match(bash(command, session)?.reason ?? "", /draft/, command);
    assert.match(bash(command, { ...session, isSubagent: true })?.reason ?? "", /draft/, command);
    const asked = bash(command, { ...session, unattended: false });
    assert.equal(asked?.decision, "ask", command);
  }
});

test("a pull request whose head cannot be told is not created without --draft", () => {
  // No --head and no known branch, or the command moves elsewhere first.
  assert.match(bash("gh pr create --base master --fill", inLoop).reason, /Could not confirm/);
  assert.match(
    bash("cd ../x && gh pr create --base master --fill", { ...inLoop, currentBranch: "feat/1-x" })
      .reason,
    /Could not confirm/,
  );
  assert.match(
    bash('gh pr create --head phase/07-ai-service --body "never closed', inLoop).reason,
    /Could not confirm/,
  );
  assert.equal(bash("gh pr create --draft --base master --fill", inLoop), null);
});

test("the loop's normal pull request steps still work", () => {
  const onIssue = { ...inLoop, currentBranch: "feat/12-thing" };
  for (const [command, session] of [
    ["gh pr create --draft --base master --head phase/07-ai-service --title x --body y", inLoop],
    ["gh pr create -d -B master -H phase/07-ai-service -t x -b y", inLoop],
    ["gh pr create --base master --head phase/07-ai-service --title x --body y --draft", inLoop],
    ["gh pr create --draft=true --head phase/07-ai-service --title x --body y", inLoop],
    ["gh pr create --base phase/07-ai-service --head feat/12-thing --title x --body y", inLoop],
    ["gh pr create --base phase/07-ai-service --title x --body-file .tmp/body.md", onIssue],
    [
      "gh pr create --base phase/07-ai-service --head feat/12-thing --title 'fix: a; b' --body \"Closes #12\n\n## What changed\nthings | more\"",
      inLoop,
    ],
    ["gh pr ready 51", inLoop],
    ["gh pr close 51 --delete-branch", inLoop],
    ["gh pr edit 50 --body-file .tmp/body.md", inLoop],
    ["gh pr view 50 --json state,isDraft", inLoop],
    ["gh pr checks 51 --watch", inLoop],
    ["gh pr list --base phase/07-ai-service --state open --json number", inLoop],
  ]) {
    assert.equal(bash(command, session), null, command);
  }
  assert.equal(
    bash("gh pr merge 41 --squash --delete-branch", {
      ...inLoop,
      lookupPrBase: lookup({ 41: "phase/07-ai-service" }),
    }),
    null,
  );
});

test("gh flags between gh, pr and the verb do not get a state change past the guard", () => {
  for (const command of [
    "gh pr -R sebelapetr/sebela.dev ready 50",
    "gh --repo sebelapetr/sebela.dev pr ready 50",
    "gh pr --repo=sebelapetr/sebela.dev close 50",
    "gh -R sebelapetr/sebela.dev pr reopen 50",
    "gh --repo=sebelapetr/sebela.dev pr -R sebelapetr/sebela.dev ready 51",
    "gh pr -R sebelapetr/sebela.dev create --head phase/07-ai-service --title x --body y",
    "gh --repo sebelapetr/sebela.dev pr create --base master --head phase/07-ai-service --fill",
    "gh pr --help ready 50",
  ]) {
    for (const session of [inLoop, asSubagent]) {
      const verdict = bash(command, session);
      assert.match(verdict?.reason ?? "", /Could not confirm/, command);
    }
    assert.equal(bash(command, interactive)?.decision, "ask", command);
  }
});

// --- smaller routes (issue #384, item 12) -------------------------------------------

test("a pull request verb or number hidden in a variable is unidentifiable", () => {
  for (const command of [
    "V=ready; gh pr $V 50",
    "gh pr ${VERB} 50",
    "gh pr `echo ready` 50",
    "gh pr $(echo close) 50",
    "N=50; gh pr ready $N",
    'gh pr close "$NUMBER"',
  ]) {
    assert.match(bash(command, asSubagent)?.reason ?? "", /Could not confirm/, command);
    assert.equal(bash(command, interactive)?.decision, "ask", command);
  }
  // Variables elsewhere in a gh call are no state change.
  assert.equal(bash('gh pr view "$NUMBER" --json state', asSubagent), null);
  assert.equal(bash('gh pr comment 51 --body "$TEXT"', asSubagent), null);
});

test("merging a phase pull request through the merge endpoint is refused", () => {
  for (const command of [
    "gh api -X PUT repos/sebelapetr/sebela.dev/pulls/50/merge",
    "gh api --method PUT /repos/{owner}/{repo}/pulls/50/merge -f merge_method=merge",
    "gh api repos/sebelapetr/sebela.dev/pulls/50/merge -X PUT",
    "gh api repos/sebelapetr/sebela.dev/pulls/77/merge --method=PUT",
  ]) {
    assert.match(bash(command, asSubagent)?.reason ?? "", /phase pull request/, command);
    assert.equal(bash(command, interactive)?.decision, "ask", command);
  }
  // Asking whether it is merged is a read.
  assert.equal(bash("gh api repos/sebelapetr/sebela.dev/pulls/50/merge", asSubagent), null);
});

test("a pull request body that mentions a state change on its own line is no state change", () => {
  for (const command of [
    'gh pr create --base phase/07-ai-service --head feat/12-thing --title x --body "Steps:\ngh pr close 50\ngh pr ready 50"',
    "gh pr comment 51 --body 'The owner then runs\ngh pr ready 50\nand merges.'",
    'gh issue comment 12 --body "Loop note:\n  gh pr create --head phase/07-ai-service --title x"',
    "git commit -m 'docs: explain\n\ngh pr reopen 50 is the owner'\\''s'",
  ]) {
    assert.equal(bash(command, inLoop), null, command);
    assert.equal(bash(command, asSubagent), null, command);
  }
});

test("a state change inside a command substitution in quotes still counts", () => {
  for (const command of [
    'echo "$(gh pr ready 50)"',
    'echo "state: `gh pr close 50`"',
    'echo "first\n$(true; gh pr reopen 50)"',
    "sh -c 'true'; gh pr ready 50",
    'echo "x" && gh pr ready 50',
    'echo "it\'s" ; gh pr ready 50',
  ]) {
    assert.match(bash(command, inLoop)?.reason ?? "", /phase pull request/, command);
  }
});

test("the eval and pull request rules read a hostile command quickly", () => {
  const hostile = [
    "unset ".repeat(20_000),
    `unset ${"A ".repeat(50_000)}`,
    " -u".repeat(40_000),
    `--stage${" ".repeat(100_000)}x`,
    `gh ${"-R o/r ".repeat(15_000)}x`,
    `gh pr ${"-- -".repeat(25_000)}`,
    `${"a=b ".repeat(25_000)}gh`,
    `gh api ${"pulls/1 ".repeat(12_000)}-X`,
    `gh pr create ${"'a' ".repeat(25_000)}`,
  ];
  for (const command of hostile) {
    const started = performance.now();
    for (const session of [inLoop, asSubagent, interactive]) bash(command, session);
    const took = performance.now() - started;
    assert.ok(took < 1_000, `${command.slice(0, 20)}… took ${Math.round(took)} ms`);
  }
  assert.ok(bash(`unset ${"A ".repeat(50_000)}SEBELA_EVAL_CAMPAIGN`, asSubagent));
});
