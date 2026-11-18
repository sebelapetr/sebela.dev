import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  EducationListSchema,
  EducationSchema,
  educationKinds,
  type Education,
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

/** Fictional education records. */
const harbourTech = {
  slug: "harbour-tech",
  kind: "school",
  title: "Software engineering",
  institution: "Harbour Technical College",
  startedOn: "2008-09-01",
  endedOn: "2012-06-30",
  description: "A **fictional** degree used in tests.",
  position: 1,
};
const cloudAssociate = {
  slug: "cloud-associate",
  kind: "certification",
  title: "Cloud associate",
  endedOn: "2021-05-14",
  position: 0,
};

interface FieldError {
  path: string;
  message: string;
}

describe("the education API", () => {
  let backend: TestBackend;
  let auth: Record<string, string>;

  beforeAll(async () => {
    backend = await openTestBackend();
    auth = bearer((await backend.services.apiKeys.createKey("education routes")).key);
  });

  afterAll(async () => {
    await backend.close();
  });

  beforeEach(async () => {
    const { profile } = backend.services;
    for (const { slug } of await profile.listEducation()) {
      await profile.deleteEducation(slug);
    }
  });

  const request = (path: string, method = "GET", init: RequestInit = {}) =>
    backend.api().app.request(path, { method, ...init }, connection());
  const create = (body: object) => request("/v1/education", "POST", json(body, auth));

  it("lists no education publicly", async () => {
    const response = await request("/v1/education");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it("creates an education record with its address, and reads it publicly", async () => {
    const created = await create(harbourTech);

    expect(created.status).toBe(201);
    expect(created.headers.get("location")).toBe("/v1/education/harbour-tech");
    const body = EducationSchema.parse(await created.json());
    expect(body).toMatchObject(harbourTech);
    expect(Object.keys(body).sort()).toEqual(
      [...Object.keys(harbourTech), "id", "createdAt", "updatedAt"].sort(),
    );

    const read = await request("/v1/education/harbour-tech");
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual(body);
  });

  it("fills an omitted institution, start and description with null", async () => {
    const created = EducationSchema.parse(await (await create(cloudAssociate)).json());

    expect(created).toMatchObject({
      institution: null,
      startedOn: null,
      endedOn: "2021-05-14",
      description: null,
    });
  });

  it("accepts ongoing learning with a start and no end", async () => {
    const response = await create({ ...harbourTech, endedOn: null });

    expect(response.status).toBe(201);
    expect(EducationSchema.parse(await response.json())).toMatchObject({ endedOn: null });
  });

  it.each(educationKinds)("returns the kind %s publicly exactly as written", async (kind) => {
    await create({ ...harbourTech, kind });

    const read = EducationSchema.parse(await (await request("/v1/education/harbour-tech")).json());
    const listed = EducationListSchema.parse(await (await request("/v1/education")).json());

    expect(read.kind).toBe(kind);
    expect(listed.map((education) => education.kind)).toEqual([kind]);
  });

  it("lists education by position, then slug", async () => {
    for (const education of [
      harbourTech,
      cloudAssociate,
      { ...cloudAssociate, slug: "data-course", kind: "course" },
    ]) {
      expect((await create(education)).status).toBe(201);
    }

    const listed = EducationListSchema.parse(await (await request("/v1/education")).json());

    expect(listed.map((education) => education.slug)).toEqual([
      "cloud-associate",
      "data-course",
      "harbour-tech",
    ]);
  });

  it("refuses a duplicate slug with a conflict", async () => {
    await create(harbourTech);

    const again = await create(harbourTech);

    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: { code: "conflict", message: anyText } });
  });

  it.each([
    ["an unknown kind", { ...harbourTech, kind: "bootcamp" }, "kind"],
    ["a missing title", { ...harbourTech, title: undefined }, "title"],
    ["a title that is too long", { ...harbourTech, title: "x".repeat(201) }, "title"],
    ["an empty institution", { ...harbourTech, institution: " " }, "institution"],
    ["a malformed start", { ...harbourTech, startedOn: "2008-13-01" }, "startedOn"],
    ["an end before the start", { ...harbourTech, endedOn: "2000-01-01" }, "endedOn"],
    ["no date at all", { ...harbourTech, startedOn: null, endedOn: undefined }, "startedOn"],
    ["a negative position", { ...harbourTech, position: -1 }, "position"],
    ["an experience", { ...harbourTech, experience: "northwind-lead" }, "experience"],
    ["a visibility flag", { ...harbourTech, visible: true }, "visible"],
  ])("refuses %s with the field and stores nothing", async (_, body, field) => {
    const response = await create(body);

    expect(response.status).toBe(400);
    const { error } = (await response.json()) as {
      error: { code: string; fields?: FieldError[] };
    };
    expect(error.code).toBe("validation_failed");
    // A known field is named by its path, an unknown field by the message.
    expect(
      error.fields?.some(({ path, message }) => path === field || message.includes(`"${field}"`)),
    ).toBe(true);
    await expect(backend.services.profile.listEducation()).resolves.toEqual([]);
  });

  it("refuses a description that is too long", async () => {
    const response = await create({ ...harbourTech, description: "x".repeat(5001) });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "validation_failed",
        message: anyText,
        fields: [expect.objectContaining({ path: "description" })],
      },
    });
  });

  it("updates only the given fields", async () => {
    const created = (await (await create(harbourTech)).json()) as Education;

    const response = await request(
      "/v1/education/harbour-tech",
      "PATCH",
      json({ kind: "course", endedOn: null, institution: null }, auth),
    );

    expect(response.status).toBe(200);
    const updated = EducationSchema.parse(await response.json());
    expect(updated).toMatchObject({
      kind: "course",
      endedOn: null,
      institution: null,
      title: harbourTech.title,
      startedOn: harbourTech.startedOn,
      id: created.id,
      slug: created.slug,
      createdAt: created.createdAt,
    });
    expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt));
  });

  it.each([
    ["a change of the slug", { slug: "renamed" }, undefined],
    ["an empty change", {}, undefined],
    ["an unknown kind", { kind: "diploma" }, ["kind"]],
    ["an end before the stored start", { endedOn: "2000-01-01" }, ["endedOn"]],
    ["a start after the stored end", { startedOn: "2020-01-01" }, ["endedOn"]],
    ["clearing both dates", { startedOn: null, endedOn: null }, ["startedOn", "endedOn"]],
  ])("refuses an update with %s and changes nothing", async (_, body, fields) => {
    const created = await (await create(harbourTech)).json();

    const response = await request("/v1/education/harbour-tech", "PATCH", json(body, auth));

    expect(response.status).toBe(400);
    const { error } = (await response.json()) as {
      error: { code: string; fields?: FieldError[] };
    };
    expect(error.code).toBe("validation_failed");
    if (fields) {
      expect(error.fields?.map(({ path }) => path)).toEqual(fields);
    }
    expect(await (await request("/v1/education/harbour-tech")).json()).toEqual(created);
  });

  it("refuses clearing the only stored date, naming both dates", async () => {
    const created = await (await create(cloudAssociate)).json();

    const response = await request(
      "/v1/education/cloud-associate",
      "PATCH",
      json({ endedOn: null }, auth),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "validation_failed",
        message: anyText,
        fields: [
          { path: "startedOn", message: anyText },
          { path: "endedOn", message: anyText },
        ],
      },
    });
    expect(await (await request("/v1/education/cloud-associate")).json()).toEqual(created);
  });

  it("answers a missing education record with not found", async () => {
    for (const response of [
      await request("/v1/education/missing"),
      await request("/v1/education/missing", "PATCH", json({ title: "X" }, auth)),
      await request("/v1/education/missing", "DELETE", { headers: auth }),
    ]) {
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: { code: "not_found", message: anyText } });
    }
  });

  it("refuses a malformed slug in the path with the field", async () => {
    for (const response of [
      await request("/v1/education/Not%20A%20Slug"),
      await request("/v1/education/harbour.tech", "PATCH", json({ title: "X" }, auth)),
      await request("/v1/education/UPPER", "DELETE", { headers: auth }),
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
    expect((await request("/v1/education/Not%20A%20Slug", "DELETE")).status).toBe(401);
    expect((await request("/v1/education/harbour-tech", "PATCH", json({}))).status).toBe(401);
    expect((await request("/v1/education", "POST", json(harbourTech))).status).toBe(401);
    await expect(backend.services.profile.listEducation()).resolves.toEqual([]);
  });

  it("stays outside the career timeline", async () => {
    await create(harbourTech);

    expect(await (await request("/v1/experiences")).json()).toEqual([]);
    expect(await (await request("/v1/projects")).json()).toEqual([]);
    expect(await (await request("/v1/explorations")).json()).toEqual([]);
  });

  it("deletes an education record with the key and reports each write", async () => {
    const events: WriteEvent[] = [];
    const { app } = backend.api({
      onWrite: (event) => {
        events.push(event);
        return Promise.resolve();
      },
    });
    await app.request(
      "/v1/education",
      { method: "POST", ...json(harbourTech, auth) },
      connection(),
    );
    await app.request(
      "/v1/education/harbour-tech",
      { method: "PATCH", ...json({ title: "Changed" }, auth) },
      connection(),
    );

    const deleted = await app.request(
      "/v1/education/harbour-tech",
      { method: "DELETE", headers: auth },
      connection(),
    );

    expect(deleted.status).toBe(204);
    expect(await deleted.text()).toBe("");
    expect(events).toEqual([
      {
        operationId: "createEducation",
        method: "POST",
        path: "/v1/education",
        change: { domain: "education", record: "harbour-tech", action: "created" },
      },
      {
        operationId: "updateEducation",
        method: "PATCH",
        path: "/v1/education/harbour-tech",
        change: { domain: "education", record: "harbour-tech", action: "updated" },
      },
      {
        operationId: "deleteEducation",
        method: "DELETE",
        path: "/v1/education/harbour-tech",
        change: { domain: "education", record: "harbour-tech", action: "deleted" },
      },
    ]);
    expect((await request("/v1/education/harbour-tech")).status).toBe(404);
  });
});
