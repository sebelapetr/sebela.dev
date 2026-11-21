import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";
import { databaseName, storageWorktreeName } from "./lib/slots.mjs";
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
// worktree owns which database and role, the role's current password, and can be told to fail.
// The real Postgres implementation is exercised end to end by worktree-databases.e2e.mjs.
function fakeDatabases() {
  const owners = new Map();
  const passwords = new Map();
  const claim = (name, owner) => {
    const holder = owners.get(name);
    if (holder !== undefined && holder !== owner)
      throw new Error(`fixture: ${name} belongs to ${holder}`);
  };
  return {
    owners,
    passwords,
    failing: false,
    ensure(name, owner, { password } = {}) {
      if (this.failing) throw new Error("fixture: database service unavailable");
      claim(name, owner);
      owners.set(name, owner);
      if (password !== undefined) passwords.set(name, password);
      else if (!passwords.has(name)) passwords.set(name, "fixture-unknown-password");
      return { user: name };
    },
    drop(name, owner) {
      if (this.failing) throw new Error("fixture: database service unavailable");
      claim(name, owner);
      owners.delete(name);
      passwords.delete(name);
    },
  };
}

// Stands in for the backend maintenance commands (harness/lib/backend.mjs): it records which
// worktree was set up or torn down, what existed at that moment, and fails on request. The real
// commands are exercised end to end by worktree-backend.e2e.mjs.
function fakeBackend(databases) {
  return {
    calls: [],
    failing: null,
    setup({ root, owner }) {
      this.calls.push({
        step: "setup",
        root,
        owner,
        envFile: fs.existsSync(path.join(root, ".env.local")),
        database: databases.owners.has(databaseName(owner)),
      });
      if (this.failing) throw new Error(`fixture: setup failed at the ${this.failing} stage`);
    },
    teardown({ root, owner, force }) {
      this.calls.push({
        step: "teardown",
        root,
        owner,
        force,
        database: databases.owners.has(databaseName(owner)),
      });
      if (this.failing) throw new Error("fixture: storage remove failed");
    },
    teardownMissing({ owner }) {
      this.calls.push({ step: "teardown-missing", owner });
    },
  };
}

function fixture(t, env = {}) {
  const mainRoot = mainCheckout(t);
  const databases = fakeDatabases();
  const backend = fakeBackend(databases);
  const notices = [];
  const create = (branch = "fix/fixture", options = {}) =>
    createWorktree({
      mainRoot,
      branch,
      env,
      databases,
      backend,
      notice: (message) => notices.push(message),
      ...options,
    });
  const remove = (target = "fix/fixture", options = {}) =>
    removeWorktree({ mainRoot, target, databases, backend, ...options });
  const worktree = create();
  return {
    mainRoot,
    databases,
    backend,
    create,
    remove,
    notices,
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
  const backend = fakeBackend(databases);

  assert.throws(
    () =>
      createWorktree({
        mainRoot,
        branch: "fix/fixture",
        env: { API_PORT: "not-a-port" },
        databases,
        backend,
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

test("creating a worktree gives it its own role and writes its credentials", (t) => {
  const { databases, worktree, envPath } = fixture(t);
  const settings = parseEnv(fs.readFileSync(envPath, "utf8"));

  assert.equal(settings.DATABASE_USER, databaseName("fix/fixture"));
  assert.equal(settings.DATABASE_PASSWORD, databases.passwords.get(worktree.database));
  assert.match(settings.DATABASE_PASSWORD, /^[A-Za-z0-9_-]{43,}$/);
});

test("the password is not part of the result and the file is readable only by its owner", (t) => {
  const { worktree, envPath } = fixture(t);
  const { DATABASE_PASSWORD } = parseEnv(fs.readFileSync(envPath, "utf8"));

  assert.equal(JSON.stringify(worktree).includes(DATABASE_PASSWORD), false);
  assert.equal(fs.statSync(envPath).mode & 0o077, 0);
});

test("nothing from the owner's .env or .env.secrets reaches a new worktree", (t) => {
  const mainRoot = mainCheckout(t);
  fs.writeFileSync(path.join(mainRoot, ".env"), "POSTGRES_PASSWORD=superuser-secret\n");
  fs.writeFileSync(path.join(mainRoot, ".env.secrets"), "ANTHROPIC_API_KEY=sk-ant-owner\n");
  const databases = fakeDatabases();
  const worktree = createWorktree({
    mainRoot,
    branch: "feat/evals",
    env: {},
    databases,
    backend: fakeBackend(databases),
  });

  const written = fs.readFileSync(path.join(worktree.path, ".env.local"), "utf8");
  assert.equal(written.includes("superuser-secret"), false);
  assert.equal(written.includes("sk-ant-owner"), false);
  assert.equal(fs.existsSync(path.join(worktree.path, ".env.secrets")), false);
});

test("worktrees get different passwords", (t) => {
  const { databases, create, worktree } = fixture(t);
  const other = create("feat/other");

  assert.notEqual(
    databases.passwords.get(other.database),
    databases.passwords.get(worktree.database),
  );
});

test("creating a worktree again with its environment file keeps its password", (t) => {
  const { databases, create, worktree, envPath } = fixture(t);
  const settings = fs.readFileSync(envPath, "utf8");
  const password = databases.passwords.get(worktree.database);

  create();

  assert.equal(fs.readFileSync(envPath, "utf8"), settings);
  assert.equal(databases.passwords.get(worktree.database), password);
});

test("regenerating a missing environment file gives the role a new password", (t) => {
  const { databases, create, worktree, envPath } = fixture(t);
  const previous = databases.passwords.get(worktree.database);
  fs.rmSync(envPath);

  create();

  const settings = parseEnv(fs.readFileSync(envPath, "utf8"));
  assert.notEqual(settings.DATABASE_PASSWORD, previous);
  assert.equal(settings.DATABASE_PASSWORD, databases.passwords.get(worktree.database));
  assert.equal(settings.DATABASE_USER, worktree.database);
});

test("an environment file that appears during setup is kept and reported", (t) => {
  const { databases, create, envPath } = fixture(t);
  fs.rmSync(envPath);
  const ensure = databases.ensure.bind(databases);
  databases.ensure = (...args) => {
    fs.writeFileSync(envPath, "FIXTURE=written-meanwhile\n");
    return ensure(...args);
  };

  assert.throws(() => create(), /appeared.*new password.*delete it/s);

  assert.equal(fs.readFileSync(envPath, "utf8"), "FIXTURE=written-meanwhile\n");
});

test("an environment symlink counts as an existing file and keeps the password", (t) => {
  const { mainRoot, databases, create, worktree, envPath } = fixture(t);
  const password = databases.passwords.get(worktree.database);
  const target = path.join(mainRoot, "fixture-settings.txt");
  fs.writeFileSync(target, "FIXTURE=keep\n");
  fs.rmSync(envPath);
  fs.symlinkSync(target, envPath);

  create();

  assert.equal(databases.passwords.get(worktree.database), password);
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
  assert.deepEqual([...databases.passwords.keys()], [other.database]);
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

// --- continuing an interrupted issue's branch ----------------------------------------

const PHASE = "phase/02-api-db";

function gitIn(root, ...args) {
  return execFileSync(
    "git",
    [
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-C",
      root,
      ...args,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  ).trim();
}

function commitFile(root, file, message = `add ${file}`) {
  fs.writeFileSync(path.join(root, file), `${file}\n`);
  gitIn(root, "add", file);
  gitIn(root, "commit", "-m", message);
}

test("creating a worktree for an issue with an earlier branch continues that branch", (t) => {
  const { mainRoot, create, notices, worktree } = fixture(t);
  gitIn(mainRoot, "branch", PHASE);
  const earlier = create("feat/17-hardcoded-config-check", { base: PHASE });
  commitFile(earlier.path, "earlier-work");
  assert.deepEqual(notices, []);

  const again = create("feat/17-reject-hardcoded-endpoints", { base: PHASE });

  assert.equal(again.path, earlier.path);
  assert.equal(again.resumed, "feat/17-hardcoded-config-check");
  assert.equal(branchExists(mainRoot, "feat/17-reject-hardcoded-endpoints"), false);
  assert.equal(listWorktrees({ mainRoot }).length, 2, `${worktree.name} and the earlier one only`);
});

test("continuing another branch is announced with the requested and the continued branch", (t) => {
  const { mainRoot, create, notices, backend } = fixture(t);
  gitIn(mainRoot, "branch", PHASE);
  const earlier = create("feat/17-hardcoded-config-check", { base: PHASE });
  commitFile(earlier.path, "earlier-work");

  // Announced before the backend stages, so a failing stage cannot hide it.
  backend.failing = "migration";
  assert.throws(() => create("fix/17-reject-hardcoded-endpoints", { base: PHASE }), /migration/);

  assert.equal(notices.length, 1);
  assert.match(notices[0], /fix\/17-reject-hardcoded-endpoints/);
  assert.match(notices[0], /feat\/17-hardcoded-config-check/);
  assert.match(notices[0], /not created/);
});

test("a branch whose number is a phase number is created as requested (issue 323)", (t) => {
  const { mainRoot, create, notices } = fixture(t);
  const prd = create("docs/15-pages-prd", { base: "master" });
  commitFile(prd.path, "prd");

  const decisions = create("docs/15-pages-decisions", { base: "master" });

  assert.equal(decisions.name, "docs-15-pages-decisions");
  assert.notEqual(decisions.path, prd.path);
  assert.equal(decisions.resumed, undefined);
  assert.equal(gitIn(decisions.path, "branch", "--show-current"), "docs/15-pages-decisions");
  assert.equal(
    gitIn(mainRoot, "rev-parse", "docs/15-pages-decisions"),
    gitIn(mainRoot, "rev-parse", "master"),
    "cut from the base",
  );
  assert.deepEqual(notices, []);
});

test("a branch cut from the checked-out branch continues an issue only on a phase branch", (t) => {
  const { mainRoot, create } = fixture(t);
  const earlier = create("feat/17-hardcoded-config-check");
  commitFile(earlier.path, "earlier-work");

  // The main checkout is on master: not an issue branch by the documented convention.
  const fromMaster = create("feat/17-from-master");
  assert.equal(fromMaster.resumed, undefined);
  assert.equal(branchExists(mainRoot, "feat/17-from-master"), true);

  gitIn(mainRoot, "checkout", "-b", PHASE);
  const fromPhase = create("feat/17-from-phase");
  assert.equal(fromPhase.resumed, "feat/17-hardcoded-config-check");
  assert.equal(branchExists(mainRoot, "feat/17-from-phase"), false);
});

test("a phase branch and an issue branch of the same number never continue each other", (t) => {
  const { mainRoot, create, notices } = fixture(t);
  gitIn(mainRoot, "branch", PHASE);
  const issue = create("feat/15-profile-api", { base: PHASE });
  commitFile(issue.path, "issue-work");

  const phase = create("phase/15-pages", { base: "master" });
  assert.equal(phase.resumed, undefined);
  assert.equal(gitIn(phase.path, "branch", "--show-current"), "phase/15-pages");

  const other = create("fix/15-profile-fields", { base: "phase/15-pages" });
  assert.equal(other.resumed, "feat/15-profile-api", "the issue's branch, not the phase branch");

  const docs = create("docs/15-pages-decisions", { base: "phase/15-pages" });
  assert.equal(docs.resumed, undefined);
  assert.equal(gitIn(docs.path, "branch", "--show-current"), "docs/15-pages-decisions");
  assert.equal(notices.length, 1);
});

test("a branch merged into the base is not continued", (t) => {
  const { mainRoot, create, remove } = fixture(t);
  gitIn(mainRoot, "checkout", "-b", PHASE);
  const earlier = create("feat/17-hardcoded-config-check", { base: PHASE });
  commitFile(earlier.path, "earlier-work");
  remove("feat/17-hardcoded-config-check");
  gitIn(mainRoot, "merge", "--no-ff", "-m", "merge", "feat/17-hardcoded-config-check");

  const again = create("fix/17-follow-up", { base: PHASE });

  assert.equal(again.resumed, undefined);
  assert.equal(gitIn(again.path, "branch", "--show-current"), "fix/17-follow-up");
  assert.equal(
    gitIn(mainRoot, "rev-parse", "fix/17-follow-up"),
    gitIn(mainRoot, "rev-parse", PHASE),
  );
});

test("a branch squash-merged into the base is not continued", (t) => {
  const { mainRoot, create, remove } = fixture(t);
  gitIn(mainRoot, "checkout", "-b", PHASE);
  const earlier = create("feat/17-hardcoded-config-check", { base: PHASE });
  commitFile(earlier.path, "earlier-work");
  commitFile(earlier.path, "more-work");
  remove("feat/17-hardcoded-config-check");
  // The phase branch moves on, then takes the issue as one squashed commit, then moves on again.
  commitFile(mainRoot, "other-issue");
  gitIn(mainRoot, "merge", "--squash", "feat/17-hardcoded-config-check");
  gitIn(mainRoot, "commit", "-m", "feat: squashed issue");
  commitFile(mainRoot, "later-issue");

  const again = create("fix/17-follow-up", { base: PHASE });

  assert.equal(again.resumed, undefined);
  assert.equal(gitIn(again.path, "branch", "--show-current"), "fix/17-follow-up");
});

test("an interrupted branch without a commit is continued while its worktree exists", (t) => {
  const { mainRoot, create, remove } = fixture(t);
  gitIn(mainRoot, "branch", PHASE);
  const earlier = create("feat/17-hardcoded-config-check", { base: PHASE });
  fs.writeFileSync(path.join(earlier.path, "uncommitted-work"), "work\n");

  const again = create("feat/17-reject-hardcoded-endpoints", { base: PHASE });
  assert.equal(again.path, earlier.path);
  assert.equal(again.resumed, "feat/17-hardcoded-config-check");

  // Without a worktree and without a commit of its own there is nothing to continue.
  remove("feat/17-hardcoded-config-check", { force: true });
  const fresh = create("feat/17-reject-hardcoded-endpoints", { base: PHASE });
  assert.equal(fresh.resumed, undefined);
  assert.equal(branchExists(mainRoot, "feat/17-reject-hardcoded-endpoints"), true);
});

// --- backend maintenance: migrations, seed and storage -----------------------------

test("a generated environment file gives the worktree its own storage folder and address", (t) => {
  const { create, worktree, envPath } = fixture(t);
  const other = create("feat/other");
  const settings = parseEnv(fs.readFileSync(envPath, "utf8"));
  const otherSettings = parseEnv(fs.readFileSync(path.join(other.path, ".env.local"), "utf8"));

  assert.equal(settings.STORAGE_WORKTREE, storageWorktreeName(worktree.name));
  assert.notEqual(otherSettings.STORAGE_WORKTREE, settings.STORAGE_WORKTREE);
  const address = new URL(settings.STORAGE_PUBLIC_BASE_URL);
  assert.equal(address.hostname, example.API_HOST);
  assert.equal(Number(address.port), Number(settings.API_PORT));
  assert.equal(address.pathname, "/v1/media/files");
});

test("a generated environment file points the website at the worktree's own API", (t) => {
  const { create, envPath } = fixture(t);
  const other = create("feat/other");
  const settings = parseEnv(fs.readFileSync(envPath, "utf8"));
  const otherSettings = parseEnv(fs.readFileSync(path.join(other.path, ".env.local"), "utf8"));

  const address = new URL(settings.WEB_API_BASE_URL);
  assert.equal(address.hostname, example.API_HOST);
  assert.equal(Number(address.port), Number(settings.API_PORT));
  assert.equal(address.pathname, "/");
  assert.equal(
    Number(new URL(otherSettings.WEB_API_BASE_URL).port),
    Number(otherSettings.API_PORT),
  );
  assert.notEqual(otherSettings.WEB_API_BASE_URL, settings.WEB_API_BASE_URL);
});

test("a generated environment file points MCP Admin at the worktree's own API", (t) => {
  const { create, envPath } = fixture(t);
  const other = create("feat/other");
  const settings = parseEnv(fs.readFileSync(envPath, "utf8"));
  const otherSettings = parseEnv(fs.readFileSync(path.join(other.path, ".env.local"), "utf8"));

  assert.equal(settings.MCP_ADMIN_API_URL, settings.WEB_API_BASE_URL);
  const address = new URL(settings.MCP_ADMIN_API_URL);
  assert.equal(address.hostname, example.API_HOST);
  assert.equal(Number(address.port), Number(settings.API_PORT));
  assert.notEqual(otherSettings.MCP_ADMIN_API_URL, settings.MCP_ADMIN_API_URL);
});

test("a generated environment file gives the website its own canonical origin", (t) => {
  const { create, envPath } = fixture(t);
  const other = create("feat/other");
  const settings = parseEnv(fs.readFileSync(envPath, "utf8"));
  const otherSettings = parseEnv(fs.readFileSync(path.join(other.path, ".env.local"), "utf8"));

  const address = new URL(settings.WEB_SITE_ORIGIN);
  assert.equal(address.hostname, example.WEB_HOST);
  assert.equal(Number(address.port), Number(settings.WEB_PORT));
  assert.equal(settings.WEB_SITE_ORIGIN, address.origin);
  assert.equal(Number(new URL(otherSettings.WEB_SITE_ORIGIN).port), Number(otherSettings.WEB_PORT));
  assert.notEqual(otherSettings.WEB_SITE_ORIGIN, settings.WEB_SITE_ORIGIN);
});

test("a generated environment file signs the API's invalidations for the worktree's own website", (t) => {
  const { create, envPath } = fixture(t);
  const other = create("feat/other");
  const settings = parseEnv(fs.readFileSync(envPath, "utf8"));
  const otherSettings = parseEnv(fs.readFileSync(path.join(other.path, ".env.local"), "utf8"));

  const address = new URL(settings.API_WEB_INVALIDATION_URL);
  assert.equal(address.hostname, example.WEB_HOST);
  assert.equal(Number(address.port), Number(settings.WEB_PORT));
  assert.equal(address.pathname, "/internal/invalidation");
  assert.equal(address.search, "");
  assert.ok(settings.WEB_INVALIDATION_SECRET.length >= 32, "a secret of at least 32 characters");
  assert.equal(settings.API_WEB_INVALIDATION_SECRET, settings.WEB_INVALIDATION_SECRET);
  assert.notEqual(otherSettings.WEB_INVALIDATION_SECRET, settings.WEB_INVALIDATION_SECRET);
  assert.notEqual(otherSettings.API_WEB_INVALIDATION_URL, settings.API_WEB_INVALIDATION_URL);
});

test("a generated environment file lets the website optimise only its worktree's media", (t) => {
  const { create, envPath } = fixture(t);
  const other = create("feat/other");
  const settings = parseEnv(fs.readFileSync(envPath, "utf8"));
  const otherSettings = parseEnv(fs.readFileSync(path.join(other.path, ".env.local"), "utf8"));

  const address = new URL(settings.WEB_MEDIA_BASE_URL);
  assert.equal(
    address.href,
    `${settings.STORAGE_PUBLIC_BASE_URL}/${example.STORAGE_ENVIRONMENT}/${settings.STORAGE_WORKTREE}`,
  );
  assert.equal(address.hostname, example.API_HOST);
  assert.equal(Number(address.port), Number(settings.API_PORT));
  assert.notEqual(otherSettings.WEB_MEDIA_BASE_URL, settings.WEB_MEDIA_BASE_URL);
});

test("setup runs the backend stages in the worktree once its database and settings exist", (t) => {
  const { backend, worktree } = fixture(t);

  assert.deepEqual(backend.calls, [
    { step: "setup", root: worktree.path, owner: worktree.name, envFile: true, database: true },
  ]);
});

test("setup runs the backend stages again for an existing worktree", (t) => {
  const { backend, create, worktree, envPath } = fixture(t);
  const settings = fs.readFileSync(envPath, "utf8");

  create();

  assert.equal(backend.calls.length, 2);
  assert.equal(backend.calls[1].root, worktree.path);
  assert.equal(fs.readFileSync(envPath, "utf8"), settings);
});

test("a failing backend stage is reported and keeps the worktree, its database and its slot", (t) => {
  const { mainRoot, databases, backend, create, worktree } = fixture(t);
  backend.failing = "seed";

  assert.throws(() => create("feat/failing-seed"), /seed stage/);

  const failed = path.join(mainRoot, ".worktrees", "feat-failing-seed");
  assert.ok(fs.existsSync(path.join(failed, ".env.local")));
  assert.equal(databases.owners.get(databaseName("feat-failing-seed")), "feat-failing-seed");
  const slots = listWorktrees({ mainRoot });
  assert.deepEqual(
    slots.map(({ name }) => name),
    [worktree.name, "feat-failing-seed"],
  );

  backend.failing = null;
  const retried = create("feat/failing-seed");
  assert.equal(retried.path, failed);
  assert.equal(retried.slot, slots[1].slot);
  assert.equal(backend.calls.at(-1).owner, "feat-failing-seed");
});

test("the backend stages do not run while the database cannot be ensured", (t) => {
  const { databases, backend, create } = fixture(t);
  databases.failing = true;

  assert.throws(() => create(), /database service unavailable/);

  assert.equal(backend.calls.length, 1, "only the first, successful setup");
});

test("removing a worktree removes its storage before its database", (t) => {
  const { backend, remove, worktree } = fixture(t);

  remove();

  assert.deepEqual(backend.calls.at(-1), {
    step: "teardown",
    root: worktree.path,
    owner: worktree.name,
    force: false,
    database: true,
  });
});

test("storage that cannot be removed stops the removal and leaves everything in place", (t) => {
  const { mainRoot, databases, backend, remove, worktree, envPath } = fixture(t);
  backend.failing = "storage";

  assert.throws(() => remove(), /storage remove failed/);

  assert.ok(fs.existsSync(envPath));
  assert.equal(databases.owners.get(worktree.database), worktree.name);
  assert.deepEqual(listWorktrees({ mainRoot }), [{ slot: worktree.slot, name: worktree.name }]);

  backend.failing = null;
  remove();
  assert.equal(fs.existsSync(worktree.path), false);
  assert.deepEqual(listWorktrees({ mainRoot }), []);
});

test("a worktree with uncommitted work keeps its storage", (t) => {
  const { backend, remove, worktree } = fixture(t);
  fs.writeFileSync(path.join(worktree.path, "work.txt"), "unfinished\n");

  assert.throws(() => remove(), /uncommitted work/);

  assert.equal(
    backend.calls.some(({ step }) => step === "teardown"),
    false,
  );
});

test("a worktree folder that is already gone gets a storage notice instead of a teardown", (t) => {
  const { mainRoot, databases, backend, remove, worktree } = fixture(t);
  execFileSync("git", ["-C", mainRoot, "worktree", "remove", "--force", worktree.path]);

  remove();

  assert.equal(
    backend.calls.some(({ step }) => step === "teardown"),
    false,
  );
  assert.deepEqual(
    backend.calls.filter(({ step }) => step === "teardown-missing"),
    [{ step: "teardown-missing", owner: worktree.name }],
  );
  assert.equal(databases.owners.size, 0);
});
