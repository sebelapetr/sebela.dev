#!/usr/bin/env node
// Smoke check of the production composition (infra/README.md, docs/testing.md "CI"): the root
// compose.yaml with infra/production/compose.yaml, started from built images with the fictional
// demo seed.
//
//   node scripts/checks/production-stack.e2e.mjs [--images] [--browser]
//
// --images: verify images that already exist locally instead of building them, by the tags in
//   API_IMAGE_TAG, WEB_IMAGE_TAG and MCP_ADMIN_IMAGE_TAG (the release workflow, which pushes only
//   images that passed). They are kept at the end.
// --browser: also run the complete-stack browser tests of apps/web against the website (needs the
//   website's installed dependencies with Chromium; screenshots in
//   apps/web/test-results/complete-stack/).
//
// Needs Docker with Compose, `tar` and `openssl`; plain Node with no dependencies. It builds the API, website
// and MCP Admin images under the GHCR names the composition runs, with a tag of this run (or takes
// the given ones, --images), and:
//
// - checks them with the image-content check (scripts/checks/image-content.mjs), which must pass on
//   them and refuse its fixture image (scripts/checks/fixtures/image-content/);
// - starts the composition in a disposable Compose project from the documented production example
//   settings (infra/production/.env.example) with only what a test run must replace: those image
//   tags, random passwords and secrets, local storage instead of Bunny, the website on a free
//   loopback port;
// - loads the demo seed and checks that Postgres, the API, the website and MCP Admin are healthy,
//   that the migration finished, that only the website and MCP Admin publish a port, only on the loopback
//   interface, and that pages show the seed with `noindex` and without the analytics script;
// - runs the reference reverse-proxy configuration (infra/nginx/sebela.dev.conf) in a throwaway nginx
//   container in front of the website, with a self-signed certificate, and checks its shared-cache
//   rule: a page answered 200 gets the public rule, while a 404, a client navigation, Ask and the
//   health route never get it and keep the website's own header;
// - with --browser, the hero's question to the mock Ask page in a browser (no model is called);
// - checks that the website's /health reports the database failing when Postgres is stopped and the
//   API failing when the API is stopped;
// - checks that no password or secret is in the logs.
//
// It removes the project, its containers, volumes and the images it built at the end, also when a
// step fails. Exits with 1 when a step fails.

import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs";
import net from "node:net";
import os, { networkInterfaces } from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";

const CHECKOUT_ROOT = path.join(import.meta.dirname, "..", "..");
const PRODUCTION_FILE = path.join(CHECKOUT_ROOT, "infra", "production", "compose.yaml");
const EXAMPLE_FILE = path.join(CHECKOUT_ROOT, "infra", "production", ".env.example");
const IMAGE_CHECK = path.join(CHECKOUT_ROOT, "scripts", "checks", "image-content.mjs");
const FIXTURE = path.join(CHECKOUT_ROOT, "scripts", "checks", "fixtures", "image-content");
const DEMO_SEED = path.join(CHECKOUT_ROOT, "packages", "db", "seed", "demo");
const WEB_ROOT = path.join(CHECKOUT_ROOT, "apps", "web");
const PLAYWRIGHT_CLI = path.join(WEB_ROOT, "node_modules", "@playwright", "test", "cli.js");
const REGISTRY = "ghcr.io/sebelapetr";
const APPS = ["api", "web", "mcp-admin"];
const HEALTHY_SERVICES = ["api", "mcp-admin", "postgres", "web"];
const PROXY_FILE = path.join(CHECKOUT_ROOT, "infra", "nginx", "sebela.dev.conf");
const PROXY_IMAGE =
  "nginx:1.28-alpine@sha256:a8b39bd9cf0f83869a2162827a0caf6137ddf759d50a171451b335cecc87d236";
/** The shared-cache rule of public pages and documents (apps/web/AGENTS.md, Caching and invalidation). */
const PUBLIC_RULE =
  "public, max-age=0, s-maxage=60, stale-while-revalidate=60, stale-if-error=86400";

const example = parseEnv(fs.readFileSync(EXAMPLE_FILE, "utf8"));
const seededPerson = JSON.parse(fs.readFileSync(path.join(DEMO_SEED, "person.json"), "utf8"));
const GIVEN_IMAGES = process.argv.includes("--images");
const BROWSER = process.argv.includes("--browser");
const TAG_VARIABLES = {
  api: "API_IMAGE_TAG",
  web: "WEB_IMAGE_TAG",
  "mcp-admin": "MCP_ADMIN_IMAGE_TAG",
};
const tag = `smoke-${String(process.pid)}`;
const tags = Object.fromEntries(
  APPS.map((app) => {
    if (!GIVEN_IMAGES) return [app, tag];
    const given = process.env[TAG_VARIABLES[app]] ?? "";
    if (!/^[\w][\w.-]{0,127}$/.test(given)) {
      throw new Error(`--images needs an image tag in ${TAG_VARIABLES[app]}`);
    }
    return [app, given];
  }),
);
const images = Object.fromEntries(
  APPS.map((app) => [app, `${REGISTRY}/sebela-${app}:${tags[app]}`]),
);
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
const adminPort = String(await freePort(example.MCP_ADMIN_HOST));
const web = `http://${example.WEB_HOST}:${webPort}`;

// Compose reads the production example (`--env-file`); these process variables take precedence.
const env = {
  ...process.env,
  COMPOSE_PROJECT_NAME: `sebela-production-smoke-${String(process.pid)}`,
  API_IMAGE_TAG: tags.api,
  WEB_IMAGE_TAG: tags.web,
  MCP_ADMIN_IMAGE_TAG: tags["mcp-admin"],
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
  MCP_ADMIN_PORT: adminPort,
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

/** An error's message with its cause, which carries the reason of a failed `fetch`. */
function describe(error) {
  if (!(error instanceof Error)) return String(error);
  const { cause } = error;
  if (!(cause instanceof Error)) return error.message;
  const code = "code" in cause ? ` ${String(cause.code)}` : "";
  return `${error.message} (${cause.name}: ${cause.message}${code})`;
}

async function health() {
  const response = await fetch(`${web}/health`, { signal: AbortSignal.timeout(10_000) });
  return { status: response.status, body: await response.json() };
}

/**
 * Starts the reference reverse-proxy configuration in a throwaway nginx container that shares the
 * website container's network, so the configuration's loopback upstream is the website. Only its
 * placeholders change: the website's port inside its container, and a self-signed certificate and
 * an empty edge-address include mounted at the paths the configuration names. Returns a function
 * that requests a path through the proxy's TLS site and gives the status and headers.
 */
function startReverseProxy(folder, webContainer, webContainerPort) {
  const reference = fs.readFileSync(PROXY_FILE, "utf8");
  const one = (pattern) => {
    const match = pattern.exec(reference);
    assert.ok(match, `the reverse-proxy configuration has ${String(pattern)}`);
    return match[1];
  };
  const certificate = one(/^\s*ssl_certificate\s+(\S+);/mu);
  const certificateKey = one(/^\s*ssl_certificate_key\s+(\S+);/mu);
  const upstreamAddress = one(/^\s*server\s+(\S+):replace-with-the-web-port;/mu);
  const siteName = [...reference.matchAll(/^\s*server_name\s+(\S+);/gmu)].at(-1)?.[1];
  assert.ok(siteName, "the reverse-proxy configuration names its site");
  const mounts = [
    [path.join(folder, "site.conf"), "/etc/nginx/conf.d/default.conf"],
    [path.join(folder, "certificate.pem"), certificate],
    [path.join(folder, "certificate-key.pem"), certificateKey],
    ...[...reference.matchAll(/^\s*include\s+(\S+);/gmu)].map((match, index) => [
      path.join(folder, `include-${String(index)}.conf`),
      match[1],
    ]),
  ];
  fs.writeFileSync(
    mounts[0][0],
    reference.replaceAll("replace-with-the-web-port", webContainerPort),
  );
  for (const [file] of mounts.slice(3)) fs.writeFileSync(file, "");
  run("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "1",
    "-subj",
    `/CN=${siteName}`,
    "-keyout",
    mounts[2][0],
    "-out",
    mounts[1][0],
  ]);
  const name = `${env.COMPOSE_PROJECT_NAME}-reverse-proxy`;
  run("docker", [
    "run",
    "--detach",
    "--rm",
    "--name",
    name,
    "--network",
    `container:${webContainer}`,
    ...mounts.flatMap(([source, target]) => ["--volume", `${source}:${target}:ro`]),
    PROXY_IMAGE,
  ]);
  const request = (pathname, curlOptions = []) => {
    const output = run("docker", [
      "exec",
      name,
      "curl",
      "--silent",
      "--insecure",
      "--output",
      "/dev/null",
      "--dump-header",
      "-",
      "--connect-to",
      `${siteName}::${upstreamAddress}:`,
      ...curlOptions,
      `https://${siteName}${pathname}`,
    ]);
    const [statusLine = "", ...lines] = output.split(/\r?\n/u);
    const headers = new Map();
    for (const line of lines) {
      const separator = line.indexOf(":");
      if (separator > 0) {
        const header = line.slice(0, separator).trim().toLowerCase();
        const value = line.slice(separator + 1).trim();
        headers.set(header, headers.has(header) ? `${headers.get(header)}, ${value}` : value);
      }
    }
    return { status: Number(statusLine.split(" ")[1]), headers };
  };
  const stop = () => spawnSync("docker", ["rm", "--force", name], { stdio: "ignore" });
  return { request, stop };
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
  if (GIVEN_IMAGES) {
    step(`the given images: ${Object.values(images).join(", ")}`);
    for (const image of Object.values(images)) run("docker", ["image", "inspect", image]);
  } else {
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

  step(
    "every service is healthy, the migration finished, only the website and MCP Admin are on loopback",
  );
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
    const expected = { web: webPort, "mcp-admin": adminPort }[String(container.Service)];
    if (expected === undefined) {
      assert.deepEqual(published, [], `${String(container.Service)} publishes no port`);
      continue;
    }
    assert.ok(published.length > 0, `${String(container.Service)} is published`);
    for (const entry of published) {
      assert.ok(
        loopbackAddresses.has(entry.URL),
        `${String(container.Service)} is on ${String(entry.URL)}`,
      );
      assert.equal(String(entry.PublishedPort), expected);
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

  step("the reference reverse proxy gives pages the shared-cache rule and nothing else");
  const proxyFolder = fs.mkdtempSync(path.join(os.tmpdir(), "sebela-reverse-proxy-"));
  const webContainer = containers().find((entry) => entry.Service === "web")?.ID;
  assert.ok(webContainer, "the website container is listed");
  const webContainerPort = JSON.parse(compose(["config", "--format", "json"])).services.web
    .environment.WEB_PORT;
  const proxy = startReverseProxy(proxyFolder, webContainer, String(webContainerPort));
  try {
    await waitFor(() => {
      try {
        return proxy.request("/health").status === 200;
      } catch {
        return false;
      }
    }, "the reverse proxy did not answer");
    const expectations = [
      // [what, path, curl options, status (null: whatever the website answers), public rule]
      ["a page", "/", [], 200, true],
      ["another page, HEAD", "/experience", ["--head"], 200, true],
      ["a client navigation", "/experience", ["--header", "RSC: 1"], null, false],
      [
        "a prefetch",
        "/experience",
        ["--header", "RSC: 1", "--header", "Next-Router-Prefetch: 1"],
        200,
        false,
      ],
      ["a navigation payload by argument", "/experience?_rsc=smoke", [], null, false],
      ["a missing page", "/no-such-page", [], 404, false],
      ["Ask", "/ask", [], 200, false],
      ["the health route", "/health", [], 200, false],
    ];
    for (const [what, pathname, options, status, isPublic] of expectations) {
      const answer = proxy.request(pathname, options);
      const cacheControl = answer.headers.get("cache-control") ?? "";
      if (status !== null) {
        assert.equal(answer.status, status, `${what} (${pathname}) answers ${String(status)}`);
      }
      if (isPublic) {
        assert.equal(cacheControl, PUBLIC_RULE, `${what} gets the public rule`);
      } else {
        // Never the public rule. Next may redirect a navigation without a matching `_rsc` value,
        // and a redirect carries whatever the website sends; an answer with content is no-store.
        assert.notEqual(cacheControl, PUBLIC_RULE, `${what} (${pathname}) gets no public rule`);
        if (answer.status === 200) {
          assert.match(
            cacheControl,
            /\bno-store\b/u,
            `${what} (${pathname}) keeps the website's no-store, got "${cacheControl}"`,
          );
        }
      }
      assert.equal(
        answer.headers.get("x-frame-options"),
        "DENY",
        `${what} keeps the security headers`,
      );
    }
    const robots = proxy.request("/robots.txt");
    assert.equal(robots.headers.get("cache-control"), PUBLIC_RULE, "robots.txt keeps its own rule");
    assert.equal(
      proxy.request("/internal/invalidation").status,
      404,
      "the internal route is closed",
    );
  } finally {
    proxy.stop();
    fs.rmSync(proxyFolder, { recursive: true, force: true });
  }

  if (BROWSER) {
    step("the hero's question to the mock Ask page in a browser, with screenshots");
    // Asynchronously: a blocked event loop would miss the website closing this process's idle
    // keep-alive connections meanwhile, and the next request would go out on a closed socket.
    const browser = spawn(
      process.execPath,
      [PLAYWRIGHT_CLI, "test", "--config", "playwright.complete-stack.config.ts"],
      {
        cwd: WEB_ROOT,
        env: { ...process.env, WEB_STACK_URL: web, WEB_STACK_PERSON_NAME: seededPerson.name },
        stdio: "inherit",
      },
    );
    const [status] = await once(browser, "exit");
    assert.equal(status, 0, "the browser checks pass");
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
  process.stderr.write(`Production stack smoke check failed: ${describe(error)}\n`);
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
  for (const image of [...(GIVEN_IMAGES ? [] : Object.values(images)), fixtureImage]) {
    spawnSync("docker", ["image", "rm", "--force", image], { stdio: "ignore" });
  }
}
