#!/usr/bin/env node
// Smoke check of the complete containerised website stack of compose.yaml (Postgres, migration,
// API and website) — see docs/testing.md ("CI") and apps/web/AGENTS.md ("Container").
//
//   node scripts/checks/web-stack.e2e.mjs
//
// Needs Docker with Compose, and the website's installed dependencies with Chromium for the
// browser step (`pnpm install`, then `pnpm --filter @sebela/web exec playwright install chromium`).
// It builds the API and website images and starts two disposable Compose projects from this
// checkout's compose.yaml, stacks A and B, as two worktrees would run side by side: each with the
// documented settings of `.env.example` only (never a `.env`), its own free host ports, its own
// Postgres volume with a random password, its own storage folder (STORAGE_WORKTREE) and its own
// random invalidation secret. It loads the fictional demo seed into each and checks:
//
// - real pages and the CV PDF through each website, read from its own API inside the network,
//   without the API's internal address in any page;
// - a stored image served and optimised on the website's own media path, equal to the API's file;
// - an authenticated content edit through A's API that A's website shows at once (the content
//   cache's fallback interval is an hour, so only the signed invalidation can refresh it), while B
//   still shows its own content;
// - isolation: A's key is refused by B's API, A's uploaded file is not on B's website, and a
//   notification signed with A's secret is refused by B's website, which accepts its own;
// - the hero's question to the chat-off Ask page in a browser, with screenshots at 360, 768 and
//   1280 px in light and dark mode, axe, keyboard and no horizontal scroll
//   (apps/web/e2e/complete-stack/, apps/web/playwright.complete-stack.config.ts);
// - no key, password or secret in the logs of either stack.
//
// It removes both projects, their containers, volumes and images at the end, also when a step
// fails. Plain Node with no dependencies. Exits with 1 when a step fails.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { parseEnv } from "node:util";

const CHECKOUT_ROOT = path.join(import.meta.dirname, "..", "..");
const EXAMPLE_FILE = path.join(CHECKOUT_ROOT, ".env.example");
const DEMO_SEED = path.join(CHECKOUT_ROOT, "packages", "db", "seed", "demo");
const WEB_ROOT = path.join(CHECKOUT_ROOT, "apps", "web");
const PLAYWRIGHT_CLI = path.join(WEB_ROOT, "node_modules", "@playwright", "test", "cli.js");

// The receiver and its headers (packages/contracts, invalidation): `v1=` and the hex HMAC-SHA256
// of `<timestamp>.<body>`.
const INVALIDATION_PATH = "/internal/invalidation";
const TIMESTAMP_HEADER = "sebela-invalidation-timestamp";
const SIGNATURE_HEADER = "sebela-invalidation-signature";

const example = parseEnv(fs.readFileSync(EXAMPLE_FILE, "utf8"));
const seededPerson = JSON.parse(fs.readFileSync(path.join(DEMO_SEED, "person.json"), "utf8"));

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

async function createStack(label) {
  const password = randomBytes(24).toString("hex");
  const secret = randomBytes(32).toString("hex");
  const apiPort = String(await freePort(example.API_HOST));
  const webPort = String(await freePort(example.WEB_HOST));
  const worktree = `smoke-${label}`;
  const api = `http://${example.API_HOST}:${apiPort}`;
  const web = `http://${example.WEB_HOST}:${webPort}`;
  const mediaRoot = `${api}/v1/media/files`;
  return {
    label,
    api,
    web,
    password,
    secret,
    key: "",
    // Compose reads `.env.example` (`--env-file`); these process variables take precedence.
    env: {
      ...process.env,
      COMPOSE_PROJECT_NAME: `sebela-web-smoke-${String(process.pid)}-${label}`,
      POSTGRES_PORT: String(await freePort(example.POSTGRES_HOST)),
      POSTGRES_PASSWORD: password,
      DATABASE_NAME: example.POSTGRES_DB,
      DATABASE_USER: example.POSTGRES_USER,
      DATABASE_PASSWORD: password,
      API_PORT: apiPort,
      API_WEB_INVALIDATION_SECRET: secret,
      STORAGE_WORKTREE: worktree,
      STORAGE_PUBLIC_BASE_URL: mediaRoot,
      WEB_PORT: webPort,
      WEB_SITE_ORIGIN: web,
      WEB_MEDIA_BASE_URL: `${mediaRoot}/${example.STORAGE_ENVIRONMENT}/${worktree}`,
      WEB_MEDIA_READ_BASE_URL: "",
      WEB_INVALIDATION_SECRET: secret,
      WEB_CONTENT_REVALIDATE_SECONDS: "3600",
    },
  };
}

function compose(stack, args) {
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
      "--profile",
      "web",
      ...args,
    ],
    {
      env: stack.env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    },
  ).trim();
}

const step = (name) => process.stdout.write(`- ${name}\n`);

async function page(stack, pathname) {
  const response = await fetch(`${stack.web}${pathname}`, { redirect: "manual" });
  return { status: response.status, html: await response.text() };
}

function signedNotification(secret) {
  const body = JSON.stringify({
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    changes: [{ domain: "person", record: null, action: "updated" }],
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [TIMESTAMP_HEADER]: timestamp,
      [SIGNATURE_HEADER]: `v1=${digest}`,
    },
    body,
  };
}

async function waitFor(check, message, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

const stacks = [await createStack("a"), await createStack("b")];
const [a, b] = stacks;

// Where the website's server reads the API inside the network, as compose.yaml resolves it; no page
// may name it to visitors.
function internalApiAddress(stack) {
  const config = JSON.parse(compose(stack, ["config", "--format", "json"]));
  const address = config.services.web.environment.WEB_API_BASE_URL;
  assert.ok(address, "compose.yaml gives the website an internal API address");
  return address;
}

try {
  const internalApi = internalApiAddress(a);
  for (const stack of stacks) {
    step(`stack ${stack.label}: database, migration, API and website start healthy`);
    compose(stack, ["up", "--build", "--detach", "--wait", "--wait-timeout", "240"]);

    step(`stack ${stack.label}: the demo seed and an API key through their explicit commands`);
    compose(stack, ["run", "--rm", "--no-TTY", "api", "node", "dist/cli/seed.js"]);
    const created = compose(stack, [
      "run",
      "--rm",
      "--no-TTY",
      "api",
      "node",
      "dist/cli/api-keys.js",
      "create",
      "smoke",
    ]);
    stack.key = /^sebela_\S+$/m.exec(created)?.[0] ?? "";
    assert.ok(stack.key, "the command prints the new key");
  }

  for (const stack of stacks) {
    step(`stack ${stack.label}: real pages read from its own API, without internal addresses`);
    for (const pathname of ["/", "/experience", "/services", "/cv", "/ask"]) {
      const { status, html } = await page(stack, pathname);
      assert.equal(status, 200, `${pathname} answers 200`);
      assert.ok(html.includes(seededPerson.name), `${pathname} shows the seeded person`);
      assert.ok(!html.includes(internalApi), `${pathname} does not name the internal API`);
      assert.ok(!html.includes(stack.secret), `${pathname} does not contain the secret`);
    }

    step(`stack ${stack.label}: the photo on the site's own media path, and the CV PDF`);
    const { html } = await page(stack, "/");
    const name = /\/media\/([0-9a-f-]+\.(?:png|jpg|webp))/.exec(html)?.[1];
    assert.ok(name, "the homepage shows a stored image from /media/");
    const served = await fetch(`${stack.web}/media/${name}`);
    assert.equal(served.status, 200);
    const original = await fetch(`${stack.env.WEB_MEDIA_BASE_URL}/${name}`);
    assert.equal(original.status, 200);
    assert.deepEqual(
      Buffer.from(await served.arrayBuffer()),
      Buffer.from(await original.arrayBuffer()),
    );
    const optimised = await fetch(
      `${stack.web}/_next/image?url=${encodeURIComponent(`/media/${name}`)}&w=256&q=75`,
    );
    assert.equal(optimised.status, 200);
    assert.match(optimised.headers.get("content-type") ?? "", /^image\//);
    const cv = await fetch(`${stack.web}/cv/pdf`);
    assert.equal(cv.status, 200);
    assert.match(cv.headers.get("content-type") ?? "", /^application\/pdf/);
    assert.equal(
      Buffer.from(await cv.arrayBuffer())
        .subarray(0, 4)
        .toString("latin1"),
      "%PDF",
    );
  }

  step("an authenticated edit through A's API refreshes A's website, and only A's");
  const headline = `Smoke check headline ${String(process.pid)}`;
  const edited = await fetch(`${a.api}/v1/person`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${a.key}`, "content-type": "application/json" },
    body: JSON.stringify({ headline }),
  });
  assert.equal(edited.status, 200);
  await waitFor(
    async () => (await page(a, "/")).html.includes(headline),
    "A's website did not show the edited headline",
  );
  const other = await page(b, "/");
  assert.ok(!other.html.includes(headline), "B's website does not show A's edit");
  assert.ok(other.html.includes(seededPerson.headline), "B's website keeps its own headline");

  step("A's key cannot update B's content");
  const foreignEdit = await fetch(`${b.api}/v1/person`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${a.key}`, "content-type": "application/json" },
    body: JSON.stringify({ headline }),
  });
  assert.equal(foreignEdit.status, 401);

  step("A's uploaded file is on A's website, not on B's");
  const sample = fs.readFileSync(path.join(DEMO_SEED, "files", "logo-harbor.png"));
  const form = new FormData();
  form.append("file", new Blob([sample], { type: "image/png" }), "smoke.png");
  form.append("altText", "Smoke check upload");
  const uploaded = await fetch(`${a.api}/v1/media`, {
    method: "POST",
    headers: { authorization: `Bearer ${a.key}` },
    body: form,
  });
  assert.equal(uploaded.status, 201);
  const file = path.posix.basename(new URL((await uploaded.json()).url).pathname);
  const own = await fetch(`${a.web}/media/${file}`);
  assert.equal(own.status, 200);
  assert.deepEqual(Buffer.from(await own.arrayBuffer()), sample);
  assert.equal((await fetch(`${b.web}/media/${file}`)).status, 404);

  step("a notification signed with A's secret cannot invalidate B's cache; B's own can");
  assert.equal(
    (await fetch(`${b.web}${INVALIDATION_PATH}`, signedNotification(a.secret))).status,
    401,
  );
  assert.equal(
    (await fetch(`${b.web}${INVALIDATION_PATH}`, signedNotification(b.secret))).status,
    204,
  );

  step("the hero's question to the chat-off Ask page in a browser, with screenshots");
  const browser = spawnSync(
    process.execPath,
    [PLAYWRIGHT_CLI, "test", "--config", "playwright.complete-stack.config.ts"],
    {
      cwd: WEB_ROOT,
      env: { ...process.env, WEB_STACK_URL: b.web, WEB_STACK_PERSON_NAME: seededPerson.name },
      stdio: "inherit",
    },
  );
  assert.equal(browser.status, 0, "the browser checks pass");

  step("no key, password or secret in the logs");
  for (const stack of stacks) {
    const logs = compose(stack, ["logs", "--no-color"]);
    for (const value of [a.key, b.key, stack.password, a.secret, b.secret]) {
      assert.ok(!logs.includes(value), `the logs of stack ${stack.label} contain no credential`);
    }
  }

  process.stdout.write("Website stack smoke check passed.\n");
} catch (error) {
  process.exitCode = 1;
  process.stderr.write(
    `Website stack smoke check failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  for (const stack of stacks) {
    try {
      process.stderr.write(`${compose(stack, ["logs", "--no-color", "migrate", "api", "web"])}\n`);
    } catch {
      // The stack may not exist.
    }
  }
} finally {
  for (const stack of stacks) {
    try {
      compose(stack, ["down", "--volumes", "--remove-orphans", "--rmi", "local"]);
    } catch (error) {
      process.exitCode = 1;
      process.stderr.write(`Removing smoke stack ${stack.label} failed: ${String(error)}\n`);
    }
  }
}
