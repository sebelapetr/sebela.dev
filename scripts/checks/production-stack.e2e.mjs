#!/usr/bin/env node
// Smoke check of the production composition (infra/README.md, docs/testing.md "CI"): the root
// compose.yaml with infra/production/compose.yaml, started from built images with the fictional
// demo seed.
//
//   node scripts/checks/production-stack.e2e.mjs
//
// Needs Docker with Compose and `tar`; plain Node with no dependencies. It builds the API, website
// and MCP Admin images under the GHCR names the composition runs, with a tag of this run, and:
//
// - checks them with the image-content check (scripts/checks/image-content.mjs), which must pass on
//   them and refuse its fixture image (scripts/checks/fixtures/image-content/);
// - starts the composition in a disposable Compose project from the documented production example
//   settings (infra/production/.env.example) with only what a test run must replace: those image
//   tags, random passwords and secrets, local storage instead of Bunny, the website on a free
//   loopback port;
// - loads the demo seed and checks that Postgres, the API, the website and MCP Admin are healthy,
//   that the migration finished, that only the website publishes a port and only on the loopback
//   interface, and that pages show the seed with `noindex` and without the analytics script;
// - checks that the website's /health reports the database failing when Postgres is stopped and the
//   API failing when the API is stopped;
// - checks that no password or secret is in the logs.
//
// It removes the project, its containers, volumes and the built images at the end, also when a
// step fails. Exits with 1 when a step fails.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";

const CHECKOUT_ROOT = path.join(import.meta.dirname, "..", "..");
const PRODUCTION_FILE = path.join(CHECKOUT_ROOT, "infra", "production", "compose.yaml");
const EXAMPLE_FILE = path.join(CHECKOUT_ROOT, "infra", "production", ".env.example");
const IMAGE_CHECK = path.join(CHECKOUT_ROOT, "scripts", "checks", "image-content.mjs");
const FIXTURE = path.join(CHECKOUT_ROOT, "scripts", "checks", "fixtures", "image-content");
const DEMO_SEED = path.join(CHECKOUT_ROOT, "packages", "db", "seed", "demo");
const REGISTRY = "ghcr.io/sebelapetr";
const APPS = ["api", "web", "mcp-admin"];
const HEALTHY_SERVICES = ["api", "mcp-admin", "postgres", "web"];

const example = parseEnv(fs.readFileSync(EXAMPLE_FILE, "utf8"));
const seededPerson = JSON.parse(fs.readFileSync(path.join(DEMO_SEED, "person.json"), "utf8"));
const tag = `smoke-${String(process.pid)}`;
const images = Object.fromEntries(APPS.map((app) => [app, `${REGISTRY}/sebela-${app}:${tag}`]));
const fixtureImage = `sebela-image-content-fixture:${tag}`;

const loopbackAddresses = new Set(
  Object.values(networkInterfaces())
    .flat()
    .filter((entry) => entry?.internal === true)
    .map((entry) => entry?.address),
);

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

const password = randomBytes(24).toString("hex");
const secret = randomBytes(32).toString("hex");
const webPort = String(await freePort(example.WEB_HOST));
const web = `http://${example.WEB_HOST}:${webPort}`;

// Compose reads the production example (`--env-file`); these process variables take precedence.
const env = {
  ...process.env,
  COMPOSE_PROJECT_NAME: `sebela-production-smoke-${String(process.pid)}`,
  API_IMAGE_TAG: tag,
  WEB_IMAGE_TAG: tag,
  MCP_ADMIN_IMAGE_TAG: tag,
  POSTGRES_USER: "sebela_smoke",
  POSTGRES_PASSWORD: password,
  // The superuser stands in for the application role the server preparation creates.
  DATABASE_USER: "sebela_smoke",
  DATABASE_PASSWORD: password,
  API_WEB_INVALIDATION_SECRET: secret,
  WEB_INVALIDATION_SECRET: secret,
  STORAGE_DRIVER: "local",
  STORAGE_BUNNY_ENDPOINT: "",
  STORAGE_BUNNY_REGION: "",
  STORAGE_BUNNY_ZONE: "",
  STORAGE_BUNNY_PASSWORD: "",
  WEB_PORT: webPort,
  WEB_SITE_ORIGIN: web,
  WEB_ANALYTICS_SCRIPT_URL: "",
  WEB_ANALYTICS_WEBSITE_ID: "",
  WEB_INDEXING: "",
};

/** The command's standard output, trimmed; empty when `options.stdio` does not pipe it. */
function run(command, args, options = {}) {
  const output = execFileSync(command, args, {
    cwd: CHECKOUT_ROOT,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  return (output ?? "").trim();
}

function compose(args) {
  return run("docker", [
    "compose",
    "--project-directory",
    CHECKOUT_ROOT,
    "--file",
    path.join(CHECKOUT_ROOT, "compose.yaml"),
    "--file",
    PRODUCTION_FILE,
    "--env-file",
    EXAMPLE_FILE,
    ...args,
  ]);
}

const step = (name) => process.stdout.write(`- ${name}\n`);

/** Every container of the project, also the finished migration (`docker compose ps --all`). */
function containers() {
  return compose(["ps", "--all", "--format", "json"])
    .split("\n")
    .filter((line) => line.trim() !== "")
    .flatMap((line) => {
      const parsed = JSON.parse(line);
      return Array.isArray(parsed) ? parsed : [parsed];
    });
}

async function health() {
  const response = await fetch(`${web}/health`, { signal: AbortSignal.timeout(10_000) });
  return { status: response.status, body: await response.json() };
}

async function waitFor(check, message, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

try {
  step("the API, website and MCP Admin images build under their published names");
  for (const app of APPS) {
    run(
      "docker",
      ["build", "--file", path.join("apps", app, "Dockerfile"), "--tag", images[app], "."],
      {
        stdio: ["ignore", "ignore", "inherit"],
      },
    );
  }
  run("docker", ["build", "--tag", fixtureImage, FIXTURE], {
    stdio: ["ignore", "ignore", "inherit"],
  });

  step("the image-content check passes on the images and refuses its fixture");
  const real = spawnSync(process.execPath, [IMAGE_CHECK, ...Object.values(images)], {
    env,
    encoding: "utf8",
  });
  assert.equal(real.status, 0, `the images contain forbidden files:\n${real.stdout}${real.stderr}`);
  const fixture = spawnSync(process.execPath, [IMAGE_CHECK, fixtureImage], {
    env,
    encoding: "utf8",
  });
  assert.equal(fixture.status, 1, "the fixture image is refused");

  // Local storage serves its files through the API, which the website reads inside the network.
  const config = JSON.parse(compose(["config", "--format", "json"]));
  const internalApi = config.services.web.environment.WEB_API_BASE_URL;
  assert.ok(internalApi, "compose.yaml gives the website an internal API address");
  const mediaRoot = `${internalApi}/v1/media/files`;
  env.STORAGE_PUBLIC_BASE_URL = mediaRoot;
  env.WEB_MEDIA_BASE_URL = `${mediaRoot}/${example.STORAGE_ENVIRONMENT}`;
  env.WEB_MEDIA_READ_BASE_URL = `${mediaRoot}/${example.STORAGE_ENVIRONMENT}`;

  step("the production composition starts healthy from the images");
  compose(["up", "--detach", "--wait", "--wait-timeout", "240"]);

  step("the demo seed through its explicit command");
  compose(["run", "--rm", "--no-TTY", "api", "node", "dist/cli/seed.js"]);

  step("every service is healthy, the migration finished, only the website is on loopback");
  const listed = containers();
  for (const name of HEALTHY_SERVICES) {
    const container = listed.find((entry) => entry.Service === name);
    assert.equal(container?.Health, "healthy", `${name} is healthy`);
  }
  const migration = listed.find((entry) => entry.Service === "migrate");
  assert.equal(migration?.State, "exited", "the migration ran once");
  assert.equal(migration?.ExitCode, 0, "the migration succeeded");
  for (const container of listed) {
    const published = (container.Publishers ?? []).filter((entry) => entry.PublishedPort > 0);
    if (container.Service !== "web") {
      assert.deepEqual(published, [], `${String(container.Service)} publishes no port`);
      continue;
    }
    assert.ok(published.length > 0, "the website is published");
    for (const entry of published) {
      assert.ok(loopbackAddresses.has(entry.URL), `the website is on ${String(entry.URL)}`);
      assert.equal(String(entry.PublishedPort), webPort);
    }
  }

  step("pages show the seed, noindex and no analytics script");
  for (const pathname of ["/", "/experience", "/cv"]) {
    const response = await fetch(`${web}${pathname}`, { redirect: "manual" });
    const html = await response.text();
    assert.equal(response.status, 200, `${pathname} answers 200`);
    assert.ok(html.includes(seededPerson.name), `${pathname} shows the seeded person`);
    assert.match(response.headers.get("x-robots-tag") ?? "", /noindex/, `${pathname} header`);
    assert.match(html, /<meta[^>]+name="robots"[^>]+noindex/, `${pathname} robots meta tag`);
    assert.ok(!html.includes("data-website-id"), `${pathname} loads no analytics script`);
  }

  step("the health route reports each failing part");
  assert.deepEqual(await health(), {
    status: 200,
    body: { status: "ok", api: "ok", postgres: "ok" },
  });
  compose(["stop", "postgres"]);
  await waitFor(
    async () => (await health()).body.postgres === "failing",
    "the health route did not report the database failing",
  );
  assert.deepEqual(await health(), {
    status: 503,
    body: { status: "failing", api: "ok", postgres: "failing" },
  });
  compose(["stop", "api"]);
  await waitFor(
    async () => (await health()).body.api === "failing",
    "the health route did not report the API failing",
  );
  assert.deepEqual(await health(), {
    status: 503,
    body: { status: "failing", api: "failing", postgres: "unknown" },
  });

  step("no password or secret in the logs");
  const logs = compose(["logs", "--no-color"]);
  for (const value of [password, secret]) {
    assert.ok(!logs.includes(value), "the logs contain no credential");
  }

  process.stdout.write("Production stack smoke check passed.\n");
} catch (error) {
  process.exitCode = 1;
  process.stderr.write(
    `Production stack smoke check failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  try {
    process.stderr.write(
      `${compose(["logs", "--no-color", "migrate", "api", "web", "mcp-admin"])}\n`,
    );
  } catch {
    // The project may not exist.
  }
} finally {
  try {
    compose(["down", "--volumes", "--remove-orphans"]);
  } catch (error) {
    process.exitCode = 1;
    process.stderr.write(`Removing the smoke project failed: ${String(error)}\n`);
  }
  for (const image of [...Object.values(images), fixtureImage]) {
    spawnSync("docker", ["image", "rm", "--force", image], { stdio: "ignore" });
  }
}
