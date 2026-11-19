// The content-management tools in-process, against the fake content API: the deterministic cases
// of .plan/05-mcp-admin/security.md for slice S02 that need no real API (D10–D12, D15, D16, D20,
// D21, D24). The real API's audit, actor and dependency protection are in mcp.e2e.test.ts (D18).
import type { Client } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";

import { createMcpAdminApp, type McpAdminApp } from "./app.js";
import {
  API_BASE,
  connectClient,
  fakeApi,
  fictionalPerson,
  KEY_A,
  KEY_B,
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

function errorOf(outcome: ToolOutcome) {
  return (outcome.json as { error?: { code: string; message: string; fields?: unknown[] } } | null)
    ?.error;
}

/** The content requests a step sent: everything but the per-request key checks. */
function work(api: FakeApi, from: number) {
  return api.calls
    .slice(from)
    .filter((entry) => !entry.url.endsWith("/v1/authentication"))
    .map((entry) => ({ ...entry, path: new URL(entry.url).pathname }));
}

const PROVENANCE = /^mcp-admin\/(save|delete)\/[0-9a-f]{12}$/;

describe("the tool catalogue", () => {
  it("lists the content tools with honest annotations and strict inputs", async () => {
    const { client } = await open();

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "add_resource",
      "delete",
      "describe",
      "find_resource",
      "get",
      "list",
      "log_session",
      "recent_changes",
      "save",
      "save_book",
      "save_event",
      "set_resource_status",
    ]);
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    for (const name of ["describe", "get", "list", "recent_changes"]) {
      expect(byName.get(name)?.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
      });
    }
    expect(byName.get("save")?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    });
    expect(byName.get("delete")?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    });
    for (const tool of tools) {
      expect(tool.inputSchema["additionalProperties"], tool.name).toBe(false);
    }
  });

  it("names every content entity of phases 2 and 4 and nothing private", async () => {
    const { client } = await open();

    const { tools } = await client.listTools();
    const entities = (
      tools.find((tool) => tool.name === "describe")?.inputSchema.properties?.["entity"] as {
        enum: string[];
      }
    ).enum;

    expect([...entities].sort()).toEqual(
      [
        "person",
        "technology",
        "topic",
        "organization",
        "experience",
        "project",
        "case-study",
        "testimonial",
        "exploration",
        "service",
        "education",
        "current-focus",
        "roadmap-area",
        "roadmap-module",
        "roadmap-resource",
        "roadmap-book",
        "roadmap-event",
        "roadmap-project-idea",
        "roadmap-followed-source",
        "roadmap-glossary-term",
        "roadmap-diary",
        "roadmap-time-entry",
        "media",
      ].sort(),
    );
  });
});

describe("describe", () => {
  it("describes every entity from the shared contracts without reading content", async () => {
    const { client, api } = await open();
    const { tools } = await client.listTools();
    const entities = (
      tools.find((tool) => tool.name === "describe")?.inputSchema.properties?.["entity"] as {
        enum: string[];
      }
    ).enum;
    const before = api.calls.length;

    for (const entity of entities) {
      const outcome = await call(client, "describe", { entity });
      expect(outcome.isError, entity).toBe(false);
      const description = outcome.json as {
        entity: string;
        operations: string[];
        create?: { properties: Record<string, unknown> };
        update?: { properties: Record<string, unknown> };
        relationships: { field: string; target: string; rule: string }[];
      };
      expect(description.entity).toBe(entity);
      expect(description.operations.length, entity).toBeGreaterThan(0);
      const written = new Set([
        ...Object.keys(description.create?.properties ?? {}),
        ...Object.keys(description.update?.properties ?? {}),
      ]);
      for (const relationship of description.relationships) {
        expect(written.has(relationship.field), `${entity}.${relationship.field}`).toBe(true);
        expect(entities).toContain(relationship.target);
      }
      for (const protectedField of ["createdAt", "updatedAt"]) {
        expect(written.has(protectedField), `${entity}.${protectedField}`).toBe(false);
      }
    }
    expect(work(api, before)).toEqual([]);
  });

  it("states what each entity supports", async () => {
    const { client } = await open();

    const operations = async (entity: string) =>
      ((await call(client, "describe", { entity })).json as { operations: string[] }).operations;

    expect(await operations("person")).toEqual(["get", "create", "update"]);
    expect(await operations("project")).toEqual(["list", "get", "create", "update", "delete"]);
    expect(await operations("media")).toEqual(["list", "get", "update", "delete"]);
    expect(await operations("roadmap-diary")).toEqual(["list", "get", "update", "delete"]);
    expect(await operations("roadmap-time-entry")).toEqual(["create", "update", "delete"]);
  });
});

describe("constrained arguments (D10)", () => {
  it("refuses private or unknown entities, paths and query operators before any content call", async () => {
    const { client, api } = await open();
    const before = api.calls.length;

    const attempts: [string, Record<string, unknown>][] = [];
    for (const entity of [
      "api-key",
      "authentication",
      "audit",
      "audit-change",
      "conversation",
      "knowledge",
      "knowledge-passage",
      "sql",
      "/v1/person",
      "../person",
      "http://collector.test/v1/person",
      "projects",
      "*",
    ]) {
      attempts.push(["get", { entity, id: "harbor-ledger" }], ["list", { entity }]);
      attempts.push(["save", { entity, action: "update", id: "x", fields: { name: "x" } }]);
      attempts.push(["delete", { entity, id: "x" }]);
    }
    for (const extra of [
      { query: "select 1" },
      { filter: { name: "Harbor" } },
      { where: "1=1" },
      { path: "/v1/person" },
      { url: "http://collector.test/" },
      { sql: "delete from projects" },
      { limit: 1000 },
      { apiKey: KEY_B },
    ]) {
      attempts.push(["list", { entity: "project", ...extra }]);
      attempts.push(["get", { entity: "project", id: "harbor-ledger", ...extra }]);
      attempts.push(["delete", { entity: "project", id: "harbor-ledger", ...extra }]);
      attempts.push([
        "save",
        {
          entity: "project",
          action: "update",
          id: "harbor-ledger",
          fields: { name: "x" },
          ...extra,
        },
      ]);
      attempts.push(["recent_changes", extra]);
    }
    attempts.push(["save", { entity: "project", action: "upsert", id: "x", fields: {} }]);
    attempts.push(["save", { entity: "project", action: "delete", id: "x", fields: {} }]);

    for (const [name, args] of attempts) {
      const outcome = await call(client, name, args);
      expect(outcome.isError, `${name} ${JSON.stringify(args)}`).toBe(true);
      expect(outcome.text).not.toContain(KEY_B);
    }
    expect(work(api, before)).toEqual([]);
  });

  it("refuses an operation an entity does not support without calling the API", async () => {
    const { client, api } = await open();
    const before = api.calls.length;

    const attempts: [string, Record<string, unknown>][] = [
      ["delete", { entity: "person", id: "person" }],
      ["list", { entity: "person" }],
      ["save", { entity: "media", action: "create", fields: { altText: "x" } }],
      ["get", { entity: "roadmap-time-entry", id: "00000000-0000-4000-8000-000000000001" }],
      ["list", { entity: "roadmap-time-entry" }],
      ["save", { entity: "roadmap-diary", action: "create", id: "2026-01-02", fields: {} }],
      ["list", { entity: "case-study" }],
    ];
    for (const [name, args] of attempts) {
      const outcome = await call(client, name, args);
      expect(outcome.isError, `${name} ${JSON.stringify(args)}`).toBe(true);
      expect(errorOf(outcome)?.code, `${name} ${JSON.stringify(args)}`).toBe(
        "unsupported_operation",
      );
    }
    expect(work(api, before)).toEqual([]);
  });
});

describe("field validation before a write (D11)", () => {
  it("refuses protected, derived, unknown and mistyped fields with field errors and writes nothing", async () => {
    const { client, api } = await open();
    const before = api.calls.length;

    const cases: [Record<string, unknown>, string][] = [
      [{ createdAt: "2020-01-01T00:00:00.000Z" }, "createdAt"],
      [{ updatedAt: "2020-01-01T00:00:00.000Z" }, "updatedAt"],
      [{ slug: "renamed" }, "slug"],
      [{ caseStudy: { role: "x", body: "x" } }, "caseStudy"],
      [{ id: "00000000-0000-4000-8000-000000000001" }, "id"],
      [{ position: "first" }, "position"],
      [{ name: 42 }, "name"],
    ];
    for (const [fields, path] of cases) {
      const outcome = await call(client, "save", {
        entity: "project",
        action: "update",
        id: "harbor-ledger",
        fields,
      });
      expect(outcome.isError, path).toBe(true);
      const error = errorOf(outcome);
      expect(error?.code, path).toBe("field");
      expect(error?.fields, path).toContainEqual(expect.objectContaining({ path }));
    }

    const empty = await call(client, "save", {
      entity: "project",
      action: "update",
      id: "harbor-ledger",
      fields: {},
    });
    expect(errorOf(empty)?.code).toBe("field");

    expect(work(api, before).filter((entry) => entry.method !== "GET")).toEqual([]);
    expect(api.changes).toEqual([]);
  });

  it("refuses a malformed, forged or misplaced record identifier", async () => {
    const { client, api } = await open();
    const before = api.calls.length;

    const attempts: [string, Record<string, unknown>][] = [
      ["get", { entity: "project", id: "../person" }],
      ["get", { entity: "project", id: "Harbor Ledger" }],
      ["get", { entity: "project", id: "harbor-ledger?x=1" }],
      ["get", { entity: "project" }],
      ["get", { entity: "person", id: "ilsa" }],
      ["get", { entity: "media", id: "harbor-ledger" }],
      ["get", { entity: "roadmap-diary", id: "yesterday" }],
      ["delete", { entity: "project", id: "*" }],
      ["delete", { entity: "project", id: "%2e%2e" }],
      ["save", { entity: "project", action: "update", fields: { name: "x" } }],
      ["save", { entity: "project", action: "create", id: "x", fields: { name: "x" } }],
      ["save", { entity: "person", action: "update", id: "ilsa", fields: { name: "x" } }],
    ];
    for (const [name, args] of attempts) {
      const outcome = await call(client, name, args);
      expect(outcome.isError, JSON.stringify(args)).toBe(true);
      expect(errorOf(outcome)?.code, JSON.stringify(args)).toBe("field");
      expect(errorOf(outcome)?.fields, JSON.stringify(args)).toContainEqual(
        expect.objectContaining({ path: "id" }),
      );
    }
    expect(work(api, before)).toEqual([]);
  });

  it("deletes exactly one record: no lists, patterns or filters as identifiers (D21)", async () => {
    const { client, api } = await open();
    const before = api.calls.length;

    for (const id of [
      ["harbor-ledger", "harbor-archive"],
      { in: ["harbor-ledger"] },
      "harbor-*",
      "harbor-ledger,harbor-archive",
      "",
    ]) {
      const outcome = await call(client, "delete", { entity: "project", id });
      expect(outcome.isError, JSON.stringify(id)).toBe(true);
    }
    expect(work(api, before).filter((entry) => entry.method !== "GET")).toEqual([]);
    expect(api.projects.size).toBe(2);
  });
});

describe("reads", () => {
  it("lists and gets records through the public routes without a key", async () => {
    const { client, api } = await open();
    const before = api.calls.length;

    const list = await call(client, "list", { entity: "project" });
    const record = await call(client, "get", { entity: "project", id: "harbor-archive" });
    const person = await call(client, "get", { entity: "person" });

    expect(list.isError).toBe(false);
    expect((list.json as { slug: string }[]).map((project) => project.slug)).toEqual([
      "harbor-ledger",
      "harbor-archive",
    ]);
    expect(record.json).toMatchObject({ slug: "harbor-archive", name: "Harbor Archive" });
    expect(person.json).toEqual(fictionalPerson);
    const reads = work(api, before);
    expect(reads.map(({ method, path }) => `${method} ${path}`)).toEqual([
      "GET /v1/projects",
      "GET /v1/projects/harbor-archive",
      "GET /v1/person",
    ]);
    for (const read of reads) {
      expect(read.authorization).toBeNull();
      expect(read.provenance).toBeNull();
      expect(read.redirect).toBe("manual");
      expect(read.url.startsWith(`${API_BASE}/`)).toBe(true);
    }
  });

  it("says a missing record is missing (D12)", async () => {
    const { client } = await open();

    const outcome = await call(client, "get", { entity: "project", id: "harbor-lighthouse" });

    expect(errorOf(outcome)?.code).toBe("not_found");
  });
});

describe("updates", () => {
  it("reads first, then patches only the intended fields with the caller's key and a provenance", async () => {
    const { client, api } = await open();
    const before = api.calls.length;

    const outcome = await call(client, "save", {
      entity: "project",
      action: "update",
      id: "harbor-ledger",
      fields: { summary: "A fictional ledger, now complete." },
    });

    expect(outcome.isError).toBe(false);
    expect(outcome.json).toMatchObject({
      entity: "project",
      id: "harbor-ledger",
      action: "updated",
      record: { slug: "harbor-ledger", summary: "A fictional ledger, now complete." },
    });
    const sent = work(api, before);
    const writes = sent.filter((entry) => entry.method !== "GET");
    expect(writes).toHaveLength(1);
    const [patch] = writes;
    expect(patch).toMatchObject({
      method: "PATCH",
      path: "/v1/projects/harbor-ledger",
      authorization: `Bearer ${KEY_A}`,
      redirect: "manual",
    });
    expect(JSON.parse(patch?.body ?? "null")).toEqual({
      summary: "A fictional ledger, now complete.",
    });
    expect(patch?.provenance).toMatch(PROVENANCE);
    // The record was read before it was changed, through its public route.
    const readIndex = sent.findIndex(
      (entry) => entry.method === "GET" && entry.path === "/v1/projects/harbor-ledger",
    );
    expect(readIndex).toBeGreaterThanOrEqual(0);
    expect(readIndex).toBeLessThan(sent.findIndex((entry) => entry.method === "PATCH"));
    for (const read of sent.filter((entry) => entry.method === "GET")) {
      expect(read.provenance).toBeNull();
    }
    // Every other field is as it was.
    expect(api.projects.get("harbor-ledger")).toEqual({
      ...api.changes[0]?.before,
      summary: "A fictional ledger, now complete.",
    });
    expect(api.changes).toHaveLength(1);
    expect(api.changes[0]).toMatchObject({
      actor: { keyName: "fixture-a" },
      provenance: patch?.provenance,
    });
  });

  it("keeps a concurrent edit of another field (patch, not replace)", async () => {
    const { client, api } = await open();
    await call(client, "get", { entity: "project", id: "harbor-ledger" });
    const current = api.projects.get("harbor-ledger");
    if (!current) throw new Error("fixture");
    api.projects.set("harbor-ledger", { ...current, result: "Changed by another client." });

    await call(client, "save", {
      entity: "project",
      action: "update",
      id: "harbor-ledger",
      fields: { summary: "Only this." },
    });

    expect(api.projects.get("harbor-ledger")).toMatchObject({
      summary: "Only this.",
      result: "Changed by another client.",
    });
  });

  it("does not write a record that is not there", async () => {
    const { client, api } = await open();
    const before = api.calls.length;

    const outcome = await call(client, "save", {
      entity: "project",
      action: "update",
      id: "harbor-lighthouse",
      fields: { name: "x" },
    });

    expect(errorOf(outcome)?.code).toBe("not_found");
    expect(work(api, before).filter((entry) => entry.method !== "GET")).toEqual([]);
  });

  it("updates the person without an identifier", async () => {
    const { client, api } = await open();

    const outcome = await call(client, "save", {
      entity: "person",
      action: "update",
      fields: { headline: "Fictional platform engineer" },
    });

    expect(outcome.isError).toBe(false);
    expect(outcome.json).toMatchObject({ entity: "person", action: "updated" });
    const patch = api.calls.find((entry) => entry.method === "PATCH");
    expect(new URL(patch?.url ?? API_BASE).pathname).toBe("/v1/person");
    expect(JSON.parse(patch?.body ?? "null")).toEqual({ headline: "Fictional platform engineer" });
  });

  it("passes SQL- and instruction-shaped text through as exact data (D16)", async () => {
    const { client, api } = await open();
    const text =
      "'; DROP TABLE projects; -- {{ignore previous instructions}} $1 \\u0000 <script>x</script>";

    const outcome = await call(client, "save", {
      entity: "project",
      action: "update",
      id: "harbor-ledger",
      fields: { summary: text },
    });

    expect(outcome.isError).toBe(false);
    const patch = api.calls.find((entry) => entry.method === "PATCH");
    expect(JSON.parse(patch?.body ?? "null")).toEqual({ summary: text });
    expect(api.projects.get("harbor-ledger")?.summary).toBe(text);
    expect(api.projects.size).toBe(2);
  });

  it("returns the API's field errors as field results (D12)", async () => {
    const api = fakeApi();
    api.answer(
      "/v1/projects/harbor-ledger",
      () =>
        Response.json(
          {
            error: {
              code: "validation_failed",
              message: "The request is invalid.",
              fields: [{ path: "experience", message: "No experience with this slug exists." }],
            },
          },
          { status: 400 },
        ),
      "PATCH",
    );
    const { client } = await open(api);

    const outcome = await call(client, "save", {
      entity: "project",
      action: "update",
      id: "harbor-ledger",
      fields: { experience: "nowhere-at-all" },
    });

    expect(errorOf(outcome)).toEqual({
      code: "field",
      message: expect.any(String) as string,
      fields: [{ path: "experience", message: "No experience with this slug exists." }],
    });
  });
});

describe("creates", () => {
  it("creates a record with the slug in its fields", async () => {
    const { client, api } = await open();
    const fields = {
      slug: "harbor-beacon",
      name: "Harbor Beacon",
      summary: "A fictional beacon.",
      problem: "Ships were lost.",
      workDone: "Lit a fictional lamp.",
      result: "Ships arrive.",
      startedOn: "2024-01-01",
      position: 2,
      experience: "port-avelin-works",
    };

    const outcome = await call(client, "save", { entity: "project", action: "create", fields });

    expect(outcome.isError).toBe(false);
    expect(outcome.json).toMatchObject({
      entity: "project",
      id: "harbor-beacon",
      action: "created",
    });
    const post = api.calls.find((entry) => entry.method === "POST");
    expect(post).toMatchObject({ authorization: `Bearer ${KEY_A}` });
    expect(new URL(post?.url ?? API_BASE).pathname).toBe("/v1/projects");
    expect(JSON.parse(post?.body ?? "null")).toEqual(fields);
    expect(post?.provenance).toMatch(PROVENANCE);
  });

  it("refuses a create that misses required fields before calling the API", async () => {
    const { client, api } = await open();
    const before = api.calls.length;

    const outcome = await call(client, "save", {
      entity: "project",
      action: "create",
      fields: { slug: "harbor-beacon", name: "Harbor Beacon" },
    });

    expect(errorOf(outcome)?.code).toBe("field");
    expect(errorOf(outcome)?.fields).toContainEqual(
      expect.objectContaining({ path: "experience" }),
    );
    expect(work(api, before).filter((entry) => entry.method !== "GET")).toEqual([]);
  });
});

describe("deletes", () => {
  it("reads first, then deletes exactly the named record with a provenance", async () => {
    const { client, api } = await open();
    const before = api.calls.length;

    const outcome = await call(client, "delete", { entity: "project", id: "harbor-archive" });

    expect(outcome.isError).toBe(false);
    expect(outcome.json).toMatchObject({
      entity: "project",
      id: "harbor-archive",
      action: "deleted",
    });
    const sent = work(api, before);
    const writes = sent.filter((entry) => entry.method !== "GET");
    expect(writes.map(({ method, path }) => `${method} ${path}`)).toEqual([
      "DELETE /v1/projects/harbor-archive",
    ]);
    expect(writes[0]?.authorization).toBe(`Bearer ${KEY_A}`);
    expect(writes[0]?.provenance).toMatch(/^mcp-admin\/delete\/[0-9a-f]{12}$/);
    expect(
      sent.some((entry) => entry.method === "GET" && entry.path === "/v1/projects/harbor-archive"),
    ).toBe(true);
    expect([...api.projects.keys()]).toEqual(["harbor-ledger"]);
  });

  it("reports a dependency conflict with the API's reason and attempts nothing else (D12, D21)", async () => {
    const api = fakeApi();
    api.protect("harbor-ledger");
    const { client } = await open(api);
    const before = api.calls.length;

    const outcome = await call(client, "delete", { entity: "project", id: "harbor-ledger" });

    expect(errorOf(outcome)?.code).toBe("conflict");
    expect(errorOf(outcome)?.message).toContain("still has a case study");
    const writes = work(api, before).filter((entry) => entry.method !== "GET");
    expect(writes.map(({ method, path }) => `${method} ${path}`)).toEqual([
      "DELETE /v1/projects/harbor-ledger",
    ]);
    expect(api.projects.size).toBe(2);
  });

  it("does not delete a record that is not there", async () => {
    const { client, api } = await open();
    const before = api.calls.length;

    const outcome = await call(client, "delete", { entity: "project", id: "harbor-lighthouse" });

    expect(errorOf(outcome)?.code).toBe("not_found");
    expect(work(api, before).filter((entry) => entry.method !== "GET")).toEqual([]);
  });
});

describe("lost responses (D20)", () => {
  const update = {
    entity: "project",
    action: "update",
    id: "harbor-ledger",
    fields: { summary: "Sent once." },
  };

  it("reconciles a write committed before its answer was lost, without sending it again", async () => {
    const api = fakeApi();
    api.lose("PATCH", "/v1/projects/harbor-ledger", "after-commit");
    const { client } = await open(api);

    const outcome = await call(client, "save", update);

    expect(outcome.isError).toBe(false);
    expect(outcome.json).toMatchObject({
      entity: "project",
      id: "harbor-ledger",
      action: "updated",
      reconciled: true,
    });
    expect(api.calls.filter((entry) => entry.method === "PATCH")).toHaveLength(1);
    expect(api.changes).toHaveLength(1);
    expect(api.projects.get("harbor-ledger")?.summary).toBe("Sent once.");
  });

  it("reports uncertain, never a retry, when the audit shows no such change", async () => {
    const api = fakeApi();
    api.lose("PATCH", "/v1/projects/harbor-ledger", "before-commit");
    const { client } = await open(api);

    const outcome = await call(client, "save", update);

    expect(outcome.isError).toBe(true);
    expect(errorOf(outcome)?.code).toBe("uncertain");
    expect(api.calls.filter((entry) => entry.method === "PATCH")).toHaveLength(1);
    expect(api.changes).toEqual([]);
  });

  it("does not take another caller's change for its own", async () => {
    const api = fakeApi();
    // The answer is lost before commit, and meanwhile another key makes the same change.
    api.answer(
      "/v1/projects/harbor-ledger",
      () => {
        const current = api.projects.get("harbor-ledger");
        if (!current) throw new Error("fixture");
        api.projects.set("harbor-ledger", { ...current, summary: "Sent once." });
        api.changes.push({
          id: api.changes.length + 1,
          occurredAt: "2026-01-01T00:00:00.000Z",
          actor: { keyId: "00000000-0000-4000-8000-00000000000b", keyName: "fixture-b" },
          operation: {
            operationId: "updateProject",
            method: "PATCH",
            route: "/v1/projects/{slug}",
          },
          provenance: "other-client/save/000000000000",
          entity: "project",
          record: "harbor-ledger",
          action: "updated",
          before: current,
          after: { ...current, summary: "Sent once." },
        });
        throw new TypeError("fetch failed");
      },
      "PATCH",
    );
    const { client } = await open(api);

    const outcome = await call(client, "save", update);

    expect(errorOf(outcome)?.code).toBe("uncertain");
  });

  it("treats a server error as uncertain unless the audit shows the change", async () => {
    const api = fakeApi();
    api.answer(
      "/v1/projects/harbor-ledger",
      () => Response.json({ error: { code: "internal_error", message: "x" } }, { status: 500 }),
      "PATCH",
    );
    const { client } = await open(api);

    const outcome = await call(client, "save", update);

    expect(errorOf(outcome)?.code).toBe("uncertain");
    expect(api.calls.filter((entry) => entry.method === "PATCH")).toHaveLength(1);
  });

  it("reconciles a delete whose answer was lost", async () => {
    const api = fakeApi();
    api.lose("DELETE", "/v1/projects/harbor-archive", "after-commit");
    const { client } = await open(api);

    const outcome = await call(client, "delete", { entity: "project", id: "harbor-archive" });

    expect(outcome.json).toMatchObject({ action: "deleted", reconciled: true });
    expect(api.calls.filter((entry) => entry.method === "DELETE")).toHaveLength(1);
  });

  it("does not write when the audit cannot be read to reconcile later", async () => {
    const api = fakeApi();
    api.answer("/v1/audit/changes", () => new Response("down", { status: 503 }));
    const { client } = await open(api);

    const outcome = await call(client, "save", update);

    expect(errorOf(outcome)?.code).toBe("unavailable");
    expect(api.calls.filter((entry) => entry.method === "PATCH")).toEqual([]);
  });

  it("says nothing changed when the API refuses the write outright", async () => {
    const api = fakeApi();
    api.answer(
      "/v1/projects/harbor-ledger",
      () =>
        Response.json(
          { error: { code: "rate_limited", message: "Too many requests." } },
          { status: 429 },
        ),
      "PATCH",
    );
    const { client } = await open(api);

    const outcome = await call(client, "save", update);

    expect(errorOf(outcome)?.code).toBe("unavailable");
    expect(api.calls.filter((entry) => entry.method === "PATCH")).toHaveLength(1);
  });
});

describe("recent changes (D24)", () => {
  it("reads the bounded audit with the caller's key", async () => {
    const { client, api } = await open();
    for (let index = 0; index < 25; index += 1) {
      await call(client, "save", {
        entity: "project",
        action: "update",
        id: "harbor-ledger",
        fields: { position: index },
      });
    }
    const before = api.calls.length;

    const outcome = await call(client, "recent_changes", {});

    expect(outcome.isError).toBe(false);
    const { changes } = outcome.json as {
      changes: { id: number; actor: { keyName: string }; provenance: string }[];
    };
    expect(changes.length).toBeLessThanOrEqual(20);
    expect(changes[0]?.id).toBe(25);
    expect(changes[0]?.actor.keyName).toBe("fixture-a");
    expect(changes[0]?.provenance).toMatch(PROVENANCE);
    const [read] = work(api, before);
    expect(read).toMatchObject({
      method: "GET",
      path: "/v1/audit/changes",
      authorization: `Bearer ${KEY_A}`,
    });
    expect(new URL(read?.url ?? API_BASE).search).toBe("");
  });

  it("reports an unavailable audit without its answer", async () => {
    const api = fakeApi();
    api.answer("/v1/audit/changes", () => new Response(`upstream said ${KEY_B}`, { status: 502 }));
    const { client } = await open(api);

    const outcome = await call(client, "recent_changes", {});

    expect(errorOf(outcome)?.code).toBe("unavailable");
    expect(outcome.text).not.toContain(KEY_B);
  });
});

describe("no secrets in results (D15)", () => {
  it("redacts key-shaped text an API error message carries", async () => {
    const api = fakeApi();
    api.answer(
      "/v1/projects/harbor-ledger",
      () =>
        Response.json(
          { error: { code: "conflict", message: `Blocked by ${KEY_B} and ${"x".repeat(2000)}` } },
          { status: 409 },
        ),
      "DELETE",
    );
    const { client } = await open(api);

    const outcome = await call(client, "delete", { entity: "project", id: "harbor-ledger" });

    expect(errorOf(outcome)?.code).toBe("conflict");
    expect(outcome.text).not.toContain(KEY_B);
    expect(outcome.text).not.toContain(KEY_A);
    expect(outcome.text.length).toBeLessThan(1000);
  });

  it("never echoes the caller's key in a write result", async () => {
    const { client } = await open();

    const outcome = await call(client, "save", {
      entity: "project",
      action: "update",
      id: "harbor-ledger",
      fields: { name: "Harbor Ledger II" },
    });

    expect(outcome.text).not.toContain(KEY_A);
    expect(outcome.text).not.toContain("authorization");
  });
});
