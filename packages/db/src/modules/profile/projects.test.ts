import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { readDatabaseConfig } from "../../config.js";
import { openConnection, type Connection } from "../../connection.js";
import { createTemporaryDatabase, type TemporaryDatabase } from "../../testing.js";
import {
  createProfilePersistence,
  type ProfilePersistence,
  type ProjectFields,
  type ProjectRelations,
} from "./index.js";

type ProjectInput = ProjectFields & ProjectRelations & { slug: string };

const routing: ProjectInput = {
  slug: "routing-engine",
  experience: "northwind-lead",
  name: "Routing engine",
  summary: "A **fictional** route planner for delivery vans.",
  problem: "Dispatchers planned routes by hand.",
  workDone: "Designed and built the planning service.",
  result: "Routes are planned in minutes.",
  startedOn: "2022-01-01",
  endedOn: "2022-09-30",
  links: [
    { label: "Product page", url: "https://example.com/routing" },
    { label: "Repository", url: "https://example.org/routing" },
  ],
  selectedForHomepage: true,
  position: 1,
  technologies: ["typescript", "postgres"],
};

const project = (
  slug: string,
  experience: string,
  position: number,
  overrides: Partial<ProjectInput> = {},
): ProjectInput => ({
  ...routing,
  slug,
  experience,
  position,
  technologies: [],
  ...overrides,
});

describe("project persistence", () => {
  let database: TemporaryDatabase;
  let connection: Connection;
  let profile: ProfilePersistence;

  /** Counts every stored row of a table; the subject here is persistence integrity. */
  async function count(table: "projects" | "project_technologies" | "experiences") {
    const result = await connection.db.execute<{ count: string }>(
      sql`SELECT count(*) AS count FROM ${sql.identifier("profile")}.${sql.identifier(table)}`,
    );
    return Number(result.rows[0]?.count);
  }

  const technologySlugs = async (slug: string) =>
    (await profile.findProject(slug))?.technologies.map((technology) => technology.slug);

  const projectSlugsOf = async (experience: string) =>
    (await profile.findExperience(experience))?.projects.map((record) => record.slug);

  beforeAll(async () => {
    database = await createTemporaryDatabase(readDatabaseConfig(process.env));
    connection = openConnection(database.config);
    profile = createProfilePersistence(connection.db);
    for (const slug of ["northwind", "acme"]) {
      await profile.createOrganization({ slug, name: slug, website: null, description: null });
    }
    const technology = (slug: string, position: number) => ({
      slug,
      name: slug,
      tier: "secondary" as const,
      group: null,
      logoKey: null,
      position,
    });
    await profile.createTechnology(technology("typescript", 1));
    await profile.createTechnology(technology("postgres", 2));
    await profile.createTechnology(technology("rust", 3));
  });

  afterAll(async () => {
    await connection.close();
    await database.drop();
  });

  beforeEach(async () => {
    await connection.db.execute(sql`DROP TABLE IF EXISTS profile.fictional_references`);
    for (const { slug } of await profile.listProjects()) await profile.deleteProject(slug);
    for (const { slug } of await profile.listExperiences()) await profile.deleteExperience(slug);
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
    // A current role, so it comes first in the experience order.
    await profile.createExperience({
      ...experience,
      slug: "acme-founder",
      organization: "acme",
      startedOn: "2023-01-01",
      endedOn: null,
    });
  });

  it("lists nothing while there are no projects", async () => {
    await expect(profile.listProjects()).resolves.toEqual([]);
    await expect(projectSlugsOf("northwind-lead")).resolves.toEqual([]);
  });

  it("creates a project with its experience and technologies resolved", async () => {
    const created = await profile.createProject(routing);

    const { technologies, ...fields } = routing;
    expect(created).toMatchObject({ ok: true, project: fields });
    const found = await profile.findProject("routing-engine");
    expect(found).toMatchObject(fields);
    expect(found?.id).toEqual(expect.any(String));
    expect(found?.createdAt).toBeInstanceOf(Date);
    expect(found?.updatedAt).toBeInstanceOf(Date);
    expect(found?.experience).toBe("northwind-lead");
    expect(found?.links).toEqual(routing.links);
    expect(found?.technologies.map((technology) => technology.slug)).toEqual(technologies);
    expect(found?.technologies[0]).toMatchObject({ name: "typescript", tier: "secondary" });
    if (!created.ok) throw new Error("expected a project");
    expect(found).toEqual(created.project);
  });

  it("stores an ongoing project without links or technologies", async () => {
    await profile.createProject(
      project("fleet", "acme-founder", 0, { endedOn: null, links: [], selectedForHomepage: false }),
    );

    await expect(profile.findProject("fleet")).resolves.toMatchObject({
      experience: "acme-founder",
      endedOn: null,
      links: [],
      selectedForHomepage: false,
      technologies: [],
    });
  });

  it("keeps the technologies in the order they were given", async () => {
    await profile.createProject({ ...routing, technologies: ["rust", "typescript", "postgres"] });

    await expect(technologySlugs("routing-engine")).resolves.toEqual([
      "rust",
      "typescript",
      "postgres",
    ]);
  });

  it("finds nothing for an unknown slug", async () => {
    await expect(profile.findProject("missing")).resolves.toBeNull();
  });

  it("lists projects by experience order, then by position and slug", async () => {
    await profile.createProject(project("northwind-b", "northwind-lead", 1));
    await profile.createProject(project("acme-late", "acme-founder", 5));
    await profile.createProject(project("northwind-first", "northwind-lead", 0));
    await profile.createProject(project("northwind-a", "northwind-lead", 1));
    await profile.createProject(project("acme-early", "acme-founder", 2));

    const listed = await profile.listProjects();

    expect(listed.map((record) => [record.experience, record.slug])).toEqual([
      ["acme-founder", "acme-early"],
      ["acme-founder", "acme-late"],
      ["northwind-lead", "northwind-first"],
      ["northwind-lead", "northwind-a"],
      ["northwind-lead", "northwind-b"],
    ]);
  });

  it("puts each experience's projects, selected and unselected, into it in their order", async () => {
    await profile.createProject(
      project("unselected", "northwind-lead", 2, { selectedForHomepage: false }),
    );
    await profile.createProject({ ...routing, position: 1 });
    await profile.createProject(project("elsewhere", "acme-founder", 0));

    const lead = await profile.findExperience("northwind-lead");
    expect(lead?.projects.map((record) => [record.slug, record.selectedForHomepage])).toEqual([
      ["routing-engine", true],
      ["unselected", false],
    ]);
    expect(lead?.projects[0]).toEqual(await profile.findProject("routing-engine"));

    const listed = await profile.listExperiences();
    expect(listed.map((record) => [record.slug, record.projects.map((p) => p.slug)])).toEqual([
      ["acme-founder", ["elsewhere"]],
      ["northwind-lead", ["routing-engine", "unselected"]],
    ]);
  });

  describe("an invalid create writes nothing", () => {
    const refusals: [string, Partial<ProjectInput>, object][] = [
      ["an unknown experience", { experience: "missing" }, { reason: "unknown_experience" }],
      [
        "unknown technologies and names them",
        { technologies: ["typescript", "cobol", "postgres", "fortran"] },
        { reason: "unknown_technologies", slugs: ["cobol", "fortran"] },
      ],
      [
        "a repeated technology",
        { technologies: ["typescript", "rust", "typescript"] },
        { reason: "repeated_technologies" },
      ],
      [
        "an end before the start",
        { startedOn: "2024-01-02", endedOn: "2024-01-01" },
        { reason: "invalid_period" },
      ],
    ];

    it.each(refusals)("refuses %s", async (_, changes, failure) => {
      await expect(profile.createProject({ ...routing, ...changes })).resolves.toEqual({
        ok: false,
        ...failure,
      });
      expect(await count("projects")).toBe(0);
      expect(await count("project_technologies")).toBe(0);
    });
  });

  it("refuses a duplicate slug as a conflict, also for concurrent creates", async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        // Also across experiences: a slug is unique among every project.
        profile.createProject({
          ...routing,
          experience: index % 2 === 0 ? "northwind-lead" : "acme-founder",
        }),
      ),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual(
      Array.from({ length: 3 }, () => ({ ok: false, reason: "conflict" })),
    );
    expect(await count("projects")).toBe(1);
    expect(await count("project_technologies")).toBe(2);
  });

  describe("updates", () => {
    it("changes given fields, keeps the slug, id and createdAt and advances updatedAt", async () => {
      const created = await profile.createProject(routing);
      if (!created.ok) throw new Error("expected a project");

      const updated = await profile.updateProject("routing-engine", {
        name: "Route planner",
        endedOn: null,
        links: [],
        selectedForHomepage: false,
      });

      expect(updated).toMatchObject({
        ok: true,
        project: {
          slug: "routing-engine",
          name: "Route planner",
          endedOn: null,
          links: [],
          selectedForHomepage: false,
          summary: routing.summary,
          experience: "northwind-lead",
          id: created.project.id,
          createdAt: created.project.createdAt,
        },
      });
      if (!updated.ok) throw new Error("expected a project");
      expect(updated.project.updatedAt.getTime()).toBeGreaterThan(
        created.project.updatedAt.getTime(),
      );
      await expect(profile.findProject("routing-engine")).resolves.toEqual(updated.project);
    });

    it("moves the project to another experience, which then owns it alone", async () => {
      await profile.createProject(routing);

      const moved = await profile.updateProject("routing-engine", { experience: "acme-founder" });

      expect(moved).toMatchObject({ ok: true, project: { experience: "acme-founder" } });
      await expect(projectSlugsOf("acme-founder")).resolves.toEqual(["routing-engine"]);
      await expect(projectSlugsOf("northwind-lead")).resolves.toEqual([]);
      await expect(technologySlugs("routing-engine")).resolves.toEqual(["typescript", "postgres"]);
      expect(await count("projects")).toBe(1);
    });

    it("keeps the technologies when they are omitted", async () => {
      await profile.createProject(routing);

      await profile.updateProject("routing-engine", { result: "Faster routes." });

      await expect(technologySlugs("routing-engine")).resolves.toEqual(["typescript", "postgres"]);
    });

    it("replaces every technology link with a given list, in its order", async () => {
      await profile.createProject(routing);

      const updated = await profile.updateProject("routing-engine", {
        technologies: ["rust", "typescript"],
      });

      expect(updated.ok).toBe(true);
      await expect(technologySlugs("routing-engine")).resolves.toEqual(["rust", "typescript"]);
      expect(await count("project_technologies")).toBe(2);
    });

    it("removes every technology link with an empty list", async () => {
      await profile.createProject(routing);

      const updated = await profile.updateProject("routing-engine", { technologies: [] });

      expect(updated).toMatchObject({ ok: true, project: { technologies: [] } });
      expect(await count("project_technologies")).toBe(0);
    });

    it("updates nothing for an unknown slug", async () => {
      await expect(profile.updateProject("missing", { name: "Missing" })).resolves.toEqual({
        ok: false,
        reason: "not_found",
      });
    });

    // Each change also replaces the technologies and the name, so a refusal must undo them.
    const refusals: [string, Partial<ProjectInput>, object][] = [
      ["an unknown experience", { experience: "missing" }, { reason: "unknown_experience" }],
      [
        "unknown technologies",
        { technologies: ["rust", "cobol"] },
        { reason: "unknown_technologies", slugs: ["cobol"] },
      ],
      [
        "a repeated technology",
        { technologies: ["rust", "rust"] },
        { reason: "repeated_technologies" },
      ],
      ["an end before the stored start", { endedOn: "2020-01-01" }, { reason: "invalid_period" }],
      ["a start after the stored end", { startedOn: "2025-01-01" }, { reason: "invalid_period" }],
    ];

    it.each(refusals)("refuses %s and changes nothing", async (_, changes, failure) => {
      const created = await profile.createProject(routing);
      if (!created.ok) throw new Error("expected a project");

      const result = await profile.updateProject("routing-engine", {
        name: "Changed",
        experience: "acme-founder",
        technologies: ["rust"],
        ...changes,
      });

      expect(result).toEqual({ ok: false, ...failure });
      await expect(profile.findProject("routing-engine")).resolves.toEqual(created.project);
      await expect(projectSlugsOf("acme-founder")).resolves.toEqual([]);
      expect(await count("project_technologies")).toBe(2);
    });

    it("leaves exactly one of several concurrent technology replacements", async () => {
      await profile.createProject(routing);
      const lists = [["rust"], ["typescript", "postgres"], ["postgres", "rust", "typescript"], []];

      const results = await Promise.all(
        lists.map((technologies) => profile.updateProject("routing-engine", { technologies })),
      );

      expect(results.every((result) => result.ok)).toBe(true);
      const stored = await technologySlugs("routing-engine");
      expect(lists).toContainEqual(stored);
      expect(await count("project_technologies")).toBe(stored?.length);
    });
  });

  describe("deletes", () => {
    it("deletes a project once, with only its own technology links", async () => {
      await profile.createProject(routing);
      await profile.createProject(
        project("fleet", "northwind-lead", 2, { technologies: ["typescript"] }),
      );

      await expect(profile.deleteProject("routing-engine")).resolves.toEqual({ ok: true });
      await expect(profile.deleteProject("routing-engine")).resolves.toEqual({
        ok: false,
        reason: "not_found",
      });

      await expect(profile.findProject("routing-engine")).resolves.toBeNull();
      await expect(technologySlugs("fleet")).resolves.toEqual(["typescript"]);
      expect(await count("project_technologies")).toBe(1);
      await expect(projectSlugsOf("northwind-lead")).resolves.toEqual(["fleet"]);
      await expect(profile.findTechnology("postgres")).resolves.not.toBeNull();
    });

    it("refuses to delete a project that another record references", async () => {
      // A stand-in for a later referencing table, such as case studies: a plain foreign key.
      await connection.db.execute(
        sql`CREATE TABLE profile.fictional_references (
          project_id uuid NOT NULL REFERENCES profile.projects (id)
        )`,
      );
      const created = await profile.createProject(routing);
      if (!created.ok) throw new Error("expected a project");
      await connection.db.execute(
        sql`INSERT INTO profile.fictional_references VALUES (${created.project.id})`,
      );

      await expect(profile.deleteProject("routing-engine")).resolves.toEqual({
        ok: false,
        reason: "referenced",
      });
      await expect(profile.findProject("routing-engine")).resolves.toEqual(created.project);
      await connection.db.execute(sql`DROP TABLE profile.fictional_references`);
    });

    it("refuses to delete an experience that owns a project", async () => {
      await profile.createProject(routing);
      const before = await profile.findExperience("northwind-lead");

      await expect(profile.deleteExperience("northwind-lead")).resolves.toEqual({
        ok: false,
        reason: "referenced",
      });
      await expect(profile.findExperience("northwind-lead")).resolves.toEqual(before);
      expect(await count("projects")).toBe(1);
    });

    it("refuses to delete a technology that a project links to", async () => {
      await profile.createProject(routing);

      await expect(profile.deleteTechnology("postgres")).resolves.toEqual({
        ok: false,
        reason: "referenced",
      });
      await expect(technologySlugs("routing-engine")).resolves.toEqual(["typescript", "postgres"]);
    });

    it("deletes the experience and technology once their projects are gone", async () => {
      await profile.createTechnology({
        slug: "spare",
        name: "Spare",
        tier: "secondary",
        group: null,
        logoKey: null,
        position: 9,
      });
      await profile.createProject({ ...routing, technologies: ["spare"] });
      await profile.deleteProject("routing-engine");

      await expect(profile.deleteTechnology("spare")).resolves.toEqual({ ok: true });
      await expect(profile.deleteExperience("northwind-lead")).resolves.toEqual({ ok: true });
    });
  });
});
