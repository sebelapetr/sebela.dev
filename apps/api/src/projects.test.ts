import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  ExperienceSchema,
  ProjectListSchema,
  ProjectSchema,
  type Project,
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

/** Fictional projects of fictional experiences. */
const routing = {
  slug: "routing-engine",
  experience: "northwind-lead",
  name: "Routing engine",
  summary: "A **fictional** route planner for delivery vans.",
  problem: "Dispatchers planned routes by hand.",
  workDone: "Designed and built the planning service.",
  result: "Routes are planned in minutes.",
  startedOn: "2022-01-01",
  endedOn: "2022-09-30",
  links: [{ label: "Product page", url: "https://example.com/routing" }],
  selectedForHomepage: true,
  position: 1,
  technologies: ["typescript", "postgres"],
};
const fleet = {
  slug: "fleet-dashboard",
  experience: "northwind-lead",
  name: "Fleet dashboard",
  summary: "A fictional dashboard of the vans.",
  problem: "Nobody saw where the vans were.",
  workDone: "Built the live map.",
  result: "Dispatchers see every van.",
  startedOn: "2023-02-01",
  position: 2,
};

interface FieldError {
  path: string;
  message: string;
}

describe("the project API", () => {
  let backend: TestBackend;
  let auth: Record<string, string>;

  beforeAll(async () => {
    backend = await openTestBackend();
    auth = bearer((await backend.services.apiKeys.createKey("project routes")).key);
    const { profile } = backend.services;
    for (const slug of ["northwind", "acme"]) {
      await profile.createOrganization({
        logoId: null,
        slug,
        name: slug,
        website: null,
        description: null,
      });
    }
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
    const experience = {
      title: "Engineer",
      kind: "main_job" as const,
      summary: "A fictional role.",
      responsibilities: [],
      inCv: true,
      technologies: [],
    };
    await profile.createExperience({
      ...experience,
      slug: "northwind-lead",
      organization: "northwind",
      startedOn: "2021-03-01",
      endedOn: "2024-06-30",
    });
    await profile.createExperience({
      ...experience,
      slug: "acme-founder",
      organization: "acme",
      startedOn: "2023-01-01",
      endedOn: null,
    });
  });

  afterAll(async () => {
    await backend.close();
  });

  beforeEach(async () => {
    const { profile } = backend.services;
    for (const { slug } of await profile.listProjects()) {
      await profile.deleteProject(slug);
    }
  });

  const request = (path: string, method = "GET", init: RequestInit = {}) =>
    backend.api().app.request(path, { method, ...init }, connection());
  const create = (body: object) => request("/v1/projects", "POST", json(body, auth));

  it("lists no projects publicly", async () => {
    const response = await request("/v1/projects");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it("creates a project with its address, and reads it publicly with resolved technologies", async () => {
    const created = await create(routing);

    expect(created.status).toBe(201);
    expect(created.headers.get("location")).toBe("/v1/projects/routing-engine");
    const body = ProjectSchema.parse(await created.json());
    const { technologies, ...fields } = routing;
    expect(body).toMatchObject(fields);
    expect(body.technologies.map((technology) => technology.slug)).toEqual(technologies);
    // No visibility flag: that is not part of a project yet. The case study is written through its
    // own address, so a new project has none; a cover is attached by its media identifier.
    expect(body.caseStudy).toBeNull();
    expect(body.coverId).toBeNull();
    expect(Object.keys(body).sort()).toEqual(
      [...Object.keys(routing), "id", "coverId", "caseStudy", "createdAt", "updatedAt"].sort(),
    );

    const read = await request("/v1/projects/routing-engine");
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual(body);
  });

  it("fills an omitted end, links, selection and technologies", async () => {
    const created = ProjectSchema.parse(await (await create(fleet)).json());

    expect(created).toMatchObject({
      endedOn: null,
      links: [],
      selectedForHomepage: false,
      technologies: [],
    });
  });

  it("lists projects by experience order, then by position and slug", async () => {
    for (const project of [
      fleet,
      routing,
      { ...fleet, slug: "a-same", position: 2 },
      { ...fleet, slug: "acme-shop", experience: "acme-founder", position: 9 },
    ]) {
      expect((await create(project)).status).toBe(201);
    }

    const listed = ProjectListSchema.parse(await (await request("/v1/projects")).json());

    expect(listed.map((project) => project.slug)).toEqual([
      "acme-shop",
      "routing-engine",
      "a-same",
      "fleet-dashboard",
    ]);
  });

  it("answers an experience with its selected and unselected projects in order", async () => {
    const later = await (await create(fleet)).json();
    const first = await (await create(routing)).json();

    const response = await request("/v1/experiences/northwind-lead");

    expect(response.status).toBe(200);
    const experience = ExperienceSchema.parse(await response.json());
    expect(experience.projects).toEqual([first, later]);
    expect(experience.projects.map((project) => project.selectedForHomepage)).toEqual([
      true,
      false,
    ]);
    const listed = await (await request("/v1/experiences")).json();
    expect(listed).toMatchObject([
      { slug: "acme-founder", projects: [] },
      { slug: "northwind-lead", projects: [first, later] },
    ]);
  });

  it("refuses a duplicate slug with a conflict, also in another experience", async () => {
    await create(routing);

    const again = await create({ ...routing, experience: "acme-founder" });

    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: { code: "conflict", message: anyText } });
  });

  it.each([
    ["a missing experience", { ...routing, experience: undefined }, "experience"],
    ["an unknown experience", { ...routing, experience: "missing" }, "experience"],
    ["a malformed start", { ...routing, startedOn: "2022-13-01" }, "startedOn"],
    ["an end before the start", { ...routing, endedOn: "2020-01-01" }, "endedOn"],
    [
      "an invalid link",
      { ...routing, links: [{ label: "Site", url: "not a url" }] },
      "links.0.url",
    ],
    ["a repeated technology", { ...routing, technologies: ["rust", "rust"] }, "technologies"],
    ["unknown technologies", { ...routing, technologies: ["rust", "cobol"] }, "technologies"],
    ["a missing name", { ...routing, name: undefined }, "name"],
    ["a cover", { ...routing, cover: "cover.png" }, "cover"],
    ["a case study", { ...routing, caseStudy: "routing" }, "caseStudy"],
    ["a visibility flag", { ...routing, visible: true }, "visible"],
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
    await expect(backend.services.profile.listProjects()).resolves.toEqual([]);
  });

  it("updates only the given fields and keeps the technologies when they are omitted", async () => {
    const created = (await (await create(routing)).json()) as Project;

    const response = await request(
      "/v1/projects/routing-engine",
      "PATCH",
      json({ endedOn: null, selectedForHomepage: false }, auth),
    );

    expect(response.status).toBe(200);
    const updated = ProjectSchema.parse(await response.json());
    expect(updated).toMatchObject({
      endedOn: null,
      selectedForHomepage: false,
      name: routing.name,
      experience: routing.experience,
      id: created.id,
      createdAt: created.createdAt,
    });
    expect(updated.technologies).toEqual(created.technologies);
    expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt));
  });

  it("moves a project to another experience, which then owns it alone", async () => {
    await create(routing);

    const response = await request(
      "/v1/projects/routing-engine",
      "PATCH",
      json({ experience: "acme-founder" }, auth),
    );

    expect(response.status).toBe(200);
    const moved = ProjectSchema.parse(await response.json());
    expect(moved.experience).toBe("acme-founder");
    const owner = ExperienceSchema.parse(
      await (await request("/v1/experiences/acme-founder")).json(),
    );
    const former = ExperienceSchema.parse(
      await (await request("/v1/experiences/northwind-lead")).json(),
    );
    expect(owner.projects).toEqual([moved]);
    expect(former.projects).toEqual([]);
  });

  it("replaces the technologies with a given list, in its order", async () => {
    await create(routing);

    const replaced = await request(
      "/v1/projects/routing-engine",
      "PATCH",
      json({ technologies: ["rust", "typescript"] }, auth),
    );
    const cleared = await request(
      "/v1/projects/routing-engine",
      "PATCH",
      json({ technologies: [] }, auth),
    );

    expect(ProjectSchema.parse(await replaced.json()).technologies.map(({ slug }) => slug)).toEqual(
      ["rust", "typescript"],
    );
    expect(ProjectSchema.parse(await cleared.json()).technologies).toEqual([]);
  });

  it.each([
    ["a change of the slug", { slug: "renamed" }, undefined],
    ["an empty change", {}, undefined],
    ["a removed owner", { experience: null }, "experience"],
    ["an end before the stored start", { endedOn: "2020-01-01" }, "endedOn"],
    ["an unknown experience", { name: "Changed", experience: "missing" }, "experience"],
    ["unknown technologies", { name: "Changed", technologies: ["cobol"] }, "technologies"],
  ])("refuses an update with %s and changes nothing", async (_, body, field) => {
    const created = await (await create(routing)).json();

    const response = await request("/v1/projects/routing-engine", "PATCH", json(body, auth));

    expect(response.status).toBe(400);
    const { error } = (await response.json()) as {
      error: { code: string; fields?: FieldError[] };
    };
    expect(error.code).toBe("validation_failed");
    if (field) expect(error.fields).toEqual([expect.objectContaining({ path: field })]);
    expect(await (await request("/v1/projects/routing-engine")).json()).toEqual(created);
  });

  it("answers a missing project with not found", async () => {
    for (const response of [
      await request("/v1/projects/missing"),
      await request("/v1/projects/missing", "PATCH", json({ name: "X" }, auth)),
      await request("/v1/projects/missing", "DELETE", { headers: auth }),
    ]) {
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: { code: "not_found", message: anyText } });
    }
  });

  it("refuses a malformed slug in the path with the field", async () => {
    for (const response of [
      await request("/v1/projects/Not%20A%20Slug"),
      await request("/v1/projects/routing.engine", "PATCH", json({ name: "X" }, auth)),
      await request("/v1/projects/UPPER", "DELETE", { headers: auth }),
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
    expect((await request("/v1/projects/Not%20A%20Slug", "DELETE")).status).toBe(401);
    expect((await request("/v1/projects/routing-engine", "PATCH", json({}))).status).toBe(401);
    expect((await request("/v1/projects", "POST", json(routing))).status).toBe(401);
    await expect(backend.services.profile.listProjects()).resolves.toEqual([]);
  });

  it("refuses to delete an experience or a technology a project uses", async () => {
    await create(routing);

    for (const response of [
      await request("/v1/experiences/northwind-lead", "DELETE", { headers: auth }),
      await request("/v1/technologies/postgres", "DELETE", { headers: auth }),
    ]) {
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: { code: "conflict", message: anyText } });
    }
    expect((await request("/v1/experiences/northwind-lead")).status).toBe(200);
    expect((await request("/v1/technologies/postgres")).status).toBe(200);
    expect((await request("/v1/projects/routing-engine")).status).toBe(200);
  });

  it("deletes a project with the key, keeps its experience and technologies, and reports each write", async () => {
    const events: WriteEvent[] = [];
    const { app } = backend.api({
      onWrite: (event) => {
        events.push(event);
        return Promise.resolve();
      },
    });
    await app.request("/v1/projects", { method: "POST", ...json(routing, auth) }, connection());

    const deleted = await app.request(
      "/v1/projects/routing-engine",
      { method: "DELETE", headers: auth },
      connection(),
    );

    expect(deleted.status).toBe(204);
    expect(await deleted.text()).toBe("");
    expect(events).toEqual([
      { operationId: "createProject", method: "POST", path: "/v1/projects" },
      { operationId: "deleteProject", method: "DELETE", path: "/v1/projects/routing-engine" },
    ]);
    expect((await request("/v1/projects/routing-engine")).status).toBe(404);
    expect((await request("/v1/experiences/northwind-lead")).status).toBe(200);
    expect((await request("/v1/technologies/postgres")).status).toBe(200);
  });
});
