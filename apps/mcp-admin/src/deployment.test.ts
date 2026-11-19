// The container policy of MCP Admin, validated locally without building or starting an image
// (D22, D23): Compose renders its configuration with the documented example settings, and the
// test reads which networks, settings and published addresses each service gets. The public edge
// in front of the website is phase 10; here it is enough that MCP Admin shares a network with the
// API only (not with the website or Postgres), that nothing reaches it from outside the host's
// loopback interface, and that it holds no database or storage setting.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../", import.meta.url));

interface Port {
  readonly host_ip?: string;
  readonly target: number;
  readonly published?: string;
}
interface Service {
  readonly profiles?: string[];
  readonly environment?: Record<string, string | null>;
  readonly networks?: Record<string, unknown>;
  readonly ports?: Port[];
  readonly volumes?: unknown[];
  readonly build?: { dockerfile?: string };
}
interface Rendered {
  readonly services: Record<string, Service>;
}

let rendered: Rendered;

beforeAll(() => {
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
      env: { PATH: process.env["PATH"] ?? "", HOME: process.env["HOME"] ?? "" },
      encoding: "utf8",
    },
  );
  rendered = JSON.parse(output) as Rendered;
});

function service(name: string): Service {
  const found = rendered.services[name];
  if (!found) throw new Error(`compose.yaml has no service ${name}`);
  return found;
}

const networksOf = (name: string) => Object.keys(service(name).networks ?? {}).sort();
// The host's loopback addresses, from its internal interfaces, so no address is written here.
const loopbackAddresses = new Set(
  Object.values(networkInterfaces())
    .flat()
    .filter((entry) => entry?.internal === true)
    .map((entry) => entry?.address),
);
const loopback = (address: string | undefined) =>
  address !== undefined && loopbackAddresses.has(address);

describe("the MCP Admin container (D22, D23)", () => {
  it("is a service of its own profile, built from its own image", () => {
    const mcp = service("mcp-admin");
    expect(mcp.profiles).toEqual(["mcp-admin"]);
    expect(mcp.build?.dockerfile).toBe("apps/mcp-admin/Dockerfile");
  });

  it("reaches the API by its service name and holds no database or storage setting", () => {
    const environment = service("mcp-admin").environment ?? {};
    const apiContainerPort = service("api").ports?.[0]?.target;
    expect(apiContainerPort).toBeDefined();
    expect(environment["MCP_ADMIN_API_URL"]).toBe(`http://api:${String(apiContainerPort)}`);
    const names = Object.keys(environment);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(name).toMatch(/^MCP_ADMIN_/);
      expect(name).not.toMatch(/DATABASE|POSTGRES|STORAGE|API_KEY|SECRET|PASSWORD/);
    }
    expect(service("mcp-admin").volumes ?? []).toEqual([]);
  });

  it("shares a network with the API only, never with the website or Postgres", () => {
    expect(networksOf("mcp-admin")).toEqual(["admin"]);
    expect(networksOf("postgres")).toEqual(["database"]);
    expect(networksOf("migrate")).toEqual(["database"]);
    expect(networksOf("api")).toEqual(["admin", "content", "database"]);
    expect(networksOf("web")).toEqual(["content"]);
    const others = Object.keys(rendered.services).filter((name) => name !== "mcp-admin");
    for (const name of others) {
      const shared = networksOf(name).filter((network) =>
        networksOf("mcp-admin").includes(network),
      );
      expect(shared, name).toEqual(name === "api" ? ["admin"] : []);
    }
  });

  it("is published on the host's loopback interface only, like the API", () => {
    for (const name of ["mcp-admin", "api"]) {
      const ports = service(name).ports ?? [];
      expect(ports.length, name).toBeGreaterThan(0);
      for (const port of ports)
        expect(loopback(port.host_ip), `${name} ${port.host_ip ?? "every interface"}`).toBe(true);
    }
  });

  it("gives the public website no API key and no MCP Admin setting", () => {
    const environment = service("web").environment ?? {};
    for (const name of Object.keys(environment)) {
      expect(name).not.toMatch(/API_KEY|MCP_ADMIN/);
    }
  });
});

describe("the MCP Admin image", () => {
  const dockerfile = readFileSync(`${root}apps/mcp-admin/Dockerfile`, "utf8");

  it("is built from MCP Admin and the packages it depends on, and runs unprivileged", () => {
    expect(dockerfile).toMatch(/@sebela\/mcp-admin\.\.\./);
    expect(dockerfile).not.toMatch(/packages\/db|packages\/services|@sebela\/db|@sebela\/services/);
    expect(dockerfile).toMatch(/^USER node$/m);
  });

  it("enters the build context through the allowlist, without environment files", () => {
    const ignore = readFileSync(`${root}.dockerignore`, "utf8").split("\n");
    expect(ignore).toContain("!apps/mcp-admin/");
    expect(ignore).toContain("**/.env.*");
  });
});
