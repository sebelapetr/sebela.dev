import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  ExplorationListSchema,
  ExplorationSchema,
  explorationStatuses,
  type Exploration,
} from "@sebela/contracts";

import type { WriteEvent } from "./app.js";
import {
  anyText,
  bearer,
  connection,
  json,
  openTestBackend,
  type TestBackend,
} from "./test-support.js";

/** Fictional explorations. */
const agentLab = {
  slug: "agent-lab",
  name: "Agent lab",
  summary: "A **fictional** playground for tool-calling agents.",
  status: "tested",
  concepts: ["Tool calling", "Evaluation loops"],
  startedOn: "2025-02-01",
  endedOn: "2025-06-30",
  position: 1,
  technologies: ["typescript", "postgres"],
  topics: ["agents", "rag"],
};
const vectorNotes = {
  slug: "vector-notes",
  name: "Vector notes",
  summary: "A fictional design for searchable notes.",
  status: "designed",
  startedOn: "2025-03-01",
  position: 0,
};

interface FieldError {
  path: string;
  message: string;
}

describe("the exploration API", () => {
  let backend: TestBackend;
  let auth: Record<string, string>;

  beforeAll(async () => {
    backend = await openTestBackend();
    auth = bearer((await backend.services.apiKeys.createKey("exploration routes")).key);
    const { profile } = backend.services;
    for (const [position, slug] of ["typescript", "postgres", "rust"].entries()) {
      await profile.createTechnology({
        slug,
        name: slug,
        tier: "secondary",
        group: null,
        logoKey: null,
        position,
      });
    }
    for (const [position, slug] of ["agents", "rag", "mcp"].entries()) {
      await profile.createTopic({ slug, name: slug, position });
    }
  });

  afterAll(async () => {
    await backend.close();
  });

  beforeEach(async () => {
    const { profile } = backend.services;
    for (const { slug } of await profile.listExplorations()) {
      await profile.deleteExploration(slug);
    }
  });

  const request = (path: string, method = "GET", init: RequestInit = {}) =>
    backend.api().app.request(path, { method, ...init }, connection());
  const create = (body: object) => request("/v1/explorations", "POST", json(body, auth));

  it("lists no explorations publicly", async () => {
    const response = await request("/v1/explorations");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it("creates an exploration with its address, and reads it publicly with resolved relations", async () => {
    const created = await create(agentLab);

    expect(created.status).toBe(201);
    expect(created.headers.get("location")).toBe("/v1/explorations/agent-lab");
    const body = ExplorationSchema.parse(await created.json());
    const { technologies, topics, ...fields } = agentLab;
    expect(body).toMatchObject(fields);
    expect(body.technologies.map((technology) => technology.slug)).toEqual(technologies);
    expect(body.topics.map((topic) => topic.slug)).toEqual(topics);
    expect(Object.keys(body).sort()).toEqual(
      [...Object.keys(agentLab), "id", "createdAt", "updatedAt"].sort(),
    );

    const read = await request("/v1/explorations/agent-lab");
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual(body);
  });

  it("fills an omitted end, concepts, technologies and topics", async () => {
    const created = ExplorationSchema.parse(await (await create(vectorNotes)).json());

    expect(created).toMatchObject({ endedOn: null, concepts: [], technologies: [], topics: [] });
  });

  it.each(explorationStatuses)(
    "returns the status %s publicly exactly as written",
    async (status) => {
      await create({ ...agentLab, status });

      const read = ExplorationSchema.parse(
        await (await request("/v1/explorations/agent-lab")).json(),
      );
      const listed = ExplorationListSchema.parse(await (await request("/v1/explorations")).json());

      expect(read.status).toBe(status);
      expect(listed.map((exploration) => exploration.status)).toEqual([status]);
    },
  );

  it("lists explorations by position, then slug", async () => {
    for (const exploration of [agentLab, vectorNotes, { ...vectorNotes, slug: "a-sketch" }]) {
      expect((await create(exploration)).status).toBe(201);
    }

    const listed = ExplorationListSchema.parse(await (await request("/v1/explorations")).json());

    expect(listed.map((exploration) => exploration.slug)).toEqual([
      "a-sketch",
      "vector-notes",
      "agent-lab",
    ]);
  });

  it("refuses a duplicate slug with a conflict", async () => {
    await create(agentLab);

    const again = await create(agentLab);

    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: { code: "conflict", message: anyText } });
  });

  it.each([
    ["an unknown status", { ...agentLab, status: "shipped" }, "status"],
    ["a malformed start", { ...agentLab, startedOn: "2025-13-01" }, "startedOn"],
    ["an end before the start", { ...agentLab, endedOn: "2020-01-01" }, "endedOn"],
    ["a repeated technology", { ...agentLab, technologies: ["rust", "rust"] }, "technologies"],
    ["unknown technologies", { ...agentLab, technologies: ["rust", "cobol"] }, "technologies"],
    ["a repeated topic", { ...agentLab, topics: ["mcp", "mcp"] }, "topics"],
    ["unknown topics", { ...agentLab, topics: ["mcp", "quantum"] }, "topics"],
    ["an empty concept", { ...agentLab, concepts: [" "] }, "concepts"],
    ["a missing summary", { ...agentLab, summary: undefined }, "summary"],
    ["an experience", { ...agentLab, experience: "northwind-lead" }, "experience"],
    ["a visibility flag", { ...agentLab, visible: true }, "visible"],
  ])("refuses %s with the field and stores nothing", async (_, body, field) => {
    const response = await create(body);

    expect(response.status).toBe(400);
    const { error } = (await response.json()) as {
      error: { code: string; fields?: FieldError[] };
    };
    expect(error.code).toBe("validation_failed");
    // A known field is named by its path, an array element by a path below it, an unknown field by
    // the message.
    expect(
      error.fields?.some(
        ({ path, message }) =>
          path === field || path.startsWith(`${field}.`) || message.includes(`"${field}"`),
      ),
    ).toBe(true);
    await expect(backend.services.profile.listExplorations()).resolves.toEqual([]);
  });

  it("updates only the given fields and keeps the relations when they are omitted", async () => {
    const created = (await (await create(agentLab)).json()) as Exploration;

    const response = await request(
      "/v1/explorations/agent-lab",
      "PATCH",
      json({ status: "built", endedOn: null }, auth),
    );

    expect(response.status).toBe(200);
    const updated = ExplorationSchema.parse(await response.json());
    expect(updated).toMatchObject({
      status: "built",
      endedOn: null,
      name: agentLab.name,
      concepts: agentLab.concepts,
      id: created.id,
      createdAt: created.createdAt,
    });
    expect(updated.technologies).toEqual(created.technologies);
    expect(updated.topics).toEqual(created.topics);
    expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt));
  });

  it("replaces the concepts, technologies and topics with given lists, in their order", async () => {
    await create(agentLab);

    const replaced = ExplorationSchema.parse(
      await (
        await request(
          "/v1/explorations/agent-lab",
          "PATCH",
          json(
            {
              concepts: ["Planning", "Memory"],
              technologies: ["rust", "typescript"],
              topics: ["mcp", "agents"],
            },
            auth,
          ),
        )
      ).json(),
    );
    const cleared = ExplorationSchema.parse(
      await (
        await request(
          "/v1/explorations/agent-lab",
          "PATCH",
          json({ concepts: [], technologies: [], topics: [] }, auth),
        )
      ).json(),
    );

    expect(replaced.concepts).toEqual(["Planning", "Memory"]);
    expect(replaced.technologies.map(({ slug }) => slug)).toEqual(["rust", "typescript"]);
    expect(replaced.topics.map(({ slug }) => slug)).toEqual(["mcp", "agents"]);
    expect(cleared).toMatchObject({ concepts: [], technologies: [], topics: [] });
  });

  it.each([
    ["a change of the slug", { slug: "renamed" }, undefined],
    ["an empty change", {}, undefined],
    ["an unknown status", { status: "delivered" }, "status"],
    ["an end before the stored start", { endedOn: "2020-01-01" }, "endedOn"],
    ["unknown technologies", { name: "Changed", technologies: ["cobol"] }, "technologies"],
    ["unknown topics", { name: "Changed", topics: ["mcp", "quantum"] }, "topics"],
  ])("refuses an update with %s and changes nothing", async (_, body, field) => {
    const created = await (await create(agentLab)).json();

    const response = await request("/v1/explorations/agent-lab", "PATCH", json(body, auth));

    expect(response.status).toBe(400);
    const { error } = (await response.json()) as {
      error: { code: string; fields?: FieldError[] };
    };
    expect(error.code).toBe("validation_failed");
    if (field) expect(error.fields).toEqual([expect.objectContaining({ path: field })]);
    expect(await (await request("/v1/explorations/agent-lab")).json()).toEqual(created);
  });

  it("answers a missing exploration with not found", async () => {
    for (const response of [
      await request("/v1/explorations/missing"),
      await request("/v1/explorations/missing", "PATCH", json({ name: "X" }, auth)),
      await request("/v1/explorations/missing", "DELETE", { headers: auth }),
    ]) {
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: { code: "not_found", message: anyText } });
    }
  });

  it("refuses a malformed slug in the path with the field", async () => {
    for (const response of [
      await request("/v1/explorations/Not%20A%20Slug"),
      await request("/v1/explorations/agent.lab", "PATCH", json({ name: "X" }, auth)),
      await request("/v1/explorations/UPPER", "DELETE", { headers: auth }),
    ]) {
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: {
          code: "validation_failed",
          message: anyText,
          fields: [expect.objectContaining({ path: "slug" })],
        },
      });
    }
  });

  it("checks the key before the path and the body", async () => {
    expect((await request("/v1/explorations/Not%20A%20Slug", "DELETE")).status).toBe(401);
    expect((await request("/v1/explorations/agent-lab", "PATCH", json({}))).status).toBe(401);
    expect((await request("/v1/explorations", "POST", json(agentLab))).status).toBe(401);
    await expect(backend.services.profile.listExplorations()).resolves.toEqual([]);
  });

  it("refuses to delete a technology or a topic an exploration links", async () => {
    await create(agentLab);

    for (const response of [
      await request("/v1/technologies/postgres", "DELETE", { headers: auth }),
      await request("/v1/topics/rag", "DELETE", { headers: auth }),
    ]) {
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: { code: "conflict", message: anyText } });
    }
    expect((await request("/v1/technologies/postgres")).status).toBe(200);
    expect((await request("/v1/topics/rag")).status).toBe(200);
  });

  it("stays outside the career timeline", async () => {
    await create(agentLab);

    expect(await (await request("/v1/experiences")).json()).toEqual([]);
    expect(await (await request("/v1/projects")).json()).toEqual([]);
  });

  it("deletes an exploration with the key, keeps its technologies and topics, and reports each write", async () => {
    const events: WriteEvent[] = [];
    const { app } = backend.api({
      onWrite: (event) => {
        events.push(event);
        return Promise.resolve();
      },
    });
    await app.request(
      "/v1/explorations",
      { method: "POST", ...json(agentLab, auth) },
      connection(),
    );

    const deleted = await app.request(
      "/v1/explorations/agent-lab",
      { method: "DELETE", headers: auth },
      connection(),
    );

    expect(deleted.status).toBe(204);
    expect(await deleted.text()).toBe("");
    expect(events).toEqual([
      {
        operationId: "createExploration",
        method: "POST",
        path: "/v1/explorations",
        change: { domain: "exploration", record: "agent-lab", action: "created" },
      },
      {
        operationId: "deleteExploration",
        method: "DELETE",
        path: "/v1/explorations/agent-lab",
        change: { domain: "exploration", record: "agent-lab", action: "deleted" },
      },
    ]);
    expect((await request("/v1/explorations/agent-lab")).status).toBe(404);
    expect((await request("/v1/technologies/postgres")).status).toBe(200);
    expect((await request("/v1/topics/rag")).status).toBe(200);
  });
});
