#!/usr/bin/env node
// End-to-end run of the worktree databases against a real Postgres from compose.yaml — see
// docs/repository-structure.md ("Ports and worktree isolation").
//
//   node harness/worktree-databases.e2e.mjs
//
// Needs Docker with Compose. It starts its own disposable Compose project from this checkout's
// compose.yaml on a free host port, so the shared stack and its volume are never touched, and works
// with worktrees of a temporary repository. It removes the project, its volume and the repository
// at the end, also when a step fails. Exits with 1 when a step fails.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";
import { databaseName } from "./lib/slots.mjs";
import { createWorktree, listWorktrees, loadSettings, removeWorktree } from "./worktree.mjs";

const CHECKOUT_ROOT = path.join(import.meta.dirname, "..");

// The settings of this run: the documented ones, a project of its own and any free host port.
const base = loadSettings(process.env);
const env = {
  ...base,
  COMPOSE_PROJECT_NAME: `sebela-e2e-${process.pid}`,
  POSTGRES_PORT: String(await freePort(base.POSTGRES_HOST)),
};

function freePort(host) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, host, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function compose(...args) {
  return execFileSync("docker", ["compose", "--project-directory", CHECKOUT_ROOT, ...args], {
    env,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

// Runs SQL in one database as the service's superuser. The database name is passed to the shell
// as an argument, not written into the command.
function sql(database, statement) {
  return execFileSync(
    "docker",
    [
      "compose",
      "--project-directory",
      CHECKOUT_ROOT,
      "exec",
      "-T",
      "postgres",
      "sh",
      "-c",
      'exec psql -X -q -A -t -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$1"',
      "sh",
      database,
    ],
    { env, input: statement, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
}

const databaseExists = (name) =>
  sql(env.POSTGRES_DB, `SELECT count(*) FROM pg_database WHERE datname = '${name}';`) === "1";

const worktreeDatabases = () =>
  sql(
    env.POSTGRES_DB,
    "SELECT datname FROM pg_database WHERE datname LIKE 'wt\\_%' ORDER BY datname;",
  )
    .split("\n")
    .filter(Boolean);

function canConnect(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port: Number(port) }, () => {
      socket.end();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
  });
}

function temporaryRepository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sebela-e2e-worktrees-"));
  const git = (...args) =>
    execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-C", root, ...args], {
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
  return root;
}

// The database a worktree's code would use, read the way an app loads its environment file.
const configuredDatabase = (worktree) =>
  parseEnv(fs.readFileSync(path.join(worktree.path, ".env.local"), "utf8")).DATABASE_NAME;

async function step(description, fn) {
  try {
    await fn();
  } catch (error) {
    error.message = `${description}: ${error.stderr?.toString().trim() || error.message}`;
    throw error;
  }
  console.log(`ok - ${description}`);
}

const mainRoot = temporaryRepository();
const create = (branch) => createWorktree({ mainRoot, branch, env });
const remove = (target) => removeWorktree({ mainRoot, target, env });
let failed = false;

try {
  await step("the Postgres service starts and reports healthy", () => {
    compose("up", "--detach", "--wait", "--wait-timeout", "120");
    assert.match(compose("ps", "--format", "{{.Health}}", "postgres"), /^healthy$/);
  });

  await step("it is published on the configured host and port", async () => {
    assert.ok(await canConnect(env.POSTGRES_HOST, env.POSTGRES_PORT));
  });

  await step("pgvector can be created", () => {
    sql(env.POSTGRES_DB, "CREATE EXTENSION IF NOT EXISTS vector; DROP EXTENSION vector;");
  });

  let first;
  let second;
  await step("two worktrees get their own databases, named in their environment files", () => {
    first = create("feat/1-first");
    second = create("fix/2-second");
    assert.equal(first.database, databaseName("feat/1-first"));
    assert.equal(configuredDatabase(first), first.database);
    assert.equal(configuredDatabase(second), second.database);
    assert.notEqual(first.database, second.database);
    assert.deepEqual(worktreeDatabases(), [first.database, second.database].sort());
  });

  await step("both databases are usable independently", () => {
    for (const worktree of [first, second]) {
      const database = configuredDatabase(worktree);
      sql(database, `CREATE TABLE note (body text); INSERT INTO note VALUES ('${worktree.name}');`);
    }
    assert.equal(
      sql(configuredDatabase(first), "SELECT string_agg(body, ',') FROM note;"),
      first.name,
    );
    assert.equal(
      sql(configuredDatabase(second), "SELECT string_agg(body, ',') FROM note;"),
      second.name,
    );
  });

  await step("creating a worktree again reuses its database and keeps its data", () => {
    assert.deepEqual(create("feat/1-first"), first);
    assert.equal(sql(first.database, "SELECT string_agg(body, ',') FROM note;"), first.name);
  });

  await step("a database the scripts did not create for the worktree is refused and kept", () => {
    const foreign = databaseName("feat/3-foreign");
    sql(env.POSTGRES_DB, `CREATE DATABASE "${foreign}";`);
    assert.throws(() => create("feat/3-foreign"), /refusing/);
    assert.equal(fs.existsSync(path.join(mainRoot, ".worktrees", "feat-3-foreign")), false);
    assert.throws(() => remove("feat/3-foreign"), /refusing/);
    assert.ok(databaseExists(foreign));
    sql(env.POSTGRES_DB, `DROP DATABASE "${foreign}";`);
  });

  await step("without a running service no worktree is created and no slot is held", () => {
    compose("stop", "postgres");
    try {
      assert.throws(() => create("feat/4-offline"), /shared Postgres/);
      assert.equal(fs.existsSync(path.join(mainRoot, ".worktrees", "feat-4-offline")), false);
      assert.deepEqual(
        listWorktrees({ mainRoot }).map(({ name }) => name),
        [first.name, second.name],
      );
      assert.throws(() => remove("fix/2-second"), /shared Postgres/);
      assert.ok(fs.existsSync(second.path));
    } finally {
      compose("up", "--detach", "--wait", "--wait-timeout", "120");
    }
  });

  await step("removing one worktree drops its database and keeps the other's data", () => {
    remove("feat/1-first");
    assert.equal(fs.existsSync(first.path), false);
    assert.equal(databaseExists(first.database), false);
    assert.equal(sql(second.database, "SELECT string_agg(body, ',') FROM note;"), second.name);
    assert.deepEqual(listWorktrees({ mainRoot }), [{ slot: second.slot, name: second.name }]);
  });

  await step("removing the other leaves no worktree database and no slot", () => {
    remove(second.path);
    assert.deepEqual(worktreeDatabases(), []);
    assert.deepEqual(listWorktrees({ mainRoot }), []);
    assert.ok(databaseExists(env.POSTGRES_DB));
  });
} catch (error) {
  failed = true;
  console.error(`not ok - ${error.message}`);
} finally {
  try {
    compose("down", "--volumes", "--remove-orphans");
    console.log("ok - the disposable project and its volume are removed");
  } catch (error) {
    failed = true;
    console.error(
      `not ok - removing project ${env.COMPOSE_PROJECT_NAME}: ${error.stderr?.toString().trim() || error.message}`,
    );
  }
  fs.rmSync(mainRoot, { recursive: true, force: true });
}

process.exitCode = failed ? 1 : 0;
