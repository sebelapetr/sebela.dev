// The whole read path over real sockets: the official SDK client -> MCP Admin -> the real API on a
// temporary database seeded from the fictional S01 fixture. The API keys are ephemeral, named
// fixture keys created on that database; they reach the client's Authorization header only, never
// a tool argument or a model. Covers D01–D04 and D15 against the real authentication.
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { fixtureFolder, revokeKey, startApi } from "../evals/fixture.js";

import { startMcpAdminServer } from "./app.js";
import { readMcpAdminConfig } from "./config.js";
import { toolText } from "./test-support/index.js";

type RunningApi = Awaited<ReturnType<typeof startApi>>;

let api: RunningApi | undefined;
let mcp: { url: string; close: () => Promise<void> } | undefined;
const lines: string[] = [];

beforeAll(async () => {
  api = await startApi({
    seedFolder: fixtureFolder("s01"),
    keyNames: ["owner", "second", "revoked"],
    // Every MCP operation checks its key on a private route; give the test room.
    env: { API_RATE_LIMIT_PRIVATE: "1000/60", API_RATE_LIMIT_KEY: "1000/60" },
  });
  const config = readMcpAdminConfig({
    ...process.env,
    MCP_ADMIN_PORT: "0",
    MCP_ADMIN_API_URL: api.url,
  });
  mcp = await startMcpAdminServer({ config, log: (line) => lines.push(line) });
});

afterAll(async () => {
  // beforeAll may have failed part-way: whatever started is stopped, the API (and its temporary
  // database) always.
  try {
    await mcp?.close();
  } finally {
    await api?.stop();
  }
});

function running() {
  if (!api || !mcp) throw new Error("The fixture did not start.");
  return { api, mcp };
}

function keyOf(name: string): string {
  const entry = running().api.keys[name];
  if (!entry) throw new Error(`No fixture key named ${name}`);
  return entry.key;
}

async function connect(key: string | null): Promise<Client> {
  const client = new Client({ name: "mcp-admin-e2e", version: "0.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${running().mcp.url}/mcp`), {
      requestInit: key === null ? {} : { headers: { Authorization: `Bearer ${key}` } },
    }),
  );
  return client;
}

describe("the authenticated read path", () => {
  it("refuses a client without a key, or with an unknown one, before discovery", async () => {
    await expect(connect(null)).rejects.toThrow();
    await expect(connect(`sebela_${"0".repeat(16)}_${"Z".repeat(43)}`)).rejects.toThrow();
  });

  it("lists the content tools and reads the fixture's person", async () => {
    const client = await connect(keyOf("owner"));

    const { tools } = await client.listTools();
    const result = await client.callTool({ name: "get", arguments: { entity: "person" } });
    await client.close();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "delete",
      "describe",
      "get",
      "list",
      "recent_changes",
      "save",
      "upload",
    ]);
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(toolText(result))).toMatchObject({ name: "Mira Tolland" });
  });

  it("describes the project contract", async () => {
    const client = await connect(keyOf("second"));

    const result = await client.callTool({ name: "describe", arguments: { entity: "project" } });
    await client.close();

    expect(result.isError).not.toBe(true);
    const description = JSON.parse(toolText(result)) as {
      entity: string;
      relationships: unknown[];
    };
    expect(description.entity).toBe("project");
    expect(description.relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "experience", target: "experience" }),
        expect.objectContaining({ field: "technologies", target: "technology" }),
      ]),
    );
  });

  it("serves two keys at once", async () => {
    const [first, second] = await Promise.all([connect(keyOf("owner")), connect(keyOf("second"))]);

    const results = await Promise.all([
      first.callTool({ name: "get", arguments: { entity: "person" } }),
      second.callTool({ name: "get", arguments: { entity: "person" } }),
    ]);
    await Promise.all([first.close(), second.close()]);

    for (const result of results) expect(result.isError).not.toBe(true);
  });

  it("refuses the next operation on an open connection once the key is revoked", async () => {
    const client = await connect(keyOf("revoked"));
    await client.listTools();

    await revokeKey(running().api, "revoked");

    await expect(
      client.callTool({ name: "get", arguments: { entity: "person" } }),
    ).rejects.toThrow();
    await client.close();
  });

  it("keeps every fixture key out of the log", () => {
    expect(lines.length).toBeGreaterThan(0);
    for (const name of ["owner", "second", "revoked"]) {
      const secret = keyOf(name).split("_")[2] ?? keyOf(name);
      for (const line of lines) expect(line).not.toContain(secret);
    }
  });
});
