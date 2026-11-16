import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  ExperienceSchema,
  ProjectListSchema,
  ProjectSchema,
  type ProjectCreate,
  type ProjectUpdate,
} from "@sebela/contracts";
import { createPersistence, readDatabaseConfig, type Persistence } from "@sebela/db";
import { createTemporaryDatabase, type TemporaryDatabase } from "@sebela/db/testing";

import { DomainError } from "../../errors.js";
import { createProfileService, type ProfileService } from "./index.js";

const routing: ProjectCreate = {
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

const fleet: ProjectCreate = {
  ...routing,
  slug: "fleet-dashboard",
  name: "Fleet dashboard",
  endedOn: null,
  links: [],
  selectedForHomepage: false,
  position: 2,
  technologies: [],
};

describe("project service", () => {
  let database: TemporaryDatabase;
  let persistence: Persistence;
  let profile: ProfileService;

  beforeAll(async () => {
    database = await createTemporaryDatabase(readDatabaseConfig(process.env));
    persistence = createPersistence(database.config);
    profile = createProfileService(persistence.profile);
    for (const slug of ["northwind", "acme"]) {
      await profile.createOrganization({ slug, name: slug, website: null, description: null });
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
    await persistence.close();
    await database.drop();
  });

  beforeEach(async () => {
    for (const { slug } of await persistence.profile.listProjects()) {
      await persistence.profile.deleteProject(slug);
    }
  });

  it("lists no projects", async () => {
    await expect(profile.listProjects()).resolves.toEqual([]);
  });

  it("creates projects in the contract shape with resolved technologies", async () => {
    const created = await profile.createProject(routing);

    expect(ProjectSchema.parse(created)).toEqual(created);
    const { technologies, ...fields } = routing;
    expect(created).toMatchObject(fields);
    expect(created.technologies.map((technology) => technology.slug)).toEqual(technologies);
    await expect(profile.getProject("routing-engine")).resolves.toEqual(created);
  });

  it("lists projects by experience order, then by position", async () => {
    const later = await profile.createProject(fleet);
    const first = await profile.createProject(routing);
    const current = await profile.createProject({
      ...fleet,
      slug: "acme-shop",
      experience: "acme-founder",
      position: 9,
    });

    const listed = await profile.listProjects();

    expect(ProjectListSchema.parse(listed)).toEqual([current, first, later]);
  });

  it("puts selected and unselected projects into their experience in order", async () => {
    const later = await profile.createProject(fleet);
    const first = await profile.createProject(routing);

    const experience = await profile.getExperience("northwind-lead");

    expect(ExperienceSchema.parse(experience)).toEqual(experience);
    expect(experience.projects).toEqual([first, later]);
    expect(experience.projects.map((project) => project.selectedForHomepage)).toEqual([
      true,
      false,
    ]);
    await expect(profile.listExperiences()).resolves.toMatchObject([
      { slug: "acme-founder", projects: [] },
      { slug: "northwind-lead", projects: [first, later] },
    ]);
  });

  it("reports an unknown slug as not found", async () => {
    await expect(profile.getProject("missing")).rejects.toBeInstanceOf(DomainError);
    await expect(profile.getProject("missing")).rejects.toMatchObject({ code: "not_found" });
    await expect(profile.updateProject("missing", { name: "X" })).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(profile.deleteProject("missing")).rejects.toMatchObject({ code: "not_found" });
  });

  it("refuses a duplicate slug as a conflict", async () => {
    await profile.createProject(routing);

    await expect(
      profile.createProject({ ...routing, experience: "acme-founder" }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  const refusals: [string, Partial<ProjectCreate>, string, string][] = [
    ["an unknown experience", { experience: "missing" }, "experience", "missing"],
    [
      "unknown technologies",
      { technologies: ["typescript", "cobol", "fortran"] },
      "technologies",
      "cobol, fortran",
    ],
    ["a repeated technology", { technologies: ["rust", "rust"] }, "technologies", "once"],
    ["an end before the start", { endedOn: "2020-01-01" }, "endedOn", "start"],
  ];

  it.each(refusals)("refuses a create with %s as invalid", async (_, change, path, text) => {
    await expect(profile.createProject({ ...routing, ...change })).rejects.toMatchObject({
      code: "validation_failed",
      fields: [{ path, message: expect.stringContaining(text) as unknown }],
    });
    await expect(profile.listProjects()).resolves.toEqual([]);
  });

  it.each(refusals)("refuses an update with %s and changes nothing", async (_, change, path) => {
    const created = await profile.createProject(routing);

    await expect(
      profile.updateProject("routing-engine", { name: "Changed", ...change }),
    ).rejects.toMatchObject({ code: "validation_failed", fields: [{ path }] });
    await expect(profile.getProject("routing-engine")).resolves.toEqual(created);
  });

  it("changes only the given fields and keeps the technologies when they are omitted", async () => {
    const created = await profile.createProject(routing);
    const changes: ProjectUpdate = { selectedForHomepage: false, endedOn: null, name: undefined };

    const updated = await profile.updateProject("routing-engine", changes);

    expect(updated).toMatchObject({
      selectedForHomepage: false,
      endedOn: null,
      name: routing.name,
      links: routing.links,
    });
    expect(updated.technologies).toEqual(created.technologies);
    expect(updated.id).toBe(created.id);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt));
  });

  it("moves a project to another experience", async () => {
    await profile.createProject(routing);

    const moved = await profile.updateProject("routing-engine", { experience: "acme-founder" });

    expect(moved.experience).toBe("acme-founder");
    await expect(profile.getExperience("acme-founder")).resolves.toMatchObject({
      projects: [moved],
    });
    await expect(profile.getExperience("northwind-lead")).resolves.toMatchObject({
      projects: [],
    });
  });

  it("replaces the technologies with a given list", async () => {
    await profile.createProject(routing);

    const updated = await profile.updateProject("routing-engine", {
      technologies: ["rust", "typescript"],
    });

    expect(updated.technologies.map((technology) => technology.slug)).toEqual([
      "rust",
      "typescript",
    ]);
  });

  it("deletes a project and keeps its experience and technologies", async () => {
    await profile.createProject(routing);

    await profile.deleteProject("routing-engine");

    await expect(profile.getProject("routing-engine")).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(profile.getExperience("northwind-lead")).resolves.toMatchObject({ projects: [] });
    await expect(profile.getTechnology("postgres")).resolves.toMatchObject({ slug: "postgres" });
  });

  it("refuses to delete a referenced project as a conflict", async () => {
    // Persistence reports a reference that a foreign key holds (tested in @sebela/db); no table
    // refers to projects yet.
    const referenced = createProfileService({
      ...persistence.profile,
      deleteProject: () => Promise.resolve({ ok: false, reason: "referenced" }),
    });

    await expect(referenced.deleteProject("routing-engine")).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining("routing-engine") as unknown,
    });
  });

  it("refuses to delete an experience or a technology a project uses as a conflict", async () => {
    const created = await profile.createProject(routing);

    await expect(profile.deleteExperience("northwind-lead")).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining("northwind-lead") as unknown,
    });
    await expect(profile.deleteTechnology("postgres")).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining("postgres") as unknown,
    });
    await expect(profile.getProject("routing-engine")).resolves.toEqual(created);
  });
});
