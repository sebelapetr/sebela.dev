import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "sebela-env-guard-"));
const repo = path.join(fixture, "repo");
const worktree = path.join(repo, ".worktrees", "fixture");
fs.mkdirSync(repo);
const git = (...args) =>
  execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-C", repo, ...args], {
    stdio: "ignore",
  });
git("init", "-b", "master");
git(
  "-c",
  "user.name=Fixture",
  "-c",
  "user.email=fixture@example.invalid",
  "commit",
  "--allow-empty",
  "-m",
  "fixture",
);
git("worktree", "add", "-b", "fixture", worktree);
after(() => fs.rmSync(fixture, { recursive: true, force: true }));

function verdict(toolName, filePath, cwd = worktree) {
  const run = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("./pre-tool-use.mjs", import.meta.url))],
    {
      cwd,
      env: { ...process.env, CLAUDE_PROJECT_DIR: repo, SEBELA_UNATTENDED: "1" },
      input: JSON.stringify({
        cwd,
        agent_id: "fixture",
        tool_name: toolName,
        tool_input: { file_path: filePath },
      }),
      encoding: "utf8",
    },
  );
  assert.ifError(run.error);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stderr, "");
  return run.stdout ? JSON.parse(run.stdout).hookSpecificOutput.permissionDecision : "allow";
}

test("the hook recognises a Git worktree and allows its local environment file", () => {
  for (const tool of ["Read", "Write", "Edit"]) assert.equal(verdict(tool, ".env.local"), "allow");
  assert.equal(verdict("Read", path.join(repo, ".env.local")), "deny");
  assert.equal(verdict("Read", ".env.local", repo), "deny");
  assert.equal(verdict("Read", ".env.production"), "deny");
});

test("the hook refuses a local environment file linked outside the worktree", () => {
  const folder = path.join(worktree, "linked");
  fs.mkdirSync(folder);
  fs.writeFileSync(path.join(repo, ".env.local"), "FIXTURE=true\n");
  fs.symlinkSync(path.join(repo, ".env.local"), path.join(folder, ".env.local"));
  assert.equal(verdict("Read", "linked/.env.local"), "deny");
});

test("permission settings leave scoped local environment access to the guard", () => {
  const settings = JSON.parse(
    fs.readFileSync(new URL("../../.claude/settings.json", import.meta.url), "utf8"),
  );
  assert.ok(!settings.permissions.deny.includes("Read(./.env.local)"));
  assert.ok(!settings.permissions.deny.includes("Read(**/.env.local)"));
  assert.ok(settings.permissions.deny.includes("Read(**/.env.production)"));
});

// --- the state of a phase pull request (issue #371) --------------------------

// A stand-in for gh on the PATH: `gh pr view <selector> --json headRefName -q .headRefName`
// answers the head branch the fixture gives that pull request, and fails for any other.
const bin = path.join(fixture, "bin");
fs.mkdirSync(bin);
fs.writeFileSync(
  path.join(bin, "gh"),
  '#!/bin/sh\ncase "$3" in\n  50) echo phase/07-ai-service ;;\n  51) echo feat/12-thing ;;\n  *) exit 1 ;;\nesac\n',
  { mode: 0o755 },
);

function shellVerdict(command, { unattended = false, subagent = false } = {}) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: repo, PATH: `${bin}:${process.env.PATH}` };
  delete env.SEBELA_UNATTENDED;
  if (unattended) env.SEBELA_UNATTENDED = "1";
  const run = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("./pre-tool-use.mjs", import.meta.url))],
    {
      cwd: worktree,
      env,
      input: JSON.stringify({
        cwd: worktree,
        ...(subagent ? { agent_id: "fixture" } : {}),
        tool_name: "Bash",
        tool_input: { command },
      }),
      encoding: "utf8",
    },
  );
  assert.equal(run.status, 0, run.stderr);
  return run.stdout ? JSON.parse(run.stdout).hookSpecificOutput : { permissionDecision: "allow" };
}

test("the hook refuses a loop step that changes the state of a phase pull request", () => {
  for (const command of ["gh pr ready 50", "gh pr close 50", "gh pr reopen 50"]) {
    for (const session of [{ unattended: true }, { subagent: true }]) {
      const output = shellVerdict(command, session);
      assert.equal(output.permissionDecision, "deny", command);
      assert.match(output.permissionDecisionReason, /phase pull request/);
    }
  }
  assert.equal(shellVerdict("gh pr ready 51", { unattended: true }).permissionDecision, "allow");
  // A pull request gh cannot find is not assumed to be harmless.
  assert.equal(shellVerdict("gh pr ready 52", { unattended: true }).permissionDecision, "deny");
});

test("the hook asks the owner in an interactive session instead of refusing", () => {
  const output = shellVerdict("gh pr ready 50");
  assert.equal(output.permissionDecision, "ask");
  assert.match(output.permissionDecisionReason, /phase pull request/);
  assert.equal(shellVerdict("gh pr close 51").permissionDecision, "allow");
});
