import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ExperienceListSchema, ExperienceSchema, type Experience } from "@sebela/contracts";

import type { WriteEvent } from "./app.js";
import {
  anyText,
  bearer,
  connection,
  json,
  openTestBackend,
  type TestBackend,
} from "./test-support.js";

/** Fictional experiences of fictional organizations. */
const lead = {
  slug: "northwind-lead",
  title: "Lead Engineer",
  kind: "main_job",
  organization: "northwind",
  startedOn: "2021-03-01",
  endedOn: "2024-06-30",
  summary: "Led a **fictional** logistics platform.",
  responsibilities: ["Designed the routing service", "Mentored two engineers"],
  inCv: true,
  technologies: ["typescript", "postgres"],
};
const founder = {
  slug: "acme-founder",
  title: "Founder",
  kind: "own_business",
  organization: "acme",
  startedOn: "2023-01-01",
  summary: "Runs a fictional studio.",
  inCv: false,
};

interface FieldError {
  path: string;
  message: string;
}

describe("the experience API", () => {
  let backend: TestBackend;
  let auth: Record<string, string>;

  beforeAll(async () => {
    backend = await openTestBackend();
    auth = bearer((await backend.services.apiKeys.createKey("experience routes")).key);
    const { profile } = backend.services;
    await profile.createOrganization({
      slug: "northwind",
      name: "Northwind Example",
      website: null,
      description: null,
    });
    await profile.createOrganization({
      slug: "acme",
      name: "Acme",
      website: null,
      description: null,
    });
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
  });

  afterAll(async () => {
    await backend.close();
  });

  beforeEach(async () => {
    const { profile } = backend.services;
    for (const { slug } of await profile.listExperiences()) {
      await profile.deleteExperience(slug);
    }
  });

  const request = (path: string, method = "GET", init: RequestInit = {}) =>
    backend.api().app.request(path, { method, ...init }, connection());
  const create = (body: object) => request("/v1/experiences", "POST", json(body, auth));

  it("lists no experiences publicly", async () => {
    const response = await request("/v1/experiences");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it("creates an experience with its address, and reads it publicly with resolved relations", async () => {
    const created = await create(lead);

    expect(created.status).toBe(201);
    expect(created.headers.get("location")).toBe("/v1/experiences/northwind-lead");
    const body = ExperienceSchema.parse(await created.json());
    const { organization, technologies, ...fields } = lead;
    expect(body).toMatchObject(fields);
    expect(body.organization).toMatchObject({ slug: organization, name: "Northwind Example" });
    expect(body.technologies.map((technology) => technology.slug)).toEqual(technologies);
    expect(Object.keys(body).sort()).toEqual(
      [...Object.keys(lead), "id", "projects", "testimonials", "createdAt", "updatedAt"].sort(),
    );
    expect(body.projects).toEqual([]);
    expect(body.testimonials).toEqual([]);

    const read = await request("/v1/experiences/northwind-lead");
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual(body);
  });

  it("fills an omitted end, responsibilities and technologies as a current role without links", async () => {
    const created = ExperienceSchema.parse(await (await create(founder)).json());

    expect(created).toMatchObject({ endedOn: null, responsibilities: [], technologies: [] });
  });

  it("lists current roles first, then the latest start, the latest end and the slug", async () => {
    for (const experience of [
      lead,
      founder,
      { ...lead, slug: "northwind-junior", startedOn: "2018-01-01", endedOn: "2021-02-28" },
      { ...lead, slug: "northwind-contract", startedOn: "2018-01-01", endedOn: "2019-12-31" },
      { ...lead, slug: "a-same", startedOn: "2018-01-01", endedOn: "2019-12-31" },
      { ...founder, slug: "acme-advisor", startedOn: "2020-05-01" },
    ]) {
      expect((await create(experience)).status).toBe(201);
    }

    const listed = ExperienceListSchema.parse(await (await request("/v1/experiences")).json());

    expect(listed.map((experience) => experience.slug)).toEqual([
      "acme-founder",
      "acme-advisor",
      "northwind-lead",
      "northwind-junior",
      "a-same",
      "northwind-contract",
    ]);
  });

  it("refuses a duplicate slug with a conflict", async () => {
    await create(lead);

    const again = await create(lead);

    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: { code: "conflict", message: anyText } });
  });

  it.each([
    ["an unknown kind", { ...lead, kind: "internship" }, "kind"],
    ["a malformed start", { ...lead, startedOn: "2021-13-01" }, "startedOn"],
    ["an end before the start", { ...lead, endedOn: "2020-01-01" }, "endedOn"],
    ["a repeated technology", { ...lead, technologies: ["rust", "rust"] }, "technologies"],
    ["an unknown organization", { ...lead, organization: "missing" }, "organization"],
    ["unknown technologies", { ...lead, technologies: ["rust", "cobol"] }, "technologies"],
    ["a missing title", { ...lead, title: undefined }, "title"],
    ["an unknown field", { ...lead, position: 1 }, "position"],
  ])("refuses %s with the field and stores nothing", async (_, body, field) => {
    const response = await create(body);

    expect(response.status).toBe(400);
    const { error } = (await response.json()) as {
      error: { code: string; fields?: FieldError[] };
    };
    expect(error.code).toBe("validation_failed");
    // A known field is named by its path; an unknown one by the message.
    expect(
      error.fields?.some(({ path, message }) => path === field || message.includes(`"${field}"`)),
    ).toBe(true);
    await expect(backend.services.profile.listExperiences()).resolves.toEqual([]);
  });

  it("updates only the given fields and keeps the technologies when they are omitted", async () => {
    const created = (await (await create(lead)).json()) as Experience;

    const response = await request(
      "/v1/experiences/northwind-lead",
      "PATCH",
      json({ endedOn: null, organization: "acme" }, auth),
    );

    expect(response.status).toBe(200);
    const updated = ExperienceSchema.parse(await response.json());
    expect(updated).toMatchObject({
      endedOn: null,
      title: lead.title,
      id: created.id,
      createdAt: created.createdAt,
    });
    expect(updated.organization.slug).toBe("acme");
    expect(updated.technologies).toEqual(created.technologies);
    expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt));
  });

  it("replaces the technologies with a given list, in its order", async () => {
    await create(lead);

    const replaced = await request(
      "/v1/experiences/northwind-lead",
      "PATCH",
      json({ technologies: ["rust", "typescript"] }, auth),
    );
    const cleared = await request(
      "/v1/experiences/northwind-lead",
      "PATCH",
      json({ technologies: [] }, auth),
    );

    expect(
      ExperienceSchema.parse(await replaced.json()).technologies.map(({ slug }) => slug),
    ).toEqual(["rust", "typescript"]);
    expect(ExperienceSchema.parse(await cleared.json()).technologies).toEqual([]);
  });

  it.each([
    ["a change of the slug", { slug: "renamed" }, undefined],
    ["an empty change", {}, undefined],
    ["an end before the stored start", { endedOn: "2020-01-01" }, "endedOn"],
    ["an unknown organization", { title: "Changed", organization: "missing" }, "organization"],
    ["unknown technologies", { title: "Changed", technologies: ["cobol"] }, "technologies"],
  ])("refuses an update with %s and changes nothing", async (_, body, field) => {
    const created = await (await create(lead)).json();

    const response = await request("/v1/experiences/northwind-lead", "PATCH", json(body, auth));

    expect(response.status).toBe(400);
    const { error } = (await response.json()) as {
      error: { code: string; fields?: FieldError[] };
    };
    expect(error.code).toBe("validation_failed");
    if (field) expect(error.fields).toEqual([expect.objectContaining({ path: field })]);
    expect(await (await request("/v1/experiences/northwind-lead")).json()).toEqual(created);
  });

  it("answers a missing experience with not found", async () => {
    for (const response of [
      await request("/v1/experiences/missing"),
      await request("/v1/experiences/missing", "PATCH", json({ title: "X" }, auth)),
      await request("/v1/experiences/missing", "DELETE", { headers: auth }),
    ]) {
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: { code: "not_found", message: anyText } });
    }
  });

  it("refuses a malformed slug in the path with the field", async () => {
    for (const response of [
      await request("/v1/experiences/Not%20A%20Slug"),
      await request("/v1/experiences/north.wind", "PATCH", json({ title: "X" }, auth)),
      await request("/v1/experiences/UPPER", "DELETE", { headers: auth }),
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
    expect((await request("/v1/experiences/Not%20A%20Slug", "DELETE")).status).toBe(401);
    expect((await request("/v1/experiences/northwind-lead", "PATCH", json({}))).status).toBe(401);
    expect((await request("/v1/experiences", "POST", json(lead))).status).toBe(401);
    await expect(backend.services.profile.listExperiences()).resolves.toEqual([]);
  });

  it("refuses to delete an organization or a technology an experience uses", async () => {
    await create(lead);

    for (const response of [
      await request("/v1/organizations/northwind", "DELETE", { headers: auth }),
      await request("/v1/technologies/postgres", "DELETE", { headers: auth }),
    ]) {
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: { code: "conflict", message: anyText } });
    }
    expect((await request("/v1/organizations/northwind")).status).toBe(200);
    expect((await request("/v1/technologies/postgres")).status).toBe(200);
  });

  it("deletes an experience with the key, keeps its organization and technologies, and reports each write", async () => {
    const events: WriteEvent[] = [];
    const { app } = backend.api({
      onWrite: (event) => {
        events.push(event);
        return Promise.resolve();
      },
    });
    await app.request("/v1/experiences", { method: "POST", ...json(lead, auth) }, connection());

    const deleted = await app.request(
      "/v1/experiences/northwind-lead",
      { method: "DELETE", headers: auth },
      connection(),
    );

    expect(deleted.status).toBe(204);
    expect(await deleted.text()).toBe("");
    expect(events).toEqual([
      { operationId: "createExperience", method: "POST", path: "/v1/experiences" },
      { operationId: "deleteExperience", method: "DELETE", path: "/v1/experiences/northwind-lead" },
    ]);
    expect((await request("/v1/experiences/northwind-lead")).status).toBe(404);
    expect((await request("/v1/organizations/northwind")).status).toBe(200);
    expect((await request("/v1/technologies/postgres")).status).toBe(200);
  });
});
