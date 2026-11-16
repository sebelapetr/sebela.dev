// The installer behind the root `prepare` script, run as `pnpm install` runs it: in the checkout's
// root, with the process environment.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRepo, git, GIT_ENV } from "../lib/hook-fixtures.mjs";

const INSTALLER = path.join(import.meta.dirname, "install.mjs");
const HOOKS_PATH = "scripts/harness/git-hooks";

const cleanups = [];
after(() => cleanups.forEach((cleanup) => cleanup()));

function setup() {
  const fixture = createRepo("sebela-install-");
  cleanups.push(fixture.cleanup);
  return fixture;
}

function install(cwd, env = {}) {
  const { SEBELA_UNATTENDED: _ignored, ...base } = GIT_ENV;
  return spawnSync(process.execPath, [INSTALLER], {
    cwd,
    env: { ...base, ...env },
    encoding: "utf8",
  });
}

function hooksPath(cwd) {
  const run = spawnSync("git", ["config", "--get", "core.hooksPath"], {
    cwd,
    env: GIT_ENV,
    encoding: "utf8",
  });
  return run.stdout.trim();
}

test("installation points Git at the repository's hooks", () => {
  const { repo } = setup();
  const run = install(repo);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(hooksPath(repo), HOOKS_PATH);
  assert.match(run.stdout, /enabled/);
});

test("installing again changes nothing", () => {
  const { repo } = setup();
  assert.equal(install(repo).status, 0);
  const run = install(repo);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(hooksPath(repo), HOOKS_PATH);
});

test("each worktree runs the hooks of its own checkout", () => {
  const { dir, repo } = setup();
  const worktree = path.join(dir, "worktree");
  git(repo, "worktree", "add", "-b", "feat/1-fixture", worktree);
  assert.equal(install(worktree).status, 0);

  const marker = path.join(dir, "ran-in");
  const hook = path.join(worktree, HOOKS_PATH, "pre-commit");
  fs.mkdirSync(path.dirname(hook), { recursive: true });
  fs.writeFileSync(hook, `#!/bin/sh\npwd > "${marker}"\n`);
  fs.chmodSync(hook, 0o755);

  const run = spawnSync("git", ["commit", "--allow-empty", "-m", "chore: fixture"], {
    cwd: worktree,
    env: GIT_ENV,
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(fs.readFileSync(marker, "utf8").trim(), fs.realpathSync(worktree));
  // The main checkout has no hooks folder, so its commits run none rather than the worktree's.
  assert.equal(
    spawnSync("git", ["commit", "--allow-empty", "-m", "chore: main"], { cwd: repo, env: GIT_ENV })
      .status,
    0,
  );
  assert.equal(fs.readFileSync(marker, "utf8").trim(), fs.realpathSync(worktree));
});

test("a hooks path someone else configured is kept and reported", () => {
  const { repo } = setup();
  git(repo, "config", "core.hooksPath", ".husky");
  const run = install(repo);
  assert.equal(run.status, 0);
  assert.equal(hooksPath(repo), ".husky");
  assert.match(run.stderr, /\.husky/);
  assert.match(run.stderr, /not enabled/);
});

test("the phase loop does not change repository settings", () => {
  const { repo } = setup();
  const run = install(repo, { SEBELA_UNATTENDED: "1" });
  assert.equal(run.status, 0);
  assert.equal(hooksPath(repo), "");
  assert.match(run.stderr, /not enabled/);
});

test("outside a Git checkout there is nothing to install", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sebela-no-git-"));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  const run = install(dir, { GIT_CEILING_DIRECTORIES: path.dirname(dir) });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout + run.stderr, /not a Git checkout/);
});
