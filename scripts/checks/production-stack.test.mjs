// The production composition's policy (infra/README.md, docs/release-workflow.md), validated
// without pulling or starting an image: Compose renders the root compose.yaml with
// infra/production/compose.yaml and the documented production example settings only, and the test
// reads each service's image, published ports, restart policy, logging and health check, the
// analytics switch, the example settings themselves and the images' Dockerfiles. Starting the
// composition from the built images is `production-stack.e2e.mjs` (the `production-stack` CI job).
// Reads root files only, so it is a repository check (`pnpm ci:root`). Needs the Docker CLI with
// Compose; no daemon is contacted.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { parseEnv } from "node:util";

const root = path.join(import.meta.dirname, "..", "..");
const BASE_FILE = "compose.yaml";
const PRODUCTION_FILE = path.join("infra", "production", "compose.yaml");
const EXAMPLE_FILE = path.join("infra", "production", ".env.example");
const REGISTRY = "ghcr.io/sebelapetr";
const SERVICES = ["api", "mcp-admin", "migrate", "postgres", "web"];
const LONG_RUNNING = ["api", "mcp-admin", "postgres", "web"];
// Settings of the root file that only name a host port the production composition removes.
const NOT_PRODUCTION_SETTINGS = new Set([
  "API_HOST",
  "API_PORT",
  "MCP_ADMIN_HOST",
  "MCP_ADMIN_PORT",
]);

const exampleText = readFileSync(path.join(root, EXAMPLE_FILE), "utf8");
const example = parseEnv(exampleText);

/** The composition as Compose renders it from the example settings and the given overrides. */
function render(overrides = {}) {
  const output = execFileSync(
    "docker",
    [
      "compose",
      "--project-directory",
      root,
      "--file",
      BASE_FILE,
      "--file",
      PRODUCTION_FILE,
      "--env-file",
      EXAMPLE_FILE,
      "config",
      "--format",
      "json",
    ],
    {
      cwd: root,
      // Only the example settings: never this checkout's own environment.
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...overrides },
      encoding: "utf8",
    },
  );
  return JSON.parse(output);
}

const rendered = render();
const service = (name, config = rendered) => {
  const found = config.services[name];
  if (!found) throw new Error(`the production composition has no service ${name}`);
  return found;
};

const loopbackAddresses = new Set(
  Object.values(networkInterfaces())
    .flat()
    .filter((entry) => entry?.internal === true)
    .map((entry) => entry?.address),
);

/** The names a Compose file interpolates (`${NAME...}`), not its escaped `$${...}`. */
function interpolated(file) {
  const text = readFileSync(path.join(root, file), "utf8");
  return [...text.matchAll(/(?<!\$)\$\{([A-Z][A-Z0-9_]*)/g)].map((match) => match[1]);
}

describe("the production composition", () => {
  it("runs as its own Compose project, never the development stack's `sebela`", () => {
    // The root compose.yaml names its project `sebela`, the stack every development checkout and
    // worktree shares; production on the same host must not adopt its containers or volume.
    assert.equal(render().name, "sebela-production");
  });

  it("starts every service without a profile", () => {
    assert.deepEqual(Object.keys(rendered.services).sort(), SERVICES);
    for (const name of SERVICES) assert.deepEqual(service(name).profiles ?? [], [], name);
  });

  it("runs the published images by a tag per service and builds nothing", () => {
    const config = render({
      API_IMAGE_TAG: "tag-api",
      WEB_IMAGE_TAG: "tag-web",
      MCP_ADMIN_IMAGE_TAG: "tag-mcp",
    });
    assert.equal(service("api", config).image, `${REGISTRY}/sebela-api:tag-api`);
    assert.equal(service("migrate", config).image, `${REGISTRY}/sebela-api:tag-api`);
    assert.equal(service("web", config).image, `${REGISTRY}/sebela-web:tag-web`);
    assert.equal(service("mcp-admin", config).image, `${REGISTRY}/sebela-mcp-admin:tag-mcp`);
    for (const name of SERVICES) assert.equal(service(name).build, undefined, name);
  });

  it("publishes only the website, on the host's loopback interface", () => {
    for (const name of SERVICES.filter((entry) => entry !== "web")) {
      assert.deepEqual(service(name).ports ?? [], [], `${name} has no host port`);
    }
    const ports = service("web").ports ?? [];
    assert.equal(ports.length, 1);
    assert.ok(loopbackAddresses.has(ports[0].host_ip), `web on ${String(ports[0].host_ip)}`);
    assert.equal(ports[0].published, example.WEB_PORT);
  });

  it("restarts long-running services unless stopped and runs the migration once", () => {
    for (const name of LONG_RUNNING) assert.equal(service(name).restart, "unless-stopped", name);
    assert.equal(service("migrate").restart, "no");
    assert.deepEqual(service("migrate").command, ["node", "/app/packages/db/dist/cli/migrate.js"]);
    assert.equal(service("api").depends_on?.migrate?.condition, "service_completed_successfully");
  });

  it("rotates every container's json-file logs", () => {
    for (const name of SERVICES) {
      const logging = service(name).logging;
      assert.equal(logging?.driver, "json-file", name);
      assert.match(logging?.options?.["max-size"] ?? "", /^\d+[km]$/, name);
      assert.match(logging?.options?.["max-file"] ?? "", /^\d+$/, name);
    }
  });

  it("keeps a health check on every long-running service", () => {
    for (const name of LONG_RUNNING) assert.ok(service(name).healthcheck?.test, name);
  });

  it("leaves analytics off by default and passes the website's analytics settings through", () => {
    const environment = service("web").environment ?? {};
    assert.equal(environment.WEB_ANALYTICS_WEBSITE_ID ?? "", "");
    assert.equal(environment.WEB_ANALYTICS_SCRIPT_URL ?? "", "");
    const script = "https://analytics.example.test/script.js";
    const id = "00000000-0000-4000-8000-000000000000";
    const on = render({ WEB_ANALYTICS_SCRIPT_URL: script, WEB_ANALYTICS_WEBSITE_ID: id });
    assert.equal(service("web", on).environment?.WEB_ANALYTICS_SCRIPT_URL, script);
    assert.equal(service("web", on).environment?.WEB_ANALYTICS_WEBSITE_ID, id);
  });

  it("keeps the site noindex unless WEB_INDEXING is switched on", () => {
    assert.equal(service("web").environment?.WEB_INDEXING ?? "", "");
    const on = render({ WEB_INDEXING: "on" });
    assert.equal(service("web", on).environment?.WEB_INDEXING, "on");
  });
});

describe("the production example settings", () => {
  it("document every setting the composition reads", () => {
    const names = new Set([...interpolated(BASE_FILE), ...interpolated(PRODUCTION_FILE)]);
    const missing = [...names].filter(
      (name) => !NOT_PRODUCTION_SETTINGS.has(name) && !(name in example),
    );
    assert.deepEqual(missing, []);
    for (const name of NOT_PRODUCTION_SETTINGS) assert.ok(!(name in example), name);
  });

  it("hold placeholders, never a credential", () => {
    for (const [name, value] of Object.entries(example)) {
      if (/(?:PASSWORD|SECRET|API_KEY|TOKEN|IMAGE_TAG)$/.test(name)) {
        assert.match(value, /^(?:|replace-with-[a-z0-9-]+)$/, name);
      }
    }
    assert.equal(example.STORAGE_ENVIRONMENT, "production");
    assert.equal(example.WEB_INDEXING, "");
    assert.equal(example.WEB_ANALYTICS_SCRIPT_URL, "");
    assert.equal(example.WEB_ANALYTICS_WEBSITE_ID, "");
  });

  it("describe each group of settings with a comment", () => {
    const lines = exampleText.split("\n");
    lines.forEach((line, index) => {
      if (!/^[A-Z]/.test(line)) return;
      const before = lines.slice(0, index).reverse();
      const group = before.findIndex((entry) => !/^[A-Z]/.test(entry));
      assert.match(before[group] ?? "", /^# /, `${line.split("=")[0]} follows a comment`);
    });
  });
});

describe("the production images", () => {
  const dockerfile = (app) => readFileSync(path.join(root, "apps", app, "Dockerfile"), "utf8");

  it("run unprivileged with a health check", () => {
    for (const [app, route] of [
      ["api", "/health"],
      ["web", "/robots.txt"],
      ["mcp-admin", "/health"],
    ]) {
      const text = dockerfile(app);
      assert.match(text, /^USER node$/m, app);
      const healthcheck = /^HEALTHCHECK [^\n]*\\\n\s+CMD \[([^\n]*)\]$/m.exec(text)?.[1] ?? "";
      assert.ok(healthcheck.includes(`\\"${route}\\"`), `${app} checks ${route}`);
    }
  });

  it("take only the fictional demo seed from the build context", () => {
    const ignore = readFileSync(path.join(root, ".dockerignore"), "utf8").split("\n");
    assert.ok(ignore.includes("packages/db/seed/*"));
    const admitted = ignore.filter((line) => line.startsWith("!packages/db/seed/"));
    assert.deepEqual(admitted.sort(), ["!packages/db/seed/README.md", "!packages/db/seed/demo/"]);
  });
});
