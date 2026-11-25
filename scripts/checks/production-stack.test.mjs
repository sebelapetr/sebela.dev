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
const NOT_PRODUCTION_SETTINGS = new Set(["API_HOST", "API_PORT"]);

const exampleText = readFileSync(path.join(root, EXAMPLE_FILE), "utf8");
const example = parseEnv(exampleText);

/**
 * The composition as Compose renders it from the example settings and the given overrides, with the
 * given profiles active.
 */
function render(overrides = {}, profiles = []) {
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
      ...profiles.flatMap((profile) => ["--profile", profile]),
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

  it("publishes only the website and MCP Admin, each on the host's loopback interface", () => {
    // The website for the server's nginx; MCP Admin only as the target of the owner's SSH tunnel.
    for (const name of SERVICES.filter((entry) => entry !== "web" && entry !== "mcp-admin")) {
      assert.deepEqual(service(name).ports ?? [], [], `${name} has no host port`);
    }
    const admin = service("mcp-admin").ports ?? [];
    assert.equal(admin.length, 1, "MCP Admin has one host port");
    assert.ok(loopbackAddresses.has(admin[0].host_ip), `mcp-admin on ${String(admin[0].host_ip)}`);
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

/** A Compose duration such as `1m15s` in seconds. */
function seconds(duration) {
  const units = { h: 3600, m: 60, s: 1 };
  const parts = [...String(duration ?? "").matchAll(/(\d+)([hms])/g)];
  return parts.reduce((total, [, amount, unit]) => total + Number(amount) * units[unit], 0);
}

describe("the production AI service (issue #210)", () => {
  // Behind its profile, the chat's switch: a deployment neither pulls nor starts it while the
  // environment file does not activate it.
  const withAi = render({ AI_SERVICE_IMAGE_TAG: "tag-ai" }, ["ai-service"]);
  /** @type {Record<string, any>} */
  const ai = withAi.services["ai-service"] ?? {};

  it("is not part of a start without its profile", () => {
    assert.equal(rendered.services["ai-service"], undefined);
    assert.deepEqual(ai.profiles, ["ai-service"]);
  });

  it("runs its published image by its own tag and builds nothing", () => {
    assert.equal(ai.image, `${REGISTRY}/sebela-ai-service:tag-ai`);
    assert.equal(ai.build, undefined);
  });

  it("publishes no port and shares only the chat network with the API", () => {
    assert.deepEqual(ai.ports ?? [], []);
    assert.deepEqual(Object.keys(ai.networks ?? {}), ["chat"]);
    assert.ok("chat" in (service("api", withAi).networks ?? {}));
  });

  it("restarts unless stopped, rotates its logs, checks its health and stops gracefully", () => {
    assert.equal(ai.restart, "unless-stopped");
    assert.equal(ai.logging?.driver, "json-file");
    assert.match(ai.logging?.options?.["max-size"] ?? "", /^\d+[km]$/);
    assert.ok(ai.healthcheck?.test);
    assert.ok(seconds(ai.stop_grace_period) >= 75);
  });

  it("runs the fictional model with the example settings", () => {
    assert.equal(ai.environment?.AI_SERVICE_MODEL ?? "", "");
    assert.equal(ai.environment?.AI_SERVICE_ALLOW_PAID ?? "", "");
  });

  it("is told the production environment, in which it refuses the fictional model", () => {
    assert.equal(ai.environment?.AI_SERVICE_ENVIRONMENT, "production");
    assert.equal(ai.environment?.AI_SERVICE_ENVIRONMENT, example.STORAGE_ENVIRONMENT);
  });

  it("is switched on only by its profile in the environment file, which the example leaves empty", () => {
    assert.equal(example.COMPOSE_PROFILES, "");
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

  it("hold no setting the composition does not pass", () => {
    assert.ok(!("AI_SERVICE_TRACE_DETECTOR_DIR" in example));
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
    const ai = dockerfile("ai-service");
    assert.match(ai, /^USER app$/m);
    const healthcheck = /^HEALTHCHECK [^\n]*\\\n\s+CMD \[([^\n]*)\]$/m.exec(ai)?.[1] ?? "";
    assert.ok(healthcheck.includes('\\"/health\\"'), "ai-service checks /health");
  });

  it("take only the fictional demo seed from the build context", () => {
    const ignore = readFileSync(path.join(root, ".dockerignore"), "utf8").split("\n");
    assert.ok(ignore.includes("packages/db/seed/*"));
    const admitted = ignore.filter((line) => line.startsWith("!packages/db/seed/"));
    assert.deepEqual(admitted.sort(), ["!packages/db/seed/README.md", "!packages/db/seed/demo/"]);
  });
});
