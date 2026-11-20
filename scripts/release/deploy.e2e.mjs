// Simulated deployment (docs/release-workflow.md, "Deployment"; docs/testing.md, CI): the real
// infra/scripts/deploy.sh against a disposable Compose project of tiny busybox images
// (fixtures/deploy-e2e/compose.yaml), with a project name of its own and nothing published on the
// host. Each release is an image committed from busybox with a migration folder and a /healthy
// script, so nothing is built. The run deploys a first and a second healthy release, then a
// deliberately unhealthy one that must end with the second running again, refuses a release with
// a new migration while there is no backup script, and rolls back to the first release. Needs
// Docker; runs in CI. Removes its containers, volumes and images afterwards, and the busybox image
// too when it pulled it.
//
//   node scripts/release/deploy.e2e.mjs

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SCRIPT = path.join(ROOT, "infra", "scripts", "deploy.sh");
const COMPOSE_FILE = path.join(import.meta.dirname, "fixtures", "deploy-e2e", "compose.yaml");
const BASE_IMAGE = "busybox:1.37.0";
// A registry name that never resolves: every image must already be local, nothing is pulled.
const REGISTRY = "deploy-e2e.invalid/sebela";
const SERVICES = ["api", "web", "mcp-admin"];
const PROJECT = `sebela-deploy-e2e-${process.pid}`;

const sha = (character) => character.repeat(40);
const RELEASES = {
  first: { tag: sha("1"), migrations: ["0001_first.sql"], healthy: true },
  second: { tag: sha("2"), migrations: ["0001_first.sql"], healthy: true },
  unhealthy: { tag: sha("3"), migrations: ["0001_first.sql"], healthy: false },
  migrating: { tag: sha("4"), migrations: ["0001_first.sql", "0002_next.sql"], healthy: true },
};
const line = (tag) => SERVICES.map((service) => `${service}=${tag}`).join(" ");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sebela-deploy-e2e-"));
const state = path.join(dir, "state");
const envFile = path.join(dir, "production.env");
const backup = path.join(dir, "backup.sh");
const backupLog = path.join(dir, "backups");
const runs = path.join(dir, "runs");
fs.mkdirSync(state);
fs.mkdirSync(runs);
fs.writeFileSync(envFile, "# The fixture composition needs no settings.\n");
fs.writeFileSync(backup, `#!/bin/sh\necho backup >> "${backupLog}"\n`, { mode: 0o755 });

const environment = {
  ...process.env,
  COMPOSE_PROJECT_NAME: PROJECT,
  COMPOSE_FILE,
  DEPLOY_E2E_BASE_IMAGE: BASE_IMAGE,
  DEPLOY_E2E_RUNS_DIR: runs,
  DEPLOY_REGISTRY: REGISTRY,
  DEPLOY_ENV_FILE: envFile,
  DEPLOY_STATE_DIR: state,
  DEPLOY_BACKUP: backup,
  DEPLOY_WAIT_TIMEOUT: "60",
  API_IMAGE_TAG: RELEASES.first.tag,
  WEB_IMAGE_TAG: RELEASES.first.tag,
  MCP_ADMIN_IMAGE_TAG: RELEASES.first.tag,
};
delete environment.SSH_ORIGINAL_COMMAND;

function docker(args, { check = true } = {}) {
  const result = spawnSync("docker", args, { env: environment, encoding: "utf8" });
  if (check && result.status !== 0) {
    throw new Error(`docker ${args.join(" ")} failed:\n${result.stdout}${result.stderr}`);
  }
  return result.stdout.trim();
}

function deploy(input, env = {}) {
  const result = spawnSync("bash", [SCRIPT, ...input.split(" ")], {
    env: { ...environment, ...env },
    encoding: "utf8",
    timeout: 300_000,
  });
  process.stdout.write(`$ deploy.sh ${input}\n${result.stderr}`);
  return result;
}

/** Commits a busybox container with the release's migrations and health as all three images. */
function commitRelease({ tag, migrations, healthy }) {
  const files = path.join(dir, `image-${tag}`);
  const folder = path.join(files, "app", "packages", "db", "migrations");
  fs.mkdirSync(folder, { recursive: true });
  for (const name of migrations) fs.writeFileSync(path.join(folder, name), "-- fixture\n");
  fs.writeFileSync(path.join(files, "healthy"), `#!/bin/sh\nexit ${healthy ? 0 : 1}\n`, {
    mode: 0o755,
  });
  const container = docker(["create", BASE_IMAGE]);
  try {
    docker(["cp", `${files}/.`, `${container}:/`]);
    const [first, ...others] = SERVICES.map((service) => `${REGISTRY}/sebela-${service}:${tag}`);
    docker(["commit", "--change", 'CMD ["sleep", "3600"]', container, first]);
    for (const other of others) docker(["tag", first, other]);
  } finally {
    docker(["rm", "--force", container], { check: false });
  }
}

/** The image tag each running service was started from. */
function running() {
  const tags = {};
  for (const service of SERVICES) {
    const id = docker(["compose", "ps", "--quiet", service]);
    assert.ok(id, `${service} is running`);
    const image = docker(["inspect", "--format", "{{.Config.Image}}", id]);
    const health = docker(["inspect", "--format", "{{.State.Health.Status}}", id]);
    assert.equal(health, "healthy", `${service} is healthy`);
    tags[service] = image.slice(image.lastIndexOf(":") + 1);
  }
  return tags;
}

const all = (tag) => Object.fromEntries(SERVICES.map((service) => [service, tag]));
const recorded = () =>
  fs.readFileSync(path.join(state, "releases"), "utf8").split("\n").filter(Boolean);
const lines = (file) =>
  fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean).length : 0;
const backups = () => lines(backupLog);
/** How often the migration has run so far. */
const migrations = () => lines(path.join(runs, "migrations"));

const exists = (image) =>
  spawnSync("docker", ["image", "inspect", image], { stdio: "ignore" }).status === 0;

const hadBaseImage = exists(BASE_IMAGE);
let failed = false;
try {
  if (!hadBaseImage) docker(["pull", BASE_IMAGE]);
  // Each release's images appear just before its deployment, as a pull would bring them: a
  // healthy deployment prunes every image of the three services outside the last two releases.

  // The first release: no current release, so it backs up first, then runs healthy.
  commitRelease(RELEASES.first);
  let result = deploy(`deploy ${line(RELEASES.first.tag)}`);
  assert.equal(result.status, 0, "the first release deploys");
  assert.deepEqual(running(), all(RELEASES.first.tag));
  assert.deepEqual(recorded(), [line(RELEASES.first.tag)]);
  assert.equal(backups(), 1, "the first release was backed up");
  assert.equal(migrations(), 1, "the first release migrated once");

  // The second release has the same migrations: no backup.
  commitRelease(RELEASES.second);
  result = deploy(`deploy ${line(RELEASES.second.tag)}`);
  assert.equal(result.status, 0, "the second release deploys");
  assert.deepEqual(running(), all(RELEASES.second.tag));
  assert.deepEqual(recorded(), [line(RELEASES.first.tag), line(RELEASES.second.tag)]);
  assert.equal(backups(), 1, "no backup without a new migration");
  assert.equal(migrations(), 2, "the second release migrated once");

  // A deliberately unhealthy release ends with the second release running again.
  commitRelease(RELEASES.unhealthy);
  result = deploy(`deploy ${line(RELEASES.unhealthy.tag)}`);
  assert.notEqual(result.status, 0, "the unhealthy release fails");
  assert.match(result.stderr, /previous release is running again/);
  assert.deepEqual(running(), all(RELEASES.second.tag));
  assert.deepEqual(recorded(), [line(RELEASES.first.tag), line(RELEASES.second.tag)]);
  assert.equal(migrations(), 3, "the unhealthy release migrated once; its fallback did not");

  // A new migration without a backup script is refused before anything changes.
  commitRelease(RELEASES.migrating);
  result = deploy(`deploy ${line(RELEASES.migrating.tag)}`, {
    DEPLOY_BACKUP: path.join(dir, "no-backup.sh"),
  });
  assert.notEqual(result.status, 0, "a new migration without a backup is refused");
  assert.match(result.stderr, /new migration/);
  assert.deepEqual(running(), all(RELEASES.second.tag));

  // The documented rollback returns to the first release.
  result = deploy("rollback");
  assert.equal(result.status, 0, "the rollback succeeds");
  assert.deepEqual(running(), all(RELEASES.first.tag));
  assert.deepEqual(recorded(), [line(RELEASES.first.tag)]);
  assert.equal(migrations(), 3, "neither the refused release nor the rollback migrated");
  for (const service of SERVICES) {
    const image = `${REGISTRY}/sebela-${service}:${RELEASES.first.tag}`;
    assert.ok(exists(image), `${image} is kept`);
    const pruned = `${REGISTRY}/sebela-${service}:${RELEASES.unhealthy.tag}`;
    assert.equal(exists(pruned), false, `${pruned} is pruned`);
  }

  process.stdout.write("deploy e2e: ok\n");
} catch (error) {
  failed = true;
  process.stderr.write(`deploy e2e: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.stderr.write(`${docker(["compose", "ps", "--all"], { check: false })}\n`);
} finally {
  docker(["compose", "down", "--volumes", "--remove-orphans"], { check: false });
  const images = docker(
    ["image", "ls", "--format", "{{.Repository}}:{{.Tag}}", "--filter", `reference=${REGISTRY}/*`],
    { check: false },
  )
    .split("\n")
    .filter(Boolean);
  if (images.length > 0) docker(["image", "rm", "--force", ...images], { check: false });
  if (!hadBaseImage) docker(["image", "rm", BASE_IMAGE], { check: false });
  fs.rmSync(dir, { recursive: true, force: true });
}
if (failed) process.exitCode = 1;
