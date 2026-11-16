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
const ENV_FILE = ".env.local";
// A temporary database a test run leaves behind, deliberately not of the worktree form: cleanup
// drops whatever the worktree's role owns, whatever its name.
const LEFTOVER = `leftover_${process.pid}`;

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

// Runs SQL in a database as a worktree's role, the way the worktree's own code connects: over the
// network with its password, not through the trusted local socket. The password reaches psql on
// standard input, never as an argument.
function sqlAs({ DATABASE_USER: user, DATABASE_PASSWORD: password }, database, statement) {
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
      'IFS= read -r PGPASSWORD; export PGPASSWORD; exec psql -X -q -A -t -v ON_ERROR_STOP=1 -h "$(hostname -i | cut -d " " -f 1)" -U "$1" -d "$2"',
      "sh",
      user,
      database,
    ],
    { env, input: `${password}\n${statement}`, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
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

const worktreeRoles = () =>
  sql(env.POSTGRES_DB, "SELECT rolname FROM pg_roles WHERE rolname LIKE 'wt\\_%' ORDER BY rolname;")
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
const envFile = (worktree) => path.join(worktree.path, ENV_FILE);
const settingsOf = (worktree) => parseEnv(fs.readFileSync(envFile(worktree), "utf8"));
const configuredDatabase = (worktree) => settingsOf(worktree).DATABASE_NAME;
// Runs SQL in the worktree's own database with the credentials of its environment file.
const sqlIn = (worktree, statement) =>
  sqlAs(settingsOf(worktree), configuredDatabase(worktree), statement);

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

  await step("each worktree has its own role with the documented attributes", () => {
    for (const worktree of [first, second]) {
      const settings = settingsOf(worktree);
      assert.equal(settings.DATABASE_USER, worktree.database);
      assert.match(settings.DATABASE_PASSWORD, /^[A-Za-z0-9_-]{43,}$/);
      assert.equal(
        sql(
          env.POSTGRES_DB,
          `SELECT concat_ws(',', rolcanlogin, rolcreatedb, rolsuper, rolcreaterole) FROM pg_roles WHERE rolname = '${settings.DATABASE_USER}';`,
        ),
        "t,t,f,f",
      );
      assert.equal(
        sql(
          env.POSTGRES_DB,
          `SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = '${worktree.database}';`,
        ),
        settings.DATABASE_USER,
      );
      assert.equal(
        sql(
          env.POSTGRES_DB,
          `SELECT count(*) FROM pg_database d, aclexplode(coalesce(d.datacl, acldefault('d', d.datdba))) a WHERE d.datname = '${worktree.database}' AND a.grantee = 0 AND a.privilege_type = 'CONNECT';`,
        ),
        "0",
      );
    }
    assert.notEqual(settingsOf(first).DATABASE_PASSWORD, settingsOf(second).DATABASE_PASSWORD);
    assert.deepEqual(worktreeRoles(), [first.database, second.database].sort());
  });

  await step("each worktree connects with its own credentials to its own database", () => {
    for (const worktree of [first, second]) {
      sqlIn(
        worktree,
        `CREATE TABLE note (body text); INSERT INTO note VALUES ('${worktree.name}');`,
      );
    }
    assert.equal(sqlIn(first, "SELECT string_agg(body, ',') FROM note;"), first.name);
    assert.equal(sqlIn(second, "SELECT string_agg(body, ',') FROM note;"), second.name);
  });

  await step("a worktree cannot connect to the other's database", () => {
    assert.throws(
      () => sqlAs(settingsOf(first), second.database, "SELECT 1;"),
      /permission denied for database/,
    );
    assert.throws(
      () => sqlAs(settingsOf(second), first.database, "SELECT 1;"),
      /permission denied for database/,
    );
  });

  await step("a wrong password is refused", () => {
    const wrong = { ...settingsOf(first), DATABASE_PASSWORD: settingsOf(second).DATABASE_PASSWORD };
    assert.throws(
      () => sqlAs(wrong, first.database, "SELECT 1;"),
      /password authentication failed/,
    );
  });

  await step("a worktree can create and drop a temporary database", () => {
    sqlIn(first, `CREATE DATABASE "${first.database}_tmp_dropped";`);
    assert.ok(databaseExists(`${first.database}_tmp_dropped`));
    sqlIn(first, `DROP DATABASE "${first.database}_tmp_dropped";`);
    assert.equal(databaseExists(`${first.database}_tmp_dropped`), false);
    // Left behind on purpose: cleanup removes temporary databases the role still owns.
    sqlIn(first, `CREATE DATABASE "${LEFTOVER}";`);
  });

  await step("creating a worktree again reuses its database and keeps its credentials", () => {
    const settings = fs.readFileSync(envFile(first), "utf8");
    assert.deepEqual(create("feat/1-first"), first);
    assert.equal(fs.readFileSync(envFile(first), "utf8"), settings);
    assert.equal(sqlIn(first, "SELECT string_agg(body, ',') FROM note;"), first.name);
  });

  await step("regenerating a missing environment file restores working credentials", () => {
    const previous = settingsOf(first);
    fs.rmSync(envFile(first));
    create("feat/1-first");
    assert.notEqual(settingsOf(first).DATABASE_PASSWORD, previous.DATABASE_PASSWORD);
    assert.equal(sqlIn(first, "SELECT string_agg(body, ',') FROM note;"), first.name);
    assert.throws(() => sqlAs(previous, first.database, "SELECT 1;"), /password authentication/);
  });

  await step("the command line never prints the password", () => {
    const cli = (...args) =>
      execFileSync(process.execPath, [path.join(import.meta.dirname, "worktree.mjs"), ...args], {
        cwd: mainRoot,
        env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    const created = cli("create", "feat/5-command-line");
    const worktree = { path: created.trim().split("\n").at(-1) };
    const { DATABASE_PASSWORD } = settingsOf(worktree);
    assert.equal(created.includes(DATABASE_PASSWORD), false);
    assert.equal(cli("remove", "feat/5-command-line").includes(DATABASE_PASSWORD), false);
  });

  await step("a role the scripts did not create for the worktree is refused and kept", () => {
    const foreign = databaseName("feat/6-foreign-role");
    sql(env.POSTGRES_DB, `CREATE ROLE "${foreign}" LOGIN;`);
    assert.throws(() => create("feat/6-foreign-role"), /refusing/);
    assert.equal(fs.existsSync(path.join(mainRoot, ".worktrees", "feat-6-foreign-role")), false);
    assert.equal(databaseExists(foreign), false);
    assert.throws(() => remove("feat/6-foreign-role"), /refusing/);
    assert.ok(worktreeRoles().includes(foreign));
    sql(env.POSTGRES_DB, `DROP ROLE "${foreign}";`);
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

  await step("removing one worktree drops its databases and role, and keeps the other's", () => {
    remove("feat/1-first");
    assert.equal(fs.existsSync(first.path), false);
    assert.equal(databaseExists(first.database), false);
    assert.equal(databaseExists(LEFTOVER), false);
    assert.deepEqual(worktreeRoles(), [second.database]);
    assert.equal(sqlIn(second, "SELECT string_agg(body, ',') FROM note;"), second.name);
    assert.deepEqual(listWorktrees({ mainRoot }), [{ slot: second.slot, name: second.name }]);
  });

  await step("removing the other leaves no worktree role, database or slot", () => {
    remove(second.path);
    assert.deepEqual(worktreeDatabases(), []);
    assert.deepEqual(worktreeRoles(), []);
    assert.deepEqual(listWorktrees({ mainRoot }), []);
    assert.ok(databaseExists(env.POSTGRES_DB));
  });

  await step("no password reached the server log", () => {
    assert.doesNotMatch(compose("logs", "postgres"), /PASSWORD\s+'(?!SCRAM-SHA-256\$)/i);
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
