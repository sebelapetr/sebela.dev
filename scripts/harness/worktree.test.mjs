import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";
import { createWorktree, listWorktrees } from "./worktree.mjs";

// The services of the port scheme in docs/repository-structure.md, and their documented ports.
const SERVICE_PORTS = ["WEB_PORT", "API_PORT", "MCP_ADMIN_PORT", "LLM_AGENT_PORT"];
const EXAMPLE_FILE = path.join(import.meta.dirname, "..", "..", ".env.example");
const example = parseEnv(fs.readFileSync(EXAMPLE_FILE, "utf8"));

function mainCheckout(t) {
  const mainRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sebela-worktree-test-"));
  t.after(() => fs.rmSync(mainRoot, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-C", mainRoot, ...args], {
    stdio: "ignore",
  });
  git("init", "-b", "master");
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-m", "fixture");
  return mainRoot;
}

function fixture(t, env = {}) {
  const mainRoot = mainCheckout(t);
  const create = () => createWorktree({ mainRoot, branch: "fix/fixture", env });
  const worktree = create();
  return { mainRoot, create, worktree, envPath: path.join(worktree.path, ".env.local") };
}

test("creating an existing worktree preserves its edited environment and slot", (t) => {
  const { mainRoot, create, worktree, envPath } = fixture(t);
  const settings = `CUSTOM_SETTING=fixture\nWEB_PORT=${Number(example.WEB_PORT) + 777}\n`;
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

test("a generated environment file shifts the documented ports by the worktree's slot", (t) => {
  const { worktree, envPath } = fixture(t);
  const settings = parseEnv(fs.readFileSync(envPath, "utf8"));

  for (const name of SERVICE_PORTS) {
    assert.equal(Number(settings[name]), Number(example[name]) + worktree.slot * 10, name);
  }
});

test("base ports set in the process environment take precedence over the example", (t) => {
  const moved = Number(example.WEB_PORT) + 500;
  const { worktree, envPath } = fixture(t, { WEB_PORT: String(moved) });
  const settings = parseEnv(fs.readFileSync(envPath, "utf8"));

  assert.equal(Number(settings.WEB_PORT), moved + worktree.slot * 10);
  assert.equal(Number(settings.API_PORT), Number(example.API_PORT) + worktree.slot * 10);
});

test("an invalid port configuration stops before a worktree is created", (t) => {
  const mainRoot = mainCheckout(t);

  assert.throws(
    () => createWorktree({ mainRoot, branch: "fix/fixture", env: { API_PORT: "not-a-port" } }),
    /API_PORT must be/,
  );
  assert.equal(fs.existsSync(path.join(mainRoot, ".worktrees", "fix-fixture")), false);
  assert.deepEqual(listWorktrees({ mainRoot }), []);
});
