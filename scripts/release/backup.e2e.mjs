// Backup and restore round trip (docs/release-workflow.md, "Backups" and "Restore"; docs/testing.md,
// CI): the real infra/scripts/backup.sh and restore.sh with the real age against a disposable
// Postgres of the production image (fixtures/backup-e2e/compose.yaml) and the fake storage zone
// with its heartbeat (fixtures/fake-storage.mjs). A fictional source database owned by the
// application role, with a pgvector column, is backed up, encrypted to a key generated for this
// run, uploaded; then fetched, decrypted here (never by the scripts), restored into a rehearsal
// database with equal row counts and the same vectors, and dropped. Needs Docker and age (`age`,
// `age-keygen`); runs in CI. Removes its project, volume and temporary files afterwards, and the
// Postgres image too when it pulled it.
//
//   node scripts/release/backup.e2e.mjs

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { startFakeStorage } from "./fixtures/fake-storage.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SCRIPTS = path.join(ROOT, "infra", "scripts");
const COMPOSE_FILE = path.join(import.meta.dirname, "fixtures", "backup-e2e", "compose.yaml");
const PROJECT = `sebela-backup-e2e-${process.pid}`;
const ZONE = "sebela-backups";
const PASSWORD = "fictional-zone-password-e2e";
const HEARTBEAT_ID = "fictional-heartbeat-e2e";
const SUPERUSER = "fictional_superuser";
const CLUSTER = "fictional_cluster";
const SITE = "fictional_site";
const APP = "fictional_app";
const REHEARSAL = "fictional_rehearsal";

// The pinned Postgres image of the root compose.yaml, so the round trip runs what production runs.
const IMAGE = /^\s+image:\s+(pgvector\/\S+)$/m.exec(
  fs.readFileSync(path.join(ROOT, "compose.yaml"), "utf8"),
)?.[1];
assert.ok(IMAGE, "compose.yaml names the Postgres image");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sebela-backup-e2e-"));
const envFile = path.join(dir, "production.env");
const keyFile = path.join(dir, "owner.key");
const storage = await startFakeStorage({ zone: ZONE, password: PASSWORD });

const environment = {
  ...process.env,
  COMPOSE_PROJECT_NAME: PROJECT,
  COMPOSE_FILE,
  BACKUP_E2E_POSTGRES_IMAGE: IMAGE,
  BACKUP_ENV_FILE: envFile,
};
delete environment.DEPLOY_ENV_FILE;

function run(command, args, { input, check = true, binary = false } = {}) {
  const result = spawnSync(command, args, {
    env: environment,
    input,
    encoding: binary ? "buffer" : "utf8",
    maxBuffer: 256 * 1024 * 1024,
    timeout: 300_000,
  });
  if (check && result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.stdout}${result.stderr}`);
  }
  return result;
}

const docker = (args, options) => run("docker", args, options);
/** SQL as the superuser in a database of the disposable Postgres. */
const sql = (database, text) =>
  docker([
    "compose",
    "--env-file",
    envFile,
    "exec",
    "-T",
    "postgres",
    "psql",
    "--username",
    SUPERUSER,
    "--dbname",
    database,
    "--no-psqlrc",
    "--tuples-only",
    "--no-align",
    "--set",
    "ON_ERROR_STOP=1",
    "--command",
    text,
  ]).stdout.trim();

/**
 * Runs one of the scripts asynchronously — the fake storage answers from this process's event
 * loop, which spawnSync would block — and resolves with its status, standard output (a buffer
 * when binary) and standard error; prints the latter and checks that no secret leaks.
 */
async function script(name, args, { input, binary = false } = {}) {
  const child = spawn("bash", [path.join(SCRIPTS, name), ...args], { env: environment });
  const out = [];
  const err = [];
  child.stdout.on("data", (chunk) => out.push(chunk));
  child.stderr.on("data", (chunk) => err.push(chunk));
  child.stdin.on("error", () => {});
  child.stdin.end(input ?? "");
  const status = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => child.kill("SIGKILL"), 300_000);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  const stdout = Buffer.concat(out);
  const stderr = Buffer.concat(err).toString();
  const result = { status, stdout: binary ? stdout : stdout.toString(), stderr };
  process.stdout.write(`$ ${name} ${args.join(" ")}\n${stderr}`);
  for (const secret of [PASSWORD, HEARTBEAT_ID]) {
    assert.equal(stderr.includes(secret), false, `${name} prints no secret on standard error`);
    if (!binary) {
      assert.equal(result.stdout.includes(secret), false, `${name} prints no secret`);
    }
  }
  return result;
}

const exists = (image) =>
  spawnSync("docker", ["image", "inspect", image], { stdio: "ignore" }).status === 0;
const hadImage = exists(IMAGE);
let failed = false;
try {
  run("age-keygen", ["--output", keyFile]);
  const recipient = run("age-keygen", ["-y", keyFile]).stdout.trim();
  fs.writeFileSync(
    envFile,
    [
      "# Fictional settings of the backup round trip.",
      `POSTGRES_USER=${SUPERUSER}`,
      "POSTGRES_PASSWORD=fictional-superuser-password",
      `POSTGRES_DB=${CLUSTER}`,
      `DATABASE_NAME=${SITE}`,
      `DATABASE_USER=${APP}`,
      `BACKUP_STORAGE_ENDPOINT=${storage.base}`,
      `BACKUP_STORAGE_ZONE=${ZONE}`,
      `BACKUP_STORAGE_PASSWORD=${PASSWORD}`,
      `BACKUP_AGE_RECIPIENT=${recipient}`,
      `BACKUP_HEARTBEAT_URL=${storage.base}/heartbeat/${HEARTBEAT_ID}`,
      "",
    ].join("\n"),
    { mode: 0o600 },
  );

  docker(["compose", "--env-file", envFile, "up", "--detach", "--wait", "postgres"]);

  // The source, prepared as on the server: the superuser creates the role, its database and the
  // extension; the application role owns the schemas and the rows.
  sql(CLUSTER, `CREATE ROLE "${APP}" LOGIN PASSWORD 'fictional-app-password'`);
  sql(CLUSTER, `CREATE DATABASE "${SITE}" OWNER "${APP}"`);
  sql(SITE, "CREATE EXTENSION vector");
  sql(
    SITE,
    `SET ROLE "${APP}";
     CREATE SCHEMA profile;
     CREATE SCHEMA ai_roadmap;
     CREATE TABLE profile.organizations (id serial PRIMARY KEY, name text NOT NULL);
     CREATE TABLE profile.experiences (
       id serial PRIMARY KEY,
       organization_id integer NOT NULL REFERENCES profile.organizations (id),
       title text NOT NULL
     );
     CREATE TABLE ai_roadmap.passages (id serial PRIMARY KEY, body text, embedding vector(3));
     INSERT INTO profile.organizations (name) VALUES ('Fictional Studio'), ('Example Labs');
     INSERT INTO profile.experiences (organization_id, title)
       SELECT 1 + n % 2, 'Fictional role ' || n FROM generate_series(1, 5) AS n;
     INSERT INTO ai_roadmap.passages (body, embedding)
       VALUES ('first', '[1,2,3]'), ('second', '[0.5,0.25,0.125]'), ('third', NULL);`,
  );

  // Backup: dumped, encrypted to the recipient, uploaded, heartbeat.
  let result = await script("backup.sh", []);
  assert.equal(result.status, 0, "the backup succeeds");
  assert.equal(storage.heartbeats(), 1, "the heartbeat is pinged once");
  const stored = [...storage.files.keys()];
  assert.equal(stored.length, 1, "one backup is stored");
  const [key] = stored;
  assert.match(key, /^postgres\/\d{8}T\d{6}Z\.dump\.age$/);
  assert.equal(
    storage.files.get(key).subarray(0, 21).toString(),
    "age-encryption.org/v1",
    "the stored backup is age-encrypted",
  );

  // Restore: listed, fetched, decrypted with the owner's key here, restored and compared.
  const name = path.basename(key);
  result = await script("restore.sh", ["list"]);
  assert.equal(result.status, 0, "the backups are listed");
  assert.equal(result.stdout, `${name}\n`);

  result = await script("restore.sh", ["fetch", name], { binary: true });
  assert.equal(result.status, 0, "the backup is fetched");
  assert.deepEqual(result.stdout, storage.files.get(key), "the fetched backup is the stored one");
  const dump = run("age", ["--decrypt", "--identity", keyFile], {
    input: result.stdout,
    binary: true,
  }).stdout;

  result = await script("restore.sh", ["into", REHEARSAL, "--confirm", REHEARSAL], { input: dump });
  process.stdout.write(result.stdout);
  assert.equal(result.status, 0, "the restore succeeds with equal row counts");
  assert.match(result.stdout, /profile\.experiences\s+5\s+5/);
  assert.match(result.stdout, /ai_roadmap\.passages\s+3\s+3/);
  assert.match(result.stdout, /equal/);

  const vectors =
    "SELECT string_agg(coalesce(embedding::text, '-'), ' ' ORDER BY id) FROM ai_roadmap.passages";
  assert.equal(sql(REHEARSAL, vectors), sql(SITE, vectors), "the vectors are restored");
  assert.equal(
    sql(REHEARSAL, "SELECT tableowner FROM pg_tables WHERE tablename = 'experiences'"),
    APP,
    "the restored tables belong to the application role",
  );

  // A second restore into the existing database needs --replace.
  result = await script("restore.sh", ["into", REHEARSAL, "--confirm", REHEARSAL], { input: dump });
  assert.notEqual(result.status, 0, "an existing database is not overwritten");
  result = await script("restore.sh", ["into", REHEARSAL, "--confirm", REHEARSAL, "--replace"], {
    input: dump,
  });
  assert.equal(result.status, 0, "the replaced database is restored again");

  result = await script("restore.sh", ["drop", REHEARSAL, "--confirm", REHEARSAL]);
  assert.equal(result.status, 0, "the rehearsal database is dropped");
  assert.equal(
    sql(CLUSTER, `SELECT count(*) FROM pg_database WHERE datname = '${REHEARSAL}'`),
    "0",
  );

  process.stdout.write("backup e2e: ok\n");
} catch (error) {
  failed = true;
  process.stderr.write(`backup e2e: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.stderr.write(
    docker(["compose", "--env-file", envFile, "logs", "--no-color"], { check: false }).stdout ?? "",
  );
} finally {
  if (fs.existsSync(envFile)) {
    docker(["compose", "--env-file", envFile, "down", "--volumes", "--remove-orphans"], {
      check: false,
    });
  }
  if (!hadImage) docker(["image", "rm", IMAGE], { check: false });
  await storage.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
process.exitCode = failed ? 1 : 0;
