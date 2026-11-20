// The container policy of MCP Admin (D22, D23), validated without building or starting an image:
// Compose renders `compose.yaml` with the documented example settings, and the test reads which
// networks, settings and published addresses each service gets, then the image's Dockerfile and
// the build context's allowlist. It reads root files only, so it is a repository check that runs on
// every change (`pnpm ci:root`), not a package test that a root-only change would not select.
//
// The public edge in front of the website is phase 10; here it is enough that MCP Admin shares a
// network with the API only (not with the website or Postgres), that nothing reaches it from
// outside the host's loopback interface, and that it holds no database or storage setting.
// It also checks that the API image's runtime stage carries every workspace package the API runs
// on, read from the manifests, so a new package dependency cannot leave the container unable to
// start.
// Needs the Docker CLI with Compose; no daemon is contacted.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { before, describe, it } from "node:test";

const root = path.join(import.meta.dirname, "..", "..");

/** @type {{ services: Record<string, any> }} */
let rendered;

before(() => {
  // Only the example settings: never this checkout's own environment, so its values cannot appear.
  const output = execFileSync(
    "docker",
    [
      "compose",
      "--file",
      "compose.yaml",
      "--env-file",
      ".env.example",
      "--profile",
      "api",
      "--profile",
      "web",
      "--profile",
      "mcp-admin",
      "config",
      "--format",
      "json",
    ],
    {
      cwd: root,
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
      encoding: "utf8",
    },
  );
  rendered = JSON.parse(output);
});

function service(name) {
  const found = rendered.services[name];
  if (!found) throw new Error(`compose.yaml has no service ${name}`);
  return found;
}

const networksOf = (name) => Object.keys(service(name).networks ?? {}).sort();
// The host's loopback addresses, from its internal interfaces, so no address is written here.
const loopbackAddresses = new Set(
  Object.values(networkInterfaces())
    .flat()
    .filter((entry) => entry?.internal === true)
    .map((entry) => entry?.address),
);
const loopback = (address) => address !== undefined && loopbackAddresses.has(address);

describe("the MCP Admin container (D22, D23)", () => {
  it("is a service of its own profile, built from its own image", () => {
    const mcp = service("mcp-admin");
    assert.deepEqual(mcp.profiles, ["mcp-admin"]);
    assert.equal(mcp.build?.dockerfile, "apps/mcp-admin/Dockerfile");
  });

  it("reaches the API by its service name and holds no database or storage setting", () => {
    const environment = service("mcp-admin").environment ?? {};
    const apiContainerPort = service("api").ports?.[0]?.target;
    assert.notEqual(apiContainerPort, undefined);
    assert.equal(environment.MCP_ADMIN_API_URL, `http://api:${String(apiContainerPort)}`);
    const names = Object.keys(environment);
    assert.ok(names.length > 0);
    for (const name of names) {
      assert.match(name, /^MCP_ADMIN_/);
      assert.doesNotMatch(name, /DATABASE|POSTGRES|STORAGE|API_KEY|SECRET|PASSWORD/);
    }
    assert.deepEqual(service("mcp-admin").volumes ?? [], []);
  });

  it("shares a network with the API only, never with the website or Postgres", () => {
    assert.deepEqual(networksOf("mcp-admin"), ["admin"]);
    assert.deepEqual(networksOf("postgres"), ["database"]);
    assert.deepEqual(networksOf("migrate"), ["database"]);
    assert.deepEqual(networksOf("api"), ["admin", "content", "database"]);
    assert.deepEqual(networksOf("web"), ["content"]);
    const others = Object.keys(rendered.services).filter((name) => name !== "mcp-admin");
    for (const name of others) {
      const shared = networksOf(name).filter((network) =>
        networksOf("mcp-admin").includes(network),
      );
      assert.deepEqual(shared, name === "api" ? ["admin"] : [], name);
    }
  });

  it("is published on the host's loopback interface only, like the API", () => {
    for (const name of ["mcp-admin", "api"]) {
      const ports = service(name).ports ?? [];
      assert.ok(ports.length > 0, name);
      for (const port of ports)
        assert.ok(loopback(port.host_ip), `${name} ${port.host_ip ?? "every interface"}`);
    }
  });

  it("gives the public website no API key and no MCP Admin setting", () => {
    for (const name of Object.keys(service("web").environment ?? {})) {
      assert.doesNotMatch(name, /API_KEY|MCP_ADMIN/);
    }
  });
});

/** The workspace packages an app needs at run time: its `workspace:` dependencies, transitively. */
function runtimeWorkspacePackages(appFolder) {
  const folders = new Map();
  for (const folder of ["apps", "packages"]) {
    for (const entry of readdirSync(path.join(root, folder), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(root, folder, entry.name, "package.json");
      if (!existsSync(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      folders.set(manifest.name, { folder: `${folder}/${entry.name}`, manifest });
    }
  }
  const appName = JSON.parse(readFileSync(path.join(root, appFolder, "package.json"), "utf8")).name;
  const found = new Map();
  const visit = (name) => {
    const workspace = folders.get(name);
    if (!workspace) throw new Error(`No workspace package ${name}`);
    for (const [dependency, range] of Object.entries(workspace.manifest.dependencies ?? {})) {
      if (!String(range).startsWith("workspace:") || found.has(dependency)) continue;
      found.set(dependency, folders.get(dependency)?.folder);
      visit(dependency);
    }
  };
  visit(appName);
  return [...found.values()].sort();
}

describe("the API image", () => {
  const dockerfile = readFileSync(path.join(root, "apps", "api", "Dockerfile"), "utf8");
  const runtime = dockerfile.slice(dockerfile.indexOf("AS runtime"));

  it("carries the manifest and build output of every workspace package the API runs on", () => {
    const packages = runtimeWorkspacePackages("apps/api");
    assert.ok(packages.includes("packages/services"));
    for (const folder of packages) {
      assert.ok(
        runtime.includes(`COPY --from=build /app/${folder}/package.json ${folder}/`),
        `the runtime stage copies ${folder}/package.json`,
      );
      assert.ok(
        runtime.includes(`COPY --from=build /app/${folder}/dist ${folder}/dist`),
        `the runtime stage copies ${folder}/dist`,
      );
    }
  });
});

describe("the MCP Admin image", () => {
  const dockerfile = readFileSync(path.join(root, "apps", "mcp-admin", "Dockerfile"), "utf8");

  it("is built from MCP Admin and the packages it depends on, and runs unprivileged", () => {
    assert.match(dockerfile, /@sebela\/mcp-admin\.\.\./);
    assert.doesNotMatch(
      dockerfile,
      /packages\/db|packages\/services|@sebela\/db|@sebela\/services/,
    );
    assert.match(dockerfile, /^USER node$/m);
  });

  it("enters the build context through the allowlist, without environment files", () => {
    const ignore = readFileSync(path.join(root, ".dockerignore"), "utf8").split("\n");
    assert.ok(ignore.includes("!apps/mcp-admin/"));
    assert.ok(ignore.includes("**/.env.*"));
  });
});
