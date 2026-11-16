import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";
import { databaseName } from "./lib/slots.mjs";
import { createWorktree, listWorktrees, removeWorktree } from "./worktree.mjs";

// The services of the port scheme in docs/repository-structure.md, and their documented ports.
const SERVICE_PORTS = ["WEB_PORT", "API_PORT", "MCP_ADMIN_PORT", "LLM_AGENT_PORT"];
const EXAMPLE_FILE = path.join(import.meta.dirname, "..", ".env.example");
const example = parseEnv(fs.readFileSync(EXAMPLE_FILE, "utf8"));

function mainCheckout(t) {
  const mainRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sebela-worktree-test-"));
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
  return mainRoot;
}

// Stands in for the shared Postgres at the harness's database interface: it records which
// worktree owns which database and can be told to fail. The real Postgres implementation is
// exercised end to end by worktree-databases.e2e.mjs.
function fakeDatabases() {
  const owners = new Map();
  const claim = (name, owner) => {
    const holder = owners.get(name);
    if (holder !== undefined && holder !== owner)
      throw new Error(`fixture: ${name} belongs to ${holder}`);
  };
  return {
    owners,
    failing: false,
    ensure(name, owner) {
      if (this.failing) throw new Error("fixture: database service unavailable");
      claim(name, owner);
      owners.set(name, owner);
    },
    drop(name, owner) {
      if (this.failing) throw new Error("fixture: database service unavailable");
      claim(name, owner);
      owners.delete(name);
    },
  };
}

function fixture(t, env = {}) {
  const mainRoot = mainCheckout(t);
  const databases = fakeDatabases();
  const create = (branch = "fix/fixture") => createWorktree({ mainRoot, branch, env, databases });
  const remove = (target = "fix/fixture", options = {}) =>
    removeWorktree({ mainRoot, target, databases, ...options });
  const worktree = create();
  return {
    mainRoot,
    databases,
    create,
    remove,
    worktree,
    envPath: path.join(worktree.path, ".env.local"),
  };
}

function branchExists(mainRoot, branch) {
  try {
    execFileSync("git", [
      "-C",
      mainRoot,
      "show-ref",
      "--verify",
      "--quiet",
      `refs/heads/${branch}`,
    ]);
    return true;
  } catch {
    return false;
  }
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
  assert.match(
    fs.readFileSync(envPath, "utf8"),
    new RegExp(`^WORKTREE_SLOT=${worktree.slot}$`, "m"),
  );
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
  const databases = fakeDatabases();

  assert.throws(
    () =>
      createWorktree({
        mainRoot,
        branch: "fix/fixture",
        env: { API_PORT: "not-a-port" },
        databases,
      }),
    /API_PORT must be/,
  );
  assert.equal(fs.existsSync(path.join(mainRoot, ".worktrees", "fix-fixture")), false);
  assert.deepEqual(listWorktrees({ mainRoot }), []);
  assert.equal(databases.owners.size, 0);
});

test("creating a worktree gives it its own database and writes the name with its ports", (t) => {
  const { databases, worktree, envPath } = fixture(t);
  const settings = parseEnv(fs.readFileSync(envPath, "utf8"));

  assert.equal(worktree.database, databaseName("fix/fixture"));
  assert.deepEqual([...databases.owners], [[worktree.database, worktree.name]]);
  assert.equal(settings.DATABASE_NAME, worktree.database);
  assert.equal(Number(settings.WORKTREE_SLOT), worktree.slot);
});

test("creating an existing worktree again reuses its database", (t) => {
  const { databases, create, worktree } = fixture(t);

  assert.deepEqual(create(), worktree);
  assert.deepEqual([...databases.owners], [[worktree.database, worktree.name]]);
});

test("worktrees get different databases", (t) => {
  const { databases, create, worktree } = fixture(t);
  const other = create("feat/other");

  assert.notEqual(other.database, worktree.database);
  assert.equal(databases.owners.get(other.database), other.name);
  assert.equal(databases.owners.get(worktree.database), worktree.name);
});

test("a new worktree whose database cannot be created is rolled back", (t) => {
  const { mainRoot, databases, create, worktree } = fixture(t);
  databases.failing = true;

  assert.throws(() => create("feat/no-database"), /database service unavailable/);

  assert.equal(fs.existsSync(path.join(mainRoot, ".worktrees", "feat-no-database")), false);
  assert.equal(branchExists(mainRoot, "feat/no-database"), false);
  assert.deepEqual(listWorktrees({ mainRoot }), [{ slot: worktree.slot, name: worktree.name }]);

  databases.failing = false;
  const retried = create("feat/no-database");
  assert.equal(databases.owners.get(retried.database), retried.name);
  assert.match(fs.readFileSync(path.join(retried.path, ".env.local"), "utf8"), /^DATABASE_NAME=/m);
});

test("an existing worktree keeps its slot and settings when its database cannot be ensured", (t) => {
  const { mainRoot, databases, create, worktree, envPath } = fixture(t);
  const settings = fs.readFileSync(envPath, "utf8");
  databases.failing = true;

  assert.throws(() => create(), /database service unavailable/);

  assert.ok(fs.existsSync(worktree.path));
  assert.equal(fs.readFileSync(envPath, "utf8"), settings);
  assert.deepEqual(listWorktrees({ mainRoot }), [{ slot: worktree.slot, name: worktree.name }]);
});

test("a missing environment file is not written while the database is unavailable", (t) => {
  const { databases, create, envPath } = fixture(t);
  fs.rmSync(envPath);
  databases.failing = true;

  assert.throws(() => create(), /database service unavailable/);

  assert.equal(fs.existsSync(envPath), false);
});

test("removing a worktree drops only its database and frees only its slot", (t) => {
  const { mainRoot, databases, create, remove, worktree } = fixture(t);
  const other = create("feat/other");

  remove();

  assert.equal(fs.existsSync(worktree.path), false);
  assert.deepEqual([...databases.owners], [[other.database, other.name]]);
  assert.deepEqual(listWorktrees({ mainRoot }), [{ slot: other.slot, name: other.name }]);
});

test("removing a worktree by its path drops its database", (t) => {
  const { mainRoot, databases, remove, worktree } = fixture(t);
  assert.equal(databases.owners.get(worktree.database), worktree.name);

  remove(worktree.path);

  assert.equal(databases.owners.size, 0);
  assert.deepEqual(listWorktrees({ mainRoot }), []);
});

test("a worktree with uncommitted work keeps its database and slot", (t) => {
  const { mainRoot, databases, remove, worktree } = fixture(t);
  fs.writeFileSync(path.join(worktree.path, "work.txt"), "unfinished\n");

  assert.throws(() => remove(), /uncommitted work/);

  assert.ok(fs.existsSync(worktree.path));
  assert.equal(databases.owners.get(worktree.database), worktree.name);
  assert.deepEqual(listWorktrees({ mainRoot }), [{ slot: worktree.slot, name: worktree.name }]);
});

test("a database that cannot be dropped stops the removal and leaves everything in place", (t) => {
  const { mainRoot, databases, remove, worktree, envPath } = fixture(t);
  databases.failing = true;

  assert.throws(() => remove(), /database service unavailable/);

  assert.ok(fs.existsSync(envPath));
  assert.equal(databases.owners.get(worktree.database), worktree.name);
  assert.deepEqual(listWorktrees({ mainRoot }), [{ slot: worktree.slot, name: worktree.name }]);

  databases.failing = false;
  remove();
  assert.equal(fs.existsSync(worktree.path), false);
  assert.equal(databases.owners.size, 0);
  assert.deepEqual(listWorktrees({ mainRoot }), []);
});

test("removing a worktree again is harmless", (t) => {
  const { mainRoot, databases, remove } = fixture(t);

  remove();
  remove();

  assert.equal(databases.owners.size, 0);
  assert.deepEqual(listWorktrees({ mainRoot }), []);
});

test("creating a worktree for an issue with an earlier branch continues that branch", (t) => {
  const { mainRoot, create, worktree } = fixture(t);
  const earlier = create("feat/17-hardcoded-config-check");
  execFileSync("git", [
    "-C",
    earlier.path,
    "-c",
    "user.name=F",
    "-c",
    "user.email=f@example.invalid",
    "commit",
    "--allow-empty",
    "-m",
    "earlier work",
  ]);

  const again = create("feat/17-reject-hardcoded-endpoints");

  assert.equal(again.path, earlier.path);
  assert.equal(again.resumed, "feat/17-hardcoded-config-check");
  assert.equal(branchExists(mainRoot, "feat/17-reject-hardcoded-endpoints"), false);
  assert.equal(listWorktrees({ mainRoot }).length, 2, `${worktree.name} and the earlier one only`);
});
