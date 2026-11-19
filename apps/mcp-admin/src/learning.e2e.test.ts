// The learning task tools over real sockets: the official SDK client -> MCP Admin -> the generated
// API client -> the real API on a temporary database seeded from the fictional S03 fixture. Covers
// the session action end to end: a session appended to a day's earlier notes, a midnight split, a
// book's reading on its linked resource, a refused overlap that writes nothing, an event whose
// dates add no time, and the audit naming the tool's session provenance.
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { fixtureFolder, startApi } from "../evals/fixture.js";

import { startMcpAdminServer } from "./app.js";
import { readMcpAdminConfig } from "./config.js";
import { toolText } from "./test-support/index.js";

type RunningApi = Awaited<ReturnType<typeof startApi>>;

interface DiaryDay {
  date: string;
  notes: string | null;
  entries: { resource: { slug: string } | null; event: { slug: string } | null }[];
  events: { slug: string }[];
  totalSeconds: number;
}

let api: RunningApi | undefined;
let mcp: { url: string; close: () => Promise<void> } | undefined;

beforeAll(async () => {
  api = await startApi({
    seedFolder: fixtureFolder("s03"),
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
  const client = new Client({ name: "mcp-admin-learning-e2e", version: "0.0.0" });
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

async function day(client: Client, date: string): Promise<DiaryDay> {
  return (await call(client, "get", { entity: "roadmap-diary", id: date })).json as DiaryDay;
}

describe("learning tasks against the real API", () => {
  it("appends a session's notes to the day's earlier notes and audits it as a session", async () => {
    const client = await connect();

    const logged = await call(client, "log_session", {
      resource: "python-async-lab",
      startedAt: "2026-11-16T14:00:00+01:00",
      endedAt: "2026-11-16T15:30:00+01:00",
      notes: "Cancelled a task group cleanly.",
    });
    const stored = await day(client, "2026-11-16");
    const recent = await call(client, "recent_changes", {});
    await client.close();

    expect(logged).toEqual({ isError: false, json: { dates: ["2026-11-16"] } });
    expect(stored.notes).toContain("one event loop per thread");
    expect(stored.notes).toContain("Cancelled a task group cleanly.");
    expect(stored.totalSeconds).toBe(3600 + 5400);
    const { changes } = recent.json as {
      changes: { entity: string; provenance: string | null; actor: { keyName: string } }[];
    };
    expect(changes[0]).toMatchObject({ entity: "roadmap-diary", actor: { keyName: "owner" } });
    expect(changes[0]?.provenance).toMatch(/^mcp-admin\/session\/[0-9a-f]{12}$/);
  });

  it("splits a session at Prague midnight and logs a book on its linked resource", async () => {
    const client = await connect();

    const logged = await call(client, "log_session", {
      book: "harbor-patterns",
      startedAt: "2026-11-18T23:30:00+01:00",
      endedAt: "2026-11-19T00:45:00+01:00",
    });
    const first = await day(client, "2026-11-18");
    const second = await day(client, "2026-11-19");
    await client.close();

    expect(logged.json).toEqual({ dates: ["2026-11-18", "2026-11-19"] });
    expect(first.totalSeconds).toBe(1800);
    expect(second.totalSeconds).toBe(2700);
    expect(first.entries[0]?.resource?.slug).toBe("harbor-patterns-book");
  });

  it("refuses an overlapping session and writes none of it", async () => {
    const client = await connect();

    const refused = await call(client, "log_session", {
      resource: "python-async-intro",
      startedAt: "2026-11-16T10:30:00+01:00",
      endedAt: "2026-11-16T11:30:00+01:00",
      notes: "Never stored.",
    });
    const stored = await day(client, "2026-11-16");
    await client.close();

    expect(refused.isError).toBe(true);
    expect(refused.json).toMatchObject({ error: { code: "conflict" } });
    expect(stored.notes).not.toContain("Never stored.");
  });

  it("adds a found-nothing resource and an event whose dates add no time", async () => {
    const client = await connect();

    const found = await call(client, "find_resource", { query: "https://videos.example.test/new" });
    const added = await call(client, "add_resource", {
      module: "async-basics",
      name: "Event Loops Explained",
      type: "youtube-video",
      link: "https://videos.example.test/new",
    });
    const event = await call(client, "save_event", {
      action: "create",
      name: "Fictional Data Day",
      kind: "meetup",
      startsOn: "2026-12-03",
      endsOn: "2026-12-03",
    });
    const eventDay = await day(client, "2026-12-03");
    await client.close();

    expect(found.json).toEqual({ candidates: [], truncated: false });
    expect(added.json).toMatchObject({ entity: "roadmap-resource", id: "event-loops-explained" });
    expect(event.json).toMatchObject({ entity: "roadmap-event", id: "fictional-data-day-2026" });
    expect(eventDay.events.map((covering) => covering.slug)).toEqual(["fictional-data-day-2026"]);
    expect(eventDay.entries).toEqual([]);
    expect(eventDay.totalSeconds).toBe(0);
  });
});
