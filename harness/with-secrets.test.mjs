import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mainCheckoutOf, secretsEnvironment } from "./with-secrets.mjs";

const SCRIPT = path.join(import.meta.dirname, "with-secrets.mjs");

// A main checkout with one commit and a linked worktree in `.worktrees/`, as the harness makes it.
function checkoutWithWorktree(t) {
  const mainRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "sebela-secrets-test-")));
  t.after(() => fs.rmSync(mainRoot, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-C", mainRoot, ...args], {
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
  const worktree = path.join(mainRoot, ".worktrees", "feat-1-x");
  git("worktree", "add", "-b", "feat/1-x", worktree);
  fs.mkdirSync(path.join(worktree, "apps", "mcp-admin"), { recursive: true });
  return { mainRoot, worktree };
}

test("the main checkout is found from itself, from a worktree and from a folder inside one", (t) => {
  const { mainRoot, worktree } = checkoutWithWorktree(t);

  assert.equal(mainCheckoutOf(mainRoot), mainRoot);
  assert.equal(mainCheckoutOf(worktree), mainRoot);
  assert.equal(mainCheckoutOf(path.join(worktree, "apps", "mcp-admin")), mainRoot);
});

test("the secrets come from the main checkout's .env.secrets, never from the worktree's", (t) => {
  const { mainRoot, worktree } = checkoutWithWorktree(t);
  fs.writeFileSync(path.join(mainRoot, ".env.secrets"), "ANTHROPIC_API_KEY=sk-ant-owner\n");
  fs.writeFileSync(path.join(worktree, ".env.secrets"), "ANTHROPIC_API_KEY=sk-ant-planted\n");

  const env = secretsEnvironment({ cwd: worktree, env: {} });

  assert.equal(env.ANTHROPIC_API_KEY, "sk-ant-owner");
});

test("a variable already set in the environment wins, as CI sets the key from its secret", (t) => {
  const { mainRoot, worktree } = checkoutWithWorktree(t);
  fs.writeFileSync(path.join(mainRoot, ".env.secrets"), "ANTHROPIC_API_KEY=sk-ant-owner\n");

  const env = secretsEnvironment({ cwd: worktree, env: { ANTHROPIC_API_KEY: "from-ci" } });

  assert.equal(env.ANTHROPIC_API_KEY, "from-ci");
});

test("without a .env.secrets the environment is passed on unchanged", (t) => {
  const { worktree } = checkoutWithWorktree(t);

  assert.deepEqual(secretsEnvironment({ cwd: worktree, env: { PATH: "/bin" } }), { PATH: "/bin" });
});

test("the command runs with the secrets, keeps its exit code and the key is never printed", (t) => {
  const { mainRoot, worktree } = checkoutWithWorktree(t);
  fs.writeFileSync(path.join(mainRoot, ".env.secrets"), "ANTHROPIC_API_KEY=sk-ant-owner\n");
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;

  const result = spawnSync(
    process.execPath,
    [
      SCRIPT,
      "--",
      process.execPath,
      "-e",
      "process.exit(process.env.ANTHROPIC_API_KEY === 'sk-ant-owner' ? 7 : 1)",
    ],
    { cwd: worktree, env, encoding: "utf8" },
  );

  assert.equal(result.status, 7, result.stderr);
  assert.equal(`${result.stdout}${result.stderr}`.includes("sk-ant-owner"), false);
});

test("a call without a command is refused with its usage", () => {
  const result = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage: node harness\/with-secrets\.mjs -- <command>/);
});
