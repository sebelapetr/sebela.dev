// The content-management path over real sockets: the official SDK client -> MCP Admin -> the real
// API on a temporary database seeded from the fictional S02 fixture. Covers D18 (the API's audit
// names the verified key and the tool's provenance, with before and after) and the API's own
// dependency protection on a delete (D21).
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { fixtureFolder, startApi } from "../evals/fixture.js";

import { startMcpAdminServer } from "./app.js";
import { readMcpAdminConfig } from "./config.js";
import { toolText } from "./test-support/index.js";

type RunningApi = Awaited<ReturnType<typeof startApi>>;

let api: RunningApi | undefined;
let mcp: { url: string; close: () => Promise<void> } | undefined;

beforeAll(async () => {
  api = await startApi({
    seedFolder: fixtureFolder("s02"),
    keyNames: ["owner"],
    env: { API_RATE_LIMIT_PRIVATE: "1000/60", API_RATE_LIMIT_KEY: "1000/60" },
  });
  const config = readMcpAdminConfig({
    ...process.env,
    MCP_ADMIN_PORT: "0",
    MCP_ADMIN_API_URL: api.url,
  });
  mcp = await startMcpAdminServer({ config, log: () => undefined });
});

afterAll(async () => {
  try {
    await mcp?.close();
  } finally {
    await api?.stop();
  }
});

async function connect(): Promise<Client> {
  const owner = api?.keys["owner"];
  if (!api || !mcp || !owner) throw new Error("The fixture did not start.");
  const client = new Client({ name: "mcp-admin-e2e", version: "0.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${mcp.url}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${owner.key}` } },
    }),
  );
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  return { isError: result.isError === true, json: JSON.parse(toolText(result)) as unknown };
}

describe("content management against the real API", () => {
  it("audits a profile change with the verified key, the tool's provenance and before/after", async () => {
    const client = await connect();
    const before = (await call(client, "get", { entity: "person" })).json as { headline: string };

    const saved = await call(client, "save", {
      entity: "person",
      action: "update",
      fields: { headline: "Software engineer" },
    });
    const recent = await call(client, "recent_changes", {});
    await client.close();

    expect(saved.isError).toBe(false);
    expect(saved.json).toMatchObject({
      entity: "person",
      action: "updated",
      record: { headline: "Software engineer" },
    });
    const { changes } = recent.json as {
      changes: {
        actor: { keyName: string };
        provenance: string | null;
        entity: string;
        action: string;
        before: { headline?: string } | null;
        after: { headline?: string } | null;
      }[];
    };
    expect(changes[0]).toMatchObject({
      actor: { keyName: "owner" },
      entity: "person",
      action: "updated",
      before: { headline: before.headline },
      after: { headline: "Software engineer" },
    });
    expect(changes[0]?.provenance).toMatch(/^mcp-admin\/save\/[0-9a-f]{12}$/);
  });

  it("leaves a project others depend on in place and reports why", async () => {
    const client = await connect();

    const refused = await call(client, "delete", { entity: "project", id: "cedar-portal-billing" });
    const still = await call(client, "get", { entity: "project", id: "cedar-portal-billing" });
    await client.close();

    expect(refused.isError).toBe(true);
    expect(refused.json).toMatchObject({ error: { code: "conflict" } });
    expect((refused.json as { error: { message: string } }).error.message).toContain(
      "cedar-portal-billing",
    );
    expect(still.isError).toBe(false);
  });
});
