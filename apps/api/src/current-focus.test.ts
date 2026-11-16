import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { CurrentFocusListSchema, CurrentFocusSchema, type CurrentFocus } from "@sebela/contracts";

import type { WriteEvent } from "./app.js";
import {
  anyText,
  bearer,
  connection,
  json,
  openTestBackend,
  type TestBackend,
} from "./test-support.js";

/** A fictional focus entry about a project, with topics. */
const evalHarness = {
  slug: "eval-harness",
  title: "An evaluation harness for agents",
  description: "Building a **fictional** harness that scores tool-calling agents.",
  link: "https://example.com/eval-harness",
  position: 1,
  project: "route-planner",
  topics: ["rag", "agents"],
};
/** A fictional focus entry with only its required fields. */
const learning = {
  slug: "learning-rust",
  title: "Learning Rust",
  description: "Working through a fictional book.",
  position: 0,
};

interface FieldError {
  path: string;
  message: string;
}

describe("the current-focus API", () => {
  let backend: TestBackend;
  let auth: Record<string, string>;

  beforeAll(async () => {
    backend = await openTestBackend();
    auth = bearer((await backend.services.apiKeys.createKey("current-focus routes")).key);
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
      title: "Engineer",
      kind: "main_job",
      organization: "northwind",
      summary: "A fictional role.",
      responsibilities: [],
      inCv: true,
      technologies: [],
      startedOn: "2021-03-01",
      endedOn: null,
    });
    const project = {
      experience: "northwind-lead",
      summary: "A fictional project.",
      problem: "A fictional problem.",
      workDone: "Fictional work.",
      result: "A fictional result.",
      startedOn: "2022-01-01",
      endedOn: null,
      links: [],
      selectedForHomepage: false,
      position: 0,
      technologies: [],
    };
    await profile.createProject({
      coverId: null,
      ...project,
      slug: "route-planner",
      name: "Route planner",
    });
    await profile.createProject({
      coverId: null,
      ...project,
      slug: "fleet-board",
      name: "Fleet board",
    });
    for (const [position, slug] of ["agents", "rag", "evals"].entries()) {
      await profile.createTopic({ slug, name: slug.toUpperCase(), position });
    }
  });

  afterAll(async () => {
    await backend.close();
  });

  beforeEach(async () => {
    const { profile } = backend.services;
    for (const { slug } of await profile.listCurrentFocus()) {
      await profile.deleteCurrentFocus(slug);
    }
  });

  const request = (path: string, method = "GET", init: RequestInit = {}) =>
    backend.api().app.request(path, { method, ...init }, connection());
  const create = (body: object) => request("/v1/current-focus", "POST", json(body, auth));

  it("lists no focus entries publicly", async () => {
    const response = await request("/v1/current-focus");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it("creates an unlinked entry with its address, filling the link, project and topics", async () => {
    const created = await create(learning);

    expect(created.status).toBe(201);
    expect(created.headers.get("location")).toBe("/v1/current-focus/learning-rust");
    const body = CurrentFocusSchema.parse(await created.json());
    expect(body).toMatchObject({ ...learning, link: null, project: null, topics: [] });
    // No visibility flag: a focus entry is public content.
    expect(Object.keys(body).sort()).toEqual(
      [
        ...Object.keys(learning),
        "link",
        "project",
        "topics",
        "id",
        "createdAt",
        "updatedAt",
      ].sort(),
    );

    const read = await request("/v1/current-focus/learning-rust");
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual(body);
  });

  it("creates a linked entry and reads its project and topics publicly", async () => {
    const created = await create(evalHarness);

    expect(created.status).toBe(201);
    const body = CurrentFocusSchema.parse(await created.json());
    expect(body.project).toEqual({
      slug: "route-planner",
      name: "Route planner",
      experience: "northwind-lead",
    });
    expect(body.topics.map(({ slug }) => slug)).toEqual(["rag", "agents"]);
    expect(body.link).toBe(evalHarness.link);
    expect(await (await request("/v1/current-focus/eval-harness")).json()).toEqual(body);
  });

  it("lists the entries by position, then slug", async () => {
    for (const focus of [evalHarness, learning, { ...learning, slug: "a-sketch", position: 1 }]) {
      expect((await create(focus)).status).toBe(201);
    }

    const listed = CurrentFocusListSchema.parse(await (await request("/v1/current-focus")).json());

    expect(listed.map(({ slug }) => slug)).toEqual(["learning-rust", "a-sketch", "eval-harness"]);
  });

  it("refuses a duplicate slug with a conflict", async () => {
    await create(learning);

    const again = await create({ ...evalHarness, slug: learning.slug });

    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: { code: "conflict", message: anyText } });
  });

  it.each([
    ["a missing title", { ...evalHarness, title: undefined }, "title"],
    ["a missing description", { ...evalHarness, description: undefined }, "description"],
    ["a script link", { ...evalHarness, link: "javascript:alert(1)" }, "link"],
    ["a link that is not http", { ...evalHarness, link: "ftp://example.com/x" }, "link"],
    ["an unknown project", { ...evalHarness, project: "missing" }, "project"],
    ["an embedded project", { ...evalHarness, project: { slug: "route-planner" } }, "project"],
    ["a repeated topic", { ...evalHarness, topics: ["rag", "rag"] }, "topics"],
    ["unknown topics", { ...evalHarness, topics: ["rag", "quantum"] }, "topics"],
    ["a negative position", { ...evalHarness, position: -1 }, "position"],
    ["a visibility flag", { ...evalHarness, visible: true }, "visible"],
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
    await expect(backend.services.profile.listCurrentFocus()).resolves.toEqual([]);
  });

  it("updates only the given fields and keeps the project and topics when they are omitted", async () => {
    const created = (await (await create(evalHarness)).json()) as CurrentFocus;

    const response = await request(
      "/v1/current-focus/eval-harness",
      "PATCH",
      json({ title: "Renamed" }, auth),
    );

    expect(response.status).toBe(200);
    const updated = CurrentFocusSchema.parse(await response.json());
    expect(updated).toEqual({ ...created, title: "Renamed", updatedAt: updated.updatedAt });
    expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt));
  });

  it("replaces the project and topics, then clears the project, link and topics", async () => {
    await create(evalHarness);
    const patch = async (body: object) =>
      CurrentFocusSchema.parse(
        await (await request("/v1/current-focus/eval-harness", "PATCH", json(body, auth))).json(),
      );

    const replaced = await patch({ project: "fleet-board", topics: ["evals", "agents"] });
    const cleared = await patch({ project: null, link: null, topics: [] });

    expect(replaced.project?.slug).toBe("fleet-board");
    expect(replaced.topics.map(({ slug }) => slug)).toEqual(["evals", "agents"]);
    expect(cleared).toMatchObject({ project: null, link: null, topics: [] });
  });

  it.each([
    ["a change of the slug", { slug: "renamed" }, undefined],
    ["an empty change", {}, undefined],
    ["clearing the topics with null", { topics: null }, "topics"],
    ["an unknown project", { title: "Changed", project: "missing" }, "project"],
    ["unknown topics", { title: "Changed", topics: ["rag", "quantum"] }, "topics"],
  ])("refuses an update with %s and changes nothing", async (_, body, field) => {
    const created = await (await create(evalHarness)).json();

    const response = await request("/v1/current-focus/eval-harness", "PATCH", json(body, auth));

    expect(response.status).toBe(400);
    const { error } = (await response.json()) as {
      error: { code: string; fields?: FieldError[] };
    };
    expect(error.code).toBe("validation_failed");
    if (field) expect(error.fields).toEqual([expect.objectContaining({ path: field })]);
    expect(await (await request("/v1/current-focus/eval-harness")).json()).toEqual(created);
  });

  it("answers a missing entry with not found", async () => {
    for (const response of [
      await request("/v1/current-focus/missing"),
      await request("/v1/current-focus/missing", "PATCH", json({ title: "X" }, auth)),
      await request("/v1/current-focus/missing", "DELETE", { headers: auth }),
    ]) {
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: { code: "not_found", message: anyText } });
    }
  });

  it("refuses a malformed slug in the path with the field", async () => {
    for (const response of [
      await request("/v1/current-focus/Not%20A%20Slug"),
      await request("/v1/current-focus/eval.harness", "PATCH", json({ title: "X" }, auth)),
      await request("/v1/current-focus/UPPER", "DELETE", { headers: auth }),
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
    expect((await request("/v1/current-focus/Not%20A%20Slug", "DELETE")).status).toBe(401);
    expect((await request("/v1/current-focus/eval-harness", "PATCH", json({}))).status).toBe(401);
    expect((await request("/v1/current-focus", "POST", json(evalHarness))).status).toBe(401);
    await expect(backend.services.profile.listCurrentFocus()).resolves.toEqual([]);
  });

  it("refuses to delete a project or a topic a focus entry links", async () => {
    await create(evalHarness);

    for (const response of [
      await request("/v1/projects/route-planner", "DELETE", { headers: auth }),
      await request("/v1/topics/rag", "DELETE", { headers: auth }),
    ]) {
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: { code: "conflict", message: anyText } });
    }
    expect((await request("/v1/projects/route-planner")).status).toBe(200);
    expect((await request("/v1/topics/rag")).status).toBe(200);
  });

  it("deletes an entry with the key, keeps its project and topics, and reports each write", async () => {
    const events: WriteEvent[] = [];
    const { app } = backend.api({
      onWrite: (event) => {
        events.push(event);
        return Promise.resolve();
      },
    });
    await app.request(
      "/v1/current-focus",
      { method: "POST", ...json(evalHarness, auth) },
      connection(),
    );

    const deleted = await app.request(
      "/v1/current-focus/eval-harness",
      { method: "DELETE", headers: auth },
      connection(),
    );

    expect(deleted.status).toBe(204);
    expect(await deleted.text()).toBe("");
    expect(events).toEqual([
      { operationId: "createCurrentFocus", method: "POST", path: "/v1/current-focus" },
      {
        operationId: "deleteCurrentFocus",
        method: "DELETE",
        path: "/v1/current-focus/eval-harness",
      },
    ]);
    expect((await request("/v1/current-focus/eval-harness")).status).toBe(404);
    expect((await request("/v1/projects/route-planner")).status).toBe(200);
    expect((await request("/v1/topics/rag")).status).toBe(200);
  });
});
