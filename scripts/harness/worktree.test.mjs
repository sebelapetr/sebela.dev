import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createWorktree, listWorktrees } from "./worktree.mjs";

function fixture(t) {
  const mainRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sebela-worktree-test-"));
  t.after(() => fs.rmSync(mainRoot, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-C", mainRoot, ...args], {
    stdio: "ignore",
  });
  git("init", "-b", "master");
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-m", "fixture");
  const create = () => createWorktree({ mainRoot, branch: "fix/fixture" });
  const worktree = create();
  return { mainRoot, create, worktree, envPath: path.join(worktree.path, ".env.local") };
}

test("creating an existing worktree preserves its edited environment and slot", (t) => {
  const { mainRoot, create, worktree, envPath } = fixture(t);
  const settings = "CUSTOM_SETTING=fixture\nWEB_PORT=6543\n";
  fs.writeFileSync(envPath, settings);

  assert.deepEqual(create(), worktree);
  assert.equal(fs.readFileSync(envPath, "utf8"), settings);
  assert.deepEqual(listWorktrees({ mainRoot }), [{ slot: worktree.slot, name: worktree.name }]);
});

test("creating a worktree generates missing environment settings", (t) => {
  const { create, worktree, envPath } = fixture(t);
  assert.match(fs.readFileSync(envPath, "utf8"), new RegExp(`^WORKTREE_SLOT=${worktree.slot}$`, "m"));
  fs.rmSync(envPath);

  create();

  const settings = fs.readFileSync(envPath, "utf8");
  assert.match(settings, new RegExp(`^WORKTREE_SLOT=${worktree.slot}$`, "m"));
  assert.match(settings, /^WEB_PORT=\d+$/m);
});

test("an existing empty environment file is preserved", (t) => {
  const { create, envPath } = fixture(t);
  fs.writeFileSync(envPath, "");

  create();

  assert.equal(fs.readFileSync(envPath, "utf8"), "");
});

test("creating an existing worktree does not follow an environment symlink", (t) => {
  const { mainRoot, create, envPath } = fixture(t);
  const target = path.join(mainRoot, "fixture-settings.txt");
  fs.writeFileSync(target, "FIXTURE=keep\n");
  fs.rmSync(envPath);
  fs.symlinkSync(target, envPath);

  create();

  assert.equal(fs.readFileSync(target, "utf8"), "FIXTURE=keep\n");
  assert.ok(fs.lstatSync(envPath).isSymbolicLink());
});
