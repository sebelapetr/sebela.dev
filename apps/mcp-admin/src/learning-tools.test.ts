// The learning task tools in-process, against the fake content API: the deterministic cases of
// .plan/05-mcp-admin/security.md for slice S03 that need no real API (D08, D10–D13, D15, D16, D20).
// A session's atomic write and its audit are proven against the real API in the API's own tests.
import type { Client } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";

import { createMcpAdminApp, type McpAdminApp } from "./app.js";
import {
  API_BASE,
  connectClient,
  fakeApi,
  KEY_A,
  testConfig,
  toolText,
  type FakeApi,
} from "./test-support/index.js";

const opened: McpAdminApp[] = [];
const clients: Client[] = [];

async function open(api: FakeApi = fakeApi()) {
  const admin = createMcpAdminApp({
    config: testConfig(),
    fetch: api.fetch,
    log: () => undefined,
  });
  opened.push(admin);
  const client = await connectClient(admin.app.fetch, KEY_A);
  clients.push(client);
  return { api, client };
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(opened.splice(0).map((admin) => admin.close()));
});

interface ToolOutcome {
  isError: boolean;
  text: string;
  json: unknown;
}

/** Calls a tool; an argument the SDK refuses before the handler counts as an error result. */
async function call(client: Client, name: string, args: unknown): Promise<ToolOutcome> {
  try {
    const result = await client.callTool({ name, arguments: args as Record<string, unknown> });
    const text = toolText(result);
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { isError: result.isError === true, text, json };
  } catch (error) {
    return { isError: true, text: String(error), json: null };
  }
}

interface ToolError {
  code: string;
  message: string;
  fields?: { path: string; message: string }[];
  candidates?: unknown[];
}

function errorOf(outcome: ToolOutcome): ToolError | undefined {
  return (outcome.json as { error?: ToolError } | null)?.error;
}

/** The content requests a step sent: everything but the per-request key checks. */
function work(api: FakeApi, from = 0) {
  return api.calls
    .slice(from)
    .filter((entry) => !entry.url.endsWith("/v1/authentication"))
    .map((entry) => ({ ...entry, path: new URL(entry.url).pathname }));
}

const writes = (api: FakeApi, from = 0) =>
  work(api, from).filter((entry) => entry.method !== "GET");

const SESSION_PROVENANCE = /^mcp-admin\/session\/[0-9a-f]{12}$/;

describe("the learning tool catalogue", () => {
  it("adds six task tools with honest annotations and strict inputs", async () => {
    const { client } = await open();

    const { tools } = await client.listTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool]));

    expect(byName.get("find_resource")?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
    });
    for (const name of [
      "add_resource",
      "set_resource_status",
      "log_session",
      "save_event",
      "save_book",
    ]) {
      expect(byName.get(name)?.annotations, name).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      });
      expect(byName.get(name)?.inputSchema["additionalProperties"], name).toBe(false);
    }
  });

  it("states the rules a model must follow in the descriptions", async () => {
    const { client } = await open();

    const { tools } = await client.listTools();
    const describe = (name: string) => tools.find((tool) => tool.name === name)?.description ?? "";

    expect(describe("set_resource_status")).toMatch(/started.*in-progress/i);
    expect(describe("log_session")).toMatch(/never invent/i);
    expect(describe("log_session")).toMatch(/offset/i);
    expect(describe("log_session")).toMatch(/book/i);
    expect(describe("save_event")).toMatch(/no (attendance )?time/i);
    expect(describe("find_resource")).toMatch(/never (opens|fetches)/i);
  });
});

describe("find_resource", () => {
  it("returns every resource with the name and where each lies, so a collision can be resolved", async () => {
    const { client } = await open();

    const outcome = await call(client, "find_resource", { query: "python async" });

    expect(outcome.isError).toBe(false);
    expect(outcome.json).toEqual({
      candidates: [
        expect.objectContaining({
          slug: "python-async-intro",
          name: "Python Async",
          status: "planned",
          module: { slug: "async-basics", name: "Async Basics" },
          area: { slug: "foundations", name: "Foundations" },
        }),
        expect.objectContaining({
          slug: "python-async-lab",
          module: { slug: "concurrency-lab", name: "Concurrency Lab" },
        }),
      ],
      truncated: false,
    });
  });

  it("matches a link against stored links only and never requests the link", async () => {
    const { api, client } = await open();

    const outcome = await call(client, "find_resource", {
      query: "HTTPS://Lab.Example.test/async/",
    });

    expect(outcome.json).toMatchObject({ candidates: [{ slug: "python-async-lab" }] });
    const hosts = new Set(api.calls.map((entry) => new URL(entry.url).origin));
    expect([...hosts]).toEqual([new URL(API_BASE).origin]);
    expect(writes(api)).toEqual([]);
  });

  it("finds a resource by its stored slug", async () => {
    const { client } = await open();

    const outcome = await call(client, "find_resource", { query: "harbor-patterns-book" });

    expect(outcome.json).toEqual({
      candidates: [expect.objectContaining({ slug: "harbor-patterns-book" })],
      truncated: false,
    });
  });

  it("finds nothing rather than a guess", async () => {
    const { client } = await open();

    const outcome = await call(client, "find_resource", {
      query: "https://unknown.example.test/x",
    });

    expect(outcome.json).toEqual({ candidates: [], truncated: false });
  });
});

describe("add_resource", () => {
  it("creates a resource at the end of a confirmed module with a derived slug", async () => {
    const { api, client } = await open();

    const outcome = await call(client, "add_resource", {
      module: "async-basics",
      name: "Event Loops Explained",
      type: "video",
      link: "https://videos.example.test/event-loops",
    });

    expect(outcome.isError).toBe(false);
    expect(outcome.json).toMatchObject({
      entity: "roadmap-resource",
      id: "event-loops-explained",
      action: "created",
    });
    expect(api.roadmap.resources.get("event-loops-explained")).toMatchObject({
      module: "async-basics",
      name: "Event Loops Explained",
      type: "video",
      position: 1,
    });
  });

  it("refuses an unknown module without writing", async () => {
    const { api, client } = await open();

    const outcome = await call(client, "add_resource", {
      module: "no-such-module",
      name: "Anything",
      type: "link",
    });

    expect(errorOf(outcome)?.code).toBe("not_found");
    expect(writes(api)).toEqual([]);
  });

  it("refuses a duplicate link or name and returns the existing candidates", async () => {
    const { api, client } = await open();

    const byLink = await call(client, "add_resource", {
      module: "async-basics",
      name: "Another Name",
      type: "project",
      link: "https://lab.example.test/async",
    });
    const byName = await call(client, "add_resource", {
      module: "async-basics",
      name: "python async",
      type: "video",
    });

    expect(errorOf(byLink)).toMatchObject({
      code: "conflict",
      candidates: [{ slug: "python-async-lab" }],
    });
    expect(errorOf(byName)).toMatchObject({
      code: "conflict",
      candidates: [{ slug: "python-async-intro" }],
    });
    expect(writes(api)).toEqual([]);
  });

  it("asks for an explicit slug when the derived one is taken", async () => {
    const api = fakeApi();
    api.roadmap.resources.set("deep-dive", {
      slug: "deep-dive",
      module: "reading-list",
      name: "A Deep Dive",
      type: "text",
    });
    const { client } = await open(api);

    const outcome = await call(client, "add_resource", {
      module: "async-basics",
      name: "Deep Dive",
      type: "text",
    });

    expect(errorOf(outcome)).toMatchObject({ code: "field", fields: [{ path: "slug" }] });
    expect(writes(api)).toEqual([]);
  });

  it("refuses a status outside the canonical enum", async () => {
    const { api, client } = await open();

    const outcome = await call(client, "add_resource", {
      module: "async-basics",
      name: "Started Thing",
      type: "link",
      status: "started",
    });

    expect(outcome.isError).toBe(true);
    expect(writes(api)).toEqual([]);
  });
});

describe("set_resource_status", () => {
  it("writes only the canonical status and the dates it was given", async () => {
    const { api, client } = await open();

    const outcome = await call(client, "set_resource_status", {
      resource: "python-async-intro",
      status: "in-progress",
      startedAt: "2026-11-17T09:00:00+01:00",
    });

    expect(outcome.isError).toBe(false);
    const [patch] = writes(api);
    expect(patch).toMatchObject({
      method: "PATCH",
      path: "/v1/roadmap/resources/python-async-intro",
    });
    // The resource contract stores UTC instants, so an offset instant is sent as its UTC form.
    expect(JSON.parse(patch?.body ?? "{}")).toEqual({
      status: "in-progress",
      startedAt: "2026-11-17T08:00:00.000Z",
    });
  });

  it("refuses a non-canonical status before any request", async () => {
    const { api, client } = await open();

    const outcome = await call(client, "set_resource_status", {
      resource: "python-async-intro",
      status: "started",
    });

    expect(outcome.isError).toBe(true);
    expect(writes(api)).toEqual([]);
  });
});

describe("log_session", () => {
  const session = {
    resource: "python-async-intro",
    startedAt: "2026-11-17T09:00:00+01:00",
    endedAt: "2026-11-17T10:30:00+01:00",
  };

  it("logs one session through the session action with its own provenance", async () => {
    const { api, client } = await open();

    const outcome = await call(client, "log_session", { ...session, notes: "Read about tasks." });

    expect(outcome.isError).toBe(false);
    expect(outcome.json).toMatchObject({ dates: ["2026-11-17"] });
    const sent = writes(api);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ method: "POST", path: "/v1/roadmap/sessions" });
    expect(sent[0]?.provenance).toMatch(SESSION_PROVENANCE);
    expect(api.roadmap.notes.get("2026-11-17")).toBe("Read about tasks.");
  });

  it("appends notes to earlier notes of the day", async () => {
    const api = fakeApi();
    api.roadmap.notes.set("2026-11-17", "Morning notes.");
    const { client } = await open(api);

    await call(client, "log_session", { ...session, notes: "Afternoon notes." });

    expect(api.roadmap.notes.get("2026-11-17")).toBe("Morning notes.\n\nAfternoon notes.");
  });

  it("returns both days of a session across Prague midnight", async () => {
    const { client } = await open();

    const outcome = await call(client, "log_session", {
      resource: "python-async-intro",
      startedAt: "2026-11-17T23:30:00+01:00",
      endedAt: "2026-11-18T00:30:00+01:00",
    });

    expect(outcome.json).toMatchObject({ dates: ["2026-11-17", "2026-11-18"] });
  });

  it("logs a book's session on its linked resource, once", async () => {
    const { api, client } = await open();

    const outcome = await call(client, "log_session", {
      book: "harbor-patterns",
      startedAt: "2026-11-17T18:00:00+01:00",
      endedAt: "2026-11-17T19:00:00+01:00",
    });

    expect(outcome.isError).toBe(false);
    const sent = writes(api);
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]?.body ?? "{}")).toMatchObject({ resource: "harbor-patterns-book" });
    expect(api.roadmap.intervals).toHaveLength(1);
  });

  it("refuses a book without a linked resource as a field error, writing nothing", async () => {
    const { api, client } = await open();

    const outcome = await call(client, "log_session", {
      book: "quiet-ledger",
      startedAt: "2026-11-17T18:00:00+01:00",
      endedAt: "2026-11-17T19:00:00+01:00",
    });

    expect(errorOf(outcome)).toMatchObject({ code: "field", fields: [{ path: "book" }] });
    expect(writes(api)).toEqual([]);
  });

  it("logs attendance at an event through the same action", async () => {
    const { api, client } = await open();

    const outcome = await call(client, "log_session", {
      event: "fictional-ml-summit-2026",
      startedAt: "2026-11-16T09:00:00+01:00",
      endedAt: "2026-11-16T12:00:00+01:00",
    });

    expect(outcome.isError).toBe(false);
    expect(JSON.parse(writes(api)[0]?.body ?? "{}")).toMatchObject({
      event: "fictional-ml-summit-2026",
    });
  });

  it("refuses an endpoint without an offset and sends nothing", async () => {
    const { api, client } = await open();

    const outcome = await call(client, "log_session", {
      ...session,
      startedAt: "2026-11-17T09:00:00",
    });

    expect(outcome.isError).toBe(true);
    expect(writes(api)).toEqual([]);
  });

  it("refuses an end that is not after the start and sends nothing", async () => {
    const { api, client } = await open();

    const outcome = await call(client, "log_session", { ...session, endedAt: session.startedAt });

    expect(errorOf(outcome)).toMatchObject({ code: "field", fields: [{ path: "endedAt" }] });
    expect(writes(api)).toEqual([]);
  });

  it("refuses more than one target or none", async () => {
    const { api, client } = await open();

    const two = await call(client, "log_session", {
      ...session,
      event: "fictional-ml-summit-2026",
    });
    const none = await call(client, "log_session", {
      startedAt: session.startedAt,
      endedAt: session.endedAt,
    });

    expect(two.isError).toBe(true);
    expect(none.isError).toBe(true);
    expect(writes(api)).toEqual([]);
  });

  it("reports an overlap as a conflict and changes nothing", async () => {
    const api = fakeApi();
    api.roadmap.intervals.push({
      target: { event: "fictional-ml-summit-2026" },
      startedAt: Date.parse("2026-11-17T10:00:00+01:00"),
      endedAt: Date.parse("2026-11-17T11:00:00+01:00"),
    });
    const { client } = await open(api);

    const outcome = await call(client, "log_session", { ...session, notes: "Not kept." });

    expect(errorOf(outcome)?.code).toBe("conflict");
    expect(api.roadmap.intervals).toHaveLength(1);
    expect(api.roadmap.notes.has("2026-11-17")).toBe(false);
  });

  it("reconciles a session committed before its answer was lost, sending it once", async () => {
    const api = fakeApi();
    api.lose("POST", "/v1/roadmap/sessions", "after-commit");
    const { client } = await open(api);

    const outcome = await call(client, "log_session", session);

    expect(outcome.isError).toBe(false);
    expect(outcome.json).toMatchObject({ dates: ["2026-11-17"], reconciled: true });
    expect(writes(api)).toHaveLength(1);
    expect(api.roadmap.intervals).toHaveLength(1);
  });

  it("reports uncertain and does not resend when the audit shows no session", async () => {
    const api = fakeApi();
    api.lose("POST", "/v1/roadmap/sessions", "before-commit");
    const { client } = await open(api);

    const outcome = await call(client, "log_session", session);

    expect(errorOf(outcome)?.code).toBe("uncertain");
    expect(writes(api)).toHaveLength(1);
    expect(api.roadmap.intervals).toEqual([]);
  });

  it("does not log when the audit cannot be read to reconcile later", async () => {
    const api = fakeApi();
    api.answer("/v1/audit/changes", () => new Response("down", { status: 503 }));
    const { client } = await open(api);

    const outcome = await call(client, "log_session", session);

    expect(errorOf(outcome)?.code).toBe("unavailable");
    expect(writes(api)).toEqual([]);
  });

  it("keeps a key in an upstream message out of the result", async () => {
    const api = fakeApi();
    api.answer(
      "/v1/roadmap/sessions",
      () =>
        Response.json(
          { error: { code: "conflict", message: `Overlap seen by ${KEY_A}.` } },
          { status: 409 },
        ),
      "POST",
    );
    const { client } = await open(api);

    const outcome = await call(client, "log_session", session);

    expect(errorOf(outcome)?.code).toBe("conflict");
    expect(outcome.text).not.toContain(KEY_A);
  });
});

describe("save_event", () => {
  const event = {
    action: "create",
    name: "Fictional Data Day",
    kind: "meetup",
    startsOn: "2026-12-03",
    endsOn: "2026-12-03",
  };

  it("creates an event with a slug from its name and year", async () => {
    const { api, client } = await open();

    const outcome = await call(client, "save_event", event);

    expect(outcome.json).toMatchObject({
      entity: "roadmap-event",
      id: "fictional-data-day-2026",
      action: "created",
    });
    expect(api.roadmap.events.get("fictional-data-day-2026")).toMatchObject({
      startsOn: "2026-12-03",
      endsOn: "2026-12-03",
    });
    expect(api.roadmap.intervals).toEqual([]);
  });

  it("asks for missing required facts instead of inventing them", async () => {
    const { api, client } = await open();

    const outcome = await call(client, "save_event", {
      action: "create",
      name: "Fictional Data Day",
      kind: "meetup",
    });

    expect(errorOf(outcome)).toMatchObject({ code: "field" });
    expect(
      errorOf(outcome)
        ?.fields?.map((field) => field.path)
        .sort(),
    ).toEqual(["endsOn", "startsOn"]);
    expect(writes(api)).toEqual([]);
  });

  it("refuses the same event again and names the stored one", async () => {
    const { api, client } = await open();

    const outcome = await call(client, "save_event", {
      action: "create",
      name: "fictional ml summit",
      kind: "conference",
      startsOn: "2026-11-17",
      endsOn: "2026-11-18",
    });

    expect(errorOf(outcome)).toMatchObject({
      code: "conflict",
      candidates: [{ slug: "fictional-ml-summit-2026" }],
    });
    expect(writes(api)).toEqual([]);
  });

  it("updates only the given fields of a stored event", async () => {
    const { api, client } = await open();

    const outcome = await call(client, "save_event", {
      action: "update",
      slug: "fictional-ml-summit-2026",
      takeaways: "Evals first.",
    });

    expect(outcome.isError).toBe(false);
    const [patch] = writes(api);
    expect(patch?.path).toBe("/v1/roadmap/events/fictional-ml-summit-2026");
    expect(JSON.parse(patch?.body ?? "{}")).toEqual({ takeaways: "Evals first." });
  });
});

describe("save_book", () => {
  it("creates a book with its dates and no status", async () => {
    const { api, client } = await open();

    const outcome = await call(client, "save_book", {
      action: "create",
      title: "Fictional Systems",
      author: "Ada Example",
      startedOn: "2026-11-10",
    });

    expect(outcome.json).toMatchObject({
      entity: "roadmap-book",
      id: "fictional-systems",
      action: "created",
    });
    expect(JSON.parse(writes(api)[0]?.body ?? "{}")).not.toHaveProperty("status");
  });

  it("refuses a status: the book's state comes from its dates", async () => {
    const { api, client } = await open();

    const outcome = await call(client, "save_book", {
      action: "update",
      slug: "harbor-patterns",
      status: "completed",
    });

    expect(outcome.isError).toBe(true);
    expect(writes(api)).toEqual([]);
  });

  it("finishes a book through its end date and summary", async () => {
    const { api, client } = await open();

    const outcome = await call(client, "save_book", {
      action: "update",
      slug: "harbor-patterns",
      endedOn: "2026-11-17",
      summary: "Calm, useful patterns.",
    });

    expect(outcome.json).toMatchObject({ action: "updated", record: { status: "completed" } });
    expect(JSON.parse(writes(api)[0]?.body ?? "{}")).toEqual({
      endedOn: "2026-11-17",
      summary: "Calm, useful patterns.",
    });
  });

  it("refuses the same title again and names the stored book", async () => {
    const { api, client } = await open();

    const outcome = await call(client, "save_book", {
      action: "create",
      title: "harbor patterns",
    });

    expect(errorOf(outcome)).toMatchObject({
      code: "conflict",
      candidates: [{ slug: "harbor-patterns" }],
    });
    expect(writes(api)).toEqual([]);
  });
});

describe("a partial result", () => {
  it("keeps a created resource when its session is refused and reports both outcomes", async () => {
    const api = fakeApi();
    api.roadmap.intervals.push({
      target: { resource: "python-async-lab" },
      startedAt: Date.parse("2026-11-17T09:00:00+01:00"),
      endedAt: Date.parse("2026-11-17T12:00:00+01:00"),
    });
    const { client } = await open(api);

    const created = await call(client, "add_resource", {
      module: "async-basics",
      name: "Structured Concurrency",
      type: "text",
    });
    const logged = await call(client, "log_session", {
      resource: "structured-concurrency",
      startedAt: "2026-11-17T10:00:00+01:00",
      endedAt: "2026-11-17T11:00:00+01:00",
    });

    expect(created.isError).toBe(false);
    expect(errorOf(logged)?.code).toBe("conflict");
    expect(api.roadmap.resources.has("structured-concurrency")).toBe(true);
    expect(writes(api).filter((entry) => entry.method === "DELETE")).toEqual([]);
  });
});
