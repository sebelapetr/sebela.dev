#!/usr/bin/env node
// Smoke check of the containerised API stack of compose.yaml — see docs/testing.md ("CI") and
// apps/api/AGENTS.md ("Container stack").
//
//   node scripts/checks/api-stack.e2e.mjs
//
// Needs Docker with Compose. It builds the API image and starts its own disposable Compose project
// from this checkout's compose.yaml, with the documented settings of `.env.example` only (never a
// `.env`), free host ports and a random database password that exists only in this run. It checks:
//
// - a failed migration keeps the API from starting;
// - the migration service migrates an empty database before the API starts, and the API seeds
//   nothing by itself;
// - health, the OpenAPI document and the reference;
// - the demo seed loaded by its explicit command, read through the public API;
// - the first API key created by its explicit command, a refused write without it and a media
//   upload with it, downloaded again from the local storage volume;
// - a restart of the API that keeps the content and the uploaded file;
// - no key or password in the logs of the stack.
//
// It removes the project, its containers, volumes and images at the end, also when a step fails.
// Plain Node with no dependencies. Exits with 1 when a step fails.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { parseEnv } from "node:util";

const CHECKOUT_ROOT = path.join(import.meta.dirname, "..", "..");
const EXAMPLE_FILE = path.join(CHECKOUT_ROOT, ".env.example");
const DEMO_SEED = path.join(CHECKOUT_ROOT, "packages", "db", "seed", "demo");

const example = parseEnv(fs.readFileSync(EXAMPLE_FILE, "utf8"));
const host = example.API_HOST;
const password = randomBytes(24).toString("hex");
const apiPort = await freePort(host);

// Compose reads `.env.example` (`--env-file`); these process variables take precedence over it.
const env = {
  ...process.env,
  COMPOSE_PROJECT_NAME: `sebela-api-smoke-${process.pid}`,
  POSTGRES_PORT: String(await freePort(example.POSTGRES_HOST)),
  POSTGRES_PASSWORD: password,
  DATABASE_NAME: example.POSTGRES_DB,
  DATABASE_USER: example.POSTGRES_USER,
  DATABASE_PASSWORD: password,
  API_PORT: String(apiPort),
  STORAGE_PUBLIC_BASE_URL: `http://${host}:${String(apiPort)}/v1/media/files`,
};
const base = `http://${host}:${String(apiPort)}`;

function freePort(address) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, address, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function compose(args, overrides = {}) {
  return execFileSync(
    "docker",
    [
      "compose",
      "--project-directory",
      CHECKOUT_ROOT,
      "--env-file",
      EXAMPLE_FILE,
      "--profile",
      "api",
      ...args,
    ],
    {
      env: { ...env, ...overrides },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    },
  ).trim();
}

// The state and exit code of a service's container, also when it has stopped.
function containerState(service) {
  const line = compose(["ps", "--all", "--format", "{{.State}} {{.ExitCode}}", service]);
  const [state = "missing", exitCode = ""] = line.split(/\s+/);
  return { state, exitCode };
}

async function waitForHealth() {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) throw new Error("the API did not become healthy");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

const step = (name) => process.stdout.write(`- ${name}\n`);

// Compose interpolates every service, also those of an inactive profile. The Postgres-only
// commands of a checkout whose `.env` has the Postgres settings only must still work.
function postgresOnlyConfig() {
  const scratch = path.join(CHECKOUT_ROOT, ".tmp");
  fs.mkdirSync(scratch, { recursive: true });
  const envFile = path.join(scratch, `api-stack-postgres-only-${String(process.pid)}.env`);
  const postgresSettings = Object.entries(example).filter(([name]) => name.startsWith("POSTGRES_"));
  fs.writeFileSync(envFile, postgresSettings.map(([name, value]) => `${name}=${value}\n`).join(""));
  const apiSettings = /^(?:API_|STORAGE_|MEDIA_|DATABASE_)/;
  try {
    execFileSync(
      "docker",
      ["compose", "--project-directory", CHECKOUT_ROOT, "--env-file", envFile, "config", "--quiet"],
      {
        env: Object.fromEntries(Object.entries(env).filter(([name]) => !apiSettings.test(name))),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } catch (error) {
    const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : String(error);
    throw new Error(`Compose without the API settings failed: ${stderr}`, { cause: error });
  } finally {
    fs.rmSync(envFile, { force: true });
  }
}

try {
  step("Postgres-only commands need none of the API settings");
  postgresOnlyConfig();

  step("a failed migration keeps the API from starting");
  assert.throws(
    () =>
      compose(["up", "--build", "--detach", "--wait", "--wait-timeout", "180"], {
        DATABASE_NAME: `missing_${String(process.pid)}`,
      }),
    "starting the stack against a database that does not exist must fail",
  );
  assert.notEqual(containerState("migrate").exitCode, "0");
  assert.notEqual(containerState("api").state, "running");

  step("the migration service completes before the API starts");
  compose(["up", "--build", "--detach", "--wait", "--wait-timeout", "180"]);
  assert.deepEqual(containerState("migrate"), { state: "exited", exitCode: "0" });
  assert.equal(containerState("api").state, "running");

  step("an empty migrated database: no person until the seed runs");
  const unseeded = await fetch(`${base}/v1/person`);
  assert.equal(unseeded.status, 404);

  step("health, OpenAPI document and reference");
  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok" });
  const openapi = await fetch(`${base}/openapi.json`);
  assert.equal(openapi.status, 200);
  const document = await openapi.json();
  assert.match(document.openapi, /^3\.1\./);
  assert.ok(document.paths["/v1/person"], "the document describes /v1/person");
  const reference = await fetch(`${base}/reference`);
  assert.equal(reference.status, 200);
  assert.match(reference.headers.get("content-type") ?? "", /text\/html/);

  step("the demo seed through its explicit command");
  compose(["run", "--rm", "--no-TTY", "api", "node", "dist/cli/seed.js"]);
  const person = await fetch(`${base}/v1/person`);
  assert.equal(person.status, 200);
  const seededPerson = JSON.parse(fs.readFileSync(path.join(DEMO_SEED, "person.json"), "utf8"));
  assert.equal((await person.json()).name, seededPerson.name);
  const seededMedia = await (await fetch(`${base}/v1/media`)).json();
  assert.ok(seededMedia.length > 0, "the demo seed has media");
  const seededFile = await fetch(seededMedia[0].url);
  assert.equal(seededFile.status, 200);

  step("the first API key through its explicit command");
  const created = compose([
    "run",
    "--rm",
    "--no-TTY",
    "api",
    "node",
    "dist/cli/api-keys.js",
    "create",
    "smoke",
  ]);
  const key = /^sebela_\S+$/m.exec(created)?.[0];
  assert.ok(key, "the command prints the new key");

  step("a write without a key is refused, one with the key succeeds");
  const sample = fs.readFileSync(path.join(DEMO_SEED, "files", "logo-harbor.png"));
  const upload = () => {
    const form = new FormData();
    form.append("file", new Blob([sample], { type: "image/png" }), "smoke.png");
    form.append("altText", "Smoke check upload");
    return form;
  };
  const refused = await fetch(`${base}/v1/media`, { method: "POST", body: upload() });
  assert.equal(refused.status, 401);
  const uploaded = await fetch(`${base}/v1/media`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}` },
    body: upload(),
  });
  assert.equal(uploaded.status, 201);
  const media = await uploaded.json();
  const downloaded = await fetch(media.url);
  assert.equal(downloaded.status, 200);
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), sample);

  step("a restart keeps the content and the uploaded file");
  compose(["restart", "api"]);
  await waitForHealth();
  assert.equal((await fetch(`${base}/v1/person`)).status, 200);
  const again = await fetch(media.url);
  assert.equal(again.status, 200);
  assert.deepEqual(Buffer.from(await again.arrayBuffer()), sample);

  step("no key or password in the logs");
  const logs = compose(["logs", "--no-color"]);
  assert.ok(!logs.includes(key), "the logs do not contain the key");
  assert.ok(!logs.includes(password), "the logs do not contain the password");

  process.stdout.write("API stack smoke check passed.\n");
} catch (error) {
  process.exitCode = 1;
  process.stderr.write(
    `API stack smoke check failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  try {
    process.stderr.write(`${compose(["logs", "--no-color", "migrate", "api"])}\n`);
  } catch {
    // The stack may not exist.
  }
} finally {
  try {
    compose(["down", "--volumes", "--remove-orphans", "--rmi", "local"]);
  } catch (error) {
    process.exitCode = 1;
    process.stderr.write(`Removing the smoke stack failed: ${String(error)}\n`);
  }
}
