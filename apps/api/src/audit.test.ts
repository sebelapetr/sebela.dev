import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  MediaSchema,
  RecentChangesSchema,
  auditProvenanceHeader,
  recentChangesLimit,
  type AuditChange,
} from "@sebela/contracts";
import type { AuditedWrite, Services } from "@sebela/services";
import { samplePng } from "@sebela/services/testing";

import { createApp, type Api } from "./app.js";
import {
  anyText,
  bearer,
  connection,
  json,
  openTestBackend,
  person,
  testConfig,
  upload,
  type TestBackend,
} from "./test-support.js";

const CHANGES = "/v1/audit/changes";
const KEY_NAME = "audit routes";
const topic = { slug: "agents", name: "Agents", position: 0 };

/**
 * The reviewed routes that take a body through a write method but change no content: a search
 * whose query is too large for an address. They are never audited and never announced.
 */
const READ_ONLY = new Set(["POST /v1/retrieval/search"]);

/**
 * The mutations a Hono app answers that no audited route accounts for: every route registered for
 * a write method, or for every method, that is not a write route the API documents as audited. The
 * catch-all 404 and the middleware every request passes are the reviewed exceptions.
 */
function unauditedMutations(api: Api): string[] {
  const audited = new Set(
    api.routes
      .filter((route) => route.method !== "GET" && route.audit !== null)
      .map((route) => `${route.method} ${route.path}`),
  );
  const reviewed = new Set(["ALL *", "ALL /*", ...READ_ONLY]);
  const found = new Set<string>();
  for (const { method, path } of api.app.routes) {
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") continue;
    const name = `${method} ${path}`;
    if (!audited.has(name) && !reviewed.has(name)) found.add(name);
  }
  return [...found];
}

/** A path of the route with every parameter filled with a value that names no record. */
const unknownRecordPath = (path: string) =>
  path
    .replace(":id", randomUUID())
    .replace(":date", "2001-01-01")
    .replace(/:([A-Za-z]+)/g, "missing-record");

describe("the content audit", () => {
  let backend: TestBackend;
  let key: string;
  let auth: Record<string, string>;
  let keyId: string;

  beforeAll(async () => {
    backend = await openTestBackend();
    const created = await backend.services.apiKeys.createKey(KEY_NAME);
    key = created.key;
    keyId = created.metadata.id;
    auth = bearer(key);
  });

  afterAll(async () => {
    await backend.close();
  });

  beforeEach(async () => {
    const { profile } = backend.services;
    for (const { slug } of await profile.listTopics()) await profile.deleteTopic(slug);
  });

  const send = (path: string, method: string, init: RequestInit = {}, api = backend.api()) =>
    api.app.request(path, { method, ...init }, connection());

  /** The newest audited changes, read with the key. */
  async function changes(): Promise<AuditChange[]> {
    const response = await send(CHANGES, "GET", { headers: auth });
    expect(response.status).toBe(200);
    return RecentChangesSchema.parse(await response.json()).changes;
  }

  /** The newest change's id, so a test can tell which changes it made. */
  const newest = async () => (await changes())[0]?.id ?? 0;
  const since = async (id: number) =>
    (await changes()).filter((change) => change.id > id).reverse();

  it("records each committed write with the verified key, operation, provenance and before and after", async () => {
    const start = await newest();
    const provenance = { [auditProvenanceHeader]: "mcp-admin/update_content" };

    const created = await send("/v1/topics", "POST", json(topic, { ...auth, ...provenance }));
    expect(created.status).toBe(201);
    const createdTopic: unknown = await created.json();
    const updated = await send("/v1/topics/agents", "PATCH", json({ name: "AI agents" }, auth));
    expect(updated.status).toBe(200);
    const updatedTopic: unknown = await updated.json();
    expect((await send("/v1/topics/agents", "DELETE", { headers: auth })).status).toBe(204);

    const recorded = await since(start);
    expect(recorded).toEqual([
      {
        id: expect.any(Number) as unknown,
        occurredAt: anyText,
        actor: { keyId, keyName: KEY_NAME },
        operation: { operationId: "createTopic", method: "POST", route: "/v1/topics" },
        provenance: "mcp-admin/update_content",
        entity: "topic",
        record: "agents",
        action: "created",
        before: null,
        after: createdTopic,
      },
      expect.objectContaining({
        operation: { operationId: "updateTopic", method: "PATCH", route: "/v1/topics/:slug" },
        provenance: null,
        record: "agents",
        action: "updated",
        before: createdTopic,
        after: updatedTopic,
      }),
      expect.objectContaining({
        operation: { operationId: "deleteTopic", method: "DELETE", route: "/v1/topics/:slug" },
        record: "agents",
        action: "deleted",
        before: updatedTopic,
        after: null,
      }),
    ]);
  });

  it("takes the actor only from the verified key, whatever a request claims", async () => {
    const start = await newest();
    const other = await backend.services.apiKeys.createKey("someone else");
    const claims = {
      "sebela-actor": other.metadata.id,
      "x-api-key-id": other.metadata.id,
      "x-forwarded-user": "someone else",
    };

    expect((await send("/v1/topics", "POST", json(topic, { ...auth, ...claims }))).status).toBe(
      201,
    );

    const [change] = await since(start);
    expect(change?.actor).toEqual({ keyId, keyName: KEY_NAME });
  });

  it.each([
    ["an unknown character", "MCP Admin"],
    ["a label longer than the limit", `m${"a".repeat(64)}`],
    ["a credential-shaped value", "Bearer abc.def"],
  ])("refuses a provenance label with %s and writes nothing", async (_, label) => {
    const start = await newest();

    const response = await send(
      "/v1/topics",
      "POST",
      json(topic, { ...auth, [auditProvenanceHeader]: label }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "validation_failed",
        message: anyText,
        fields: [{ path: "provenance", message: anyText }],
      },
    });
    expect((await send("/v1/topics/agents", "GET")).status).toBe(404);
    expect(await since(start)).toEqual([]);
  });

  it("names the person without a record, a case study by its project and media by identifier", async () => {
    const { profile } = backend.services;
    await profile.createOrganization({
      logoId: null,
      slug: "northwind",
      name: "Northwind",
      website: null,
      description: null,
    });
    await profile.createExperience({
      slug: "northwind-lead",
      organization: "northwind",
      title: "Engineer",
      kind: "main_job",
      startedOn: "2021-03-01",
      endedOn: null,
      summary: "A fictional role.",
      responsibilities: [],
      inCv: true,
      technologies: [],
    });
    await profile.createProject({
      coverId: null,
      slug: "routing-engine",
      experience: "northwind-lead",
      name: "Routing engine",
      summary: "A fictional project.",
      problem: "A fictional problem.",
      workDone: "Fictional work.",
      result: "A fictional result.",
      startedOn: "2022-01-01",
      endedOn: null,
      links: [],
      selectedForHomepage: true,
      position: 0,
      technologies: [],
    });
    const start = await newest();

    expect((await send("/v1/person", "POST", json(person, auth))).status).toBe(201);
    expect((await send("/v1/person", "DELETE", { headers: auth })).status).toBe(204);
    const study = { role: "Lead engineer.", body: "A fictional case study." };
    const address = "/v1/projects/routing-engine/case-study";
    expect((await send(address, "POST", json(study, auth))).status).toBe(201);
    expect((await send(address, "DELETE", { headers: auth })).status).toBe(204);
    const uploaded = await send(
      "/v1/media",
      "POST",
      upload({ bytes: samplePng({ width: 4, height: 3 }), name: "logo.png" }, {}, auth),
    );
    expect(uploaded.status).toBe(201);
    const media = MediaSchema.parse(await uploaded.json());
    expect((await send(`/v1/media/${media.id}`, "DELETE", { headers: auth })).status).toBe(204);

    expect(
      (await since(start)).map(({ entity, record, action }) => [entity, record, action]),
    ).toEqual([
      ["person", null, "created"],
      ["person", null, "deleted"],
      ["case-study", "routing-engine", "created"],
      ["case-study", "routing-engine", "deleted"],
      ["media", media.id, "created"],
      ["media", media.id, "deleted"],
    ]);
    expect((await changes())[0]?.before).toEqual(media);
    expect(await backend.storedFiles()).toEqual([]);
    await profile.deleteProject("routing-engine");
    await profile.deleteExperience("northwind-lead");
    await profile.deleteOrganization("northwind");
  });

  it("names a diary day by its date and each time entry a write changed by its identifier", async () => {
    const { roadmap } = backend.services;
    await roadmap.createArea({
      slug: "audit-basics",
      name: "Audit basics",
      description: null,
      weight: 10,
      position: 0,
    });
    await roadmap.createModule({
      slug: "audit-module",
      area: "audit-basics",
      name: "Audit module",
      description: null,
      position: 0,
    });
    const resource = { slug: "audit-guide", module: "audit-module", name: "Guide", type: "link" };
    expect(
      (await send("/v1/roadmap/resources", "POST", json({ ...resource, position: 0 }, auth)))
        .status,
    ).toBe(201);
    const start = await newest();

    const notes = json({ notes: "Late reading." }, auth);
    expect((await send("/v1/roadmap/diary/2026-03-02", "PATCH", notes)).status).toBe(200);
    const session = {
      resource: "audit-guide",
      startedAt: "2026-03-02T23:30:00+01:00",
      endedAt: "2026-03-03T00:30:00+01:00",
    };
    const created = await send("/v1/roadmap/time-entries", "POST", json(session, auth));
    expect(created.status).toBe(201);
    const { entries } = (await created.json()) as { entries: { id: string }[] };
    const [first, second] = entries.map((entry) => entry.id);
    const moved = { startedAt: "2026-03-05T08:00:00+01:00", endedAt: "2026-03-05T09:00:00+01:00" };
    expect(
      (await send(`/v1/roadmap/time-entries/${String(first)}`, "PATCH", json(moved, auth))).status,
    ).toBe(200);
    expect(
      (await send(`/v1/roadmap/time-entries/${String(first)}`, "DELETE", { headers: auth })).status,
    ).toBe(204);
    expect((await send("/v1/roadmap/diary/2026-03-02", "DELETE", { headers: auth })).status).toBe(
      204,
    );

    const recorded = await since(start);
    expect(recorded.map(({ entity, record, action }) => [entity, record, action])).toEqual([
      ["roadmap-diary", "2026-03-02", "created"],
      ["roadmap-time-entry", first, "created"],
      ["roadmap-time-entry", second, "created"],
      ["roadmap-time-entry", first, "updated"],
      ["roadmap-time-entry", first, "deleted"],
      // Its only entry moved away, so clearing the notes leaves no day.
      ["roadmap-diary", "2026-03-02", "deleted"],
    ]);
    expect(recorded[3]?.after).toMatchObject({
      id: first,
      startedAt: expect.any(String) as unknown,
    });
    await roadmap.deleteTimeEntry(String(second));
    await roadmap.deleteResource("audit-guide");
    await roadmap.deleteModule("audit-module");
    await roadmap.deleteArea("audit-basics");
  });

  it("audits a logged session per diary day, with the notes and entries before and after", async () => {
    const { roadmap } = backend.services;
    await roadmap.createArea({
      slug: "session-basics",
      name: "Session basics",
      description: null,
      weight: 10,
      position: 0,
    });
    await roadmap.createModule({
      slug: "session-module",
      area: "session-basics",
      name: "Session module",
      description: null,
      position: 0,
    });
    const resource = { slug: "session-guide", module: "session-module", name: "Guide" };
    expect(
      (
        await send(
          "/v1/roadmap/resources",
          "POST",
          json({ ...resource, type: "link", position: 0 }, auth),
        )
      ).status,
    ).toBe(201);
    expect(
      (await send("/v1/roadmap/diary/2026-04-02", "PATCH", json({ notes: "Before." }, auth)))
        .status,
    ).toBe(200);
    const start = await newest();

    const session = {
      resource: "session-guide",
      startedAt: "2026-04-02T23:30:00+02:00",
      endedAt: "2026-04-03T00:30:00+02:00",
      notes: "After.",
    };
    const provenance = { [auditProvenanceHeader]: "mcp-admin/session" };
    const logged = await send(
      "/v1/roadmap/sessions",
      "POST",
      json(session, { ...auth, ...provenance }),
    );
    expect(logged.status).toBe(201);

    const recorded = await since(start);
    expect(recorded.map(({ entity, record, action }) => [entity, record, action])).toEqual([
      ["roadmap-diary", "2026-04-02", "updated"],
      ["roadmap-diary", "2026-04-03", "created"],
    ]);
    expect(recorded.every((change) => change.provenance === "mcp-admin/session")).toBe(true);
    expect(recorded[0]?.before).toMatchObject({ notes: "Before.", entries: [] });
    expect(recorded[0]?.after).toMatchObject({
      notes: "Before.\n\nAfter.",
      entries: [{ resource: { slug: "session-guide" } }],
    });

    for (const day of (await roadmap.getDiary()).days) {
      for (const entry of day.entries) await roadmap.deleteTimeEntry(entry.id);
      if (day.notes !== null) await roadmap.deleteDiaryNotes(day.date);
    }
    await roadmap.deleteResource("session-guide");
    await roadmap.deleteModule("session-module");
    await roadmap.deleteArea("session-basics");
  });

  it("rolls the content back when its audit cannot be stored", async () => {
    const start = await newest();
    const audit: Services["audit"] = {
      recentChanges: () => backend.services.audit.recentChanges(),
      write: <T>(write: AuditedWrite<T>) =>
        backend.services.audit.write({ ...write, actor: { keyId: randomUUID() } }),
    };
    const failing = createApp({
      services: { ...backend.services, audit },
      config: testConfig(),
      log: () => undefined,
    });

    const response = await send("/v1/topics", "POST", json(topic, auth), failing);

    expect(response.status).toBe(500);
    expect((await send("/v1/topics/agents", "GET")).status).toBe(404);
    expect(await since(start)).toEqual([]);
  });

  it("records nothing for a refused, invalid, unauthenticated or read request on any write route", async () => {
    const api = backend.api();
    const start = await newest();
    const writes = api.routes.filter((route) => route.method !== "GET");
    expect(writes.length).toBeGreaterThan(60);

    for (const route of writes) {
      const path = unknownRecordPath(route.path);
      const anonymous = await send(path, route.method, json({}), api);
      expect(anonymous.status, `${route.method} ${route.path}`).toBe(401);
      const refused = await send(path, route.method, json({}, auth), api);
      expect(refused.status, `${route.method} ${route.path}`).toBeGreaterThanOrEqual(400);
      expect(refused.status, `${route.method} ${route.path}`).toBeLessThan(500);
    }
    for (const route of api.routes.filter((read) => read.method === "GET")) {
      await send(unknownRecordPath(route.path), "GET", { headers: auth }, api);
    }

    expect(await since(start)).toEqual([]);
  });

  it("audits every write route it registers, and finds a mutation registered around the audit", () => {
    const api = backend.api();

    for (const route of api.routes) {
      const name = `${route.method} ${route.path}`;
      if (route.method === "GET" || READ_ONLY.has(name)) expect(route.audit, name).toBeNull();
      else expect(route.audit, name).not.toBeNull();
    }
    expect(
      api.routes
        .filter((route) => route.method !== "GET" && route.audit === null)
        .map((route) => `${route.method} ${route.path}`),
    ).toEqual([...READ_ONLY]);
    expect(unauditedMutations(api)).toEqual([]);

    api.app.post("/v1/unaudited", (c) => c.body(null, 204));
    api.app.delete("/v1/topics/:slug/everything", (c) => c.body(null, 204));
    expect(unauditedMutations(api)).toEqual([
      "POST /v1/unaudited",
      "DELETE /v1/topics/:slug/everything",
    ]);
  });

  describe("the recent changes", () => {
    it("are private", async () => {
      expect((await send(CHANGES, "GET")).status).toBe(401);
      expect((await send(CHANGES, "GET", { headers: bearer("sk_fictional") })).status).toBe(401);
    });

    it("return at most the limit, newest first", async () => {
      for (let index = 0; index < recentChangesLimit + 1; index += 1) {
        const body = { slug: `topic-${String(index)}`, name: "Topic", position: index };
        expect((await send("/v1/topics", "POST", json(body, auth))).status).toBe(201);
      }

      const listed = await changes();

      expect(listed).toHaveLength(recentChangesLimit);
      expect(listed[0]?.record).toBe(`topic-${String(recentChangesLimit)}`);
      expect(listed.map((change) => change.id)).toEqual(
        [...listed.map((change) => change.id)].sort((a, b) => b - a),
      );
    });
  });
});
