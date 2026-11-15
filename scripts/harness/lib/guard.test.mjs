import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateToolCall, invokesPrMerge } from "./guard.mjs";

const mainRoot = "/repo";
const call = (toolName, toolInput, extra = {}) =>
  evaluateToolCall({ toolName, toolInput, mainRoot, cwd: mainRoot, ...extra });
const bash = (command, extra) => call("Bash", { command }, extra);

// --- editing code in the main checkout -------------------------------------

test("editing app code in the main checkout is refused", () => {
  assert.ok(call("Edit", { file_path: "/repo/apps/api/src/index.ts" }));
  assert.ok(call("Write", { file_path: "/repo/packages/db/schema.ts" }));
});

test("editing app code inside a worktree is allowed", () => {
  assert.equal(call("Edit", { file_path: "/repo/.worktrees/feat-1-x/apps/api/src/index.ts" }), null);
});

test("editing docs, plans and agent configuration in the main checkout is allowed", () => {
  assert.equal(call("Edit", { file_path: "/repo/docs/testing.md" }), null);
  assert.equal(call("Write", { file_path: "/repo/.plan/03-web/prd.md" }), null);
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
  assert.equal(bash("node scripts/harness/worktree.mjs create feat/1-env-docs"), null);
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
  assert.ok(bash("gh pr merge 43 --squash", { lookupPrBase: () => { throw new Error("offline"); } }));
});

test("subagents never merge", () => {
  assert.ok(
    bash("gh pr merge 41 --squash", { isSubagent: true, lookupPrBase: lookup({ 41: "phase/02-api-db" }) }),
  );
});

test("a merge or push chained after another command is still checked", () => {
  assert.ok(bash("git fetch && git push origin master"));
  assert.ok(bash("cd x; gh pr merge 42 --merge", { lookupPrBase: lookup({ 42: "master" }) }));
});

test("text that only mentions a merge or a push is not treated as one", () => {
  assert.equal(bash("echo 'then run gh pr merge <number> --squash'"), null);
  assert.equal(bash("python3 - <<'EOF'\ndoc = '(`gh pr merge <number>`) and `git push origin master`'\nEOF"), null);
});

test("a real merge is recognised for the post-merge reminder, a mention is not", () => {
  assert.equal(invokesPrMerge("gh pr merge 41 --squash --delete-branch"), true);
  assert.equal(invokesPrMerge("gh pr checks 41 --watch && gh pr merge 41 --squash"), true);
  assert.equal(invokesPrMerge("python3 - <<'EOF'\nx = 'merge with `gh pr merge <number>`'\nEOF"), false);
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
  assert.ok(call("Grep", { pattern: "x", path: "/repo", glob: ".context/*.md" }, { isSubagent: true }));
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
    "/repo/scripts/harness/hooks/pre-tool-use.mjs",
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
  assert.equal(call("Edit", { file_path: "/repo/.worktrees/ci-1-x/.github/workflows/ci.yml" }, { unattended: true }), null);
  assert.equal(call("Edit", { file_path: "/repo/docs/agents.md" }, { unattended: true }), null);
  assert.equal(bash("node scripts/harness/worktree.mjs list", { unattended: true }), null);
  assert.equal(call("Edit", { file_path: "/repo/.claude/settings.json" }), null);
});

test("a symbolic link does not hide where an edit really lands", () => {
  const realpath = (p) => p.replace("/repo/.worktrees/x/link", "/repo/.claude");
  assert.ok(call("Edit", { file_path: "/repo/.worktrees/x/link/settings.json" }, { unattended: true, realpath }));
  assert.ok(call("Edit", { file_path: "/repo/.worktrees/x/apps/web/page.tsx" }, {
    realpath: (p) => p.replace("/repo/.worktrees/x/apps", "/repo/apps"),
  }));
});

test("both the written and the resolved path are checked", () => {
  assert.ok(call("Read", { file_path: "/repo/.env" }, { realpath: () => "/repo/README.md" }));
  assert.ok(call("Edit", { file_path: "/repo/.claude/settings.json" }, { unattended: true, realpath: () => "/tmp/x" }));
  assert.equal(call("Read", { file_path: "/repo/docs/a.md" }, { realpath: () => "/repo/docs/b.md" }), null);
});

test("a symbolic link that cannot be resolved is refused", () => {
  assert.ok(call("Write", { file_path: "/repo/.worktrees/x/dangling" }, { realpath: () => null }));
});

// --- everything else -------------------------------------------------------

test("ordinary commands pass", () => {
  assert.equal(bash("pnpm test"), null);
  assert.equal(bash("git status"), null);
  assert.equal(call("WebFetch", { url: "https://example.com" }), null);
});
