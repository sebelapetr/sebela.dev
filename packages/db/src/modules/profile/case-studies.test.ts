import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { readDatabaseConfig } from "../../config.js";
import { openConnection, type Connection } from "../../connection.js";
import { createTemporaryDatabase, type TemporaryDatabase } from "../../testing.js";
import { createProfilePersistence, type ProfilePersistence } from "./index.js";

const narrative = {
  role: "Lead engineer of a fictional team of four.",
  body: "## Context\n\nA **fictional** dispatcher planned routes by hand.",
};

describe("case-study persistence", () => {
  let database: TemporaryDatabase;
  let connection: Connection;
  let profile: ProfilePersistence;

  /** Counts every stored row of a table; the subject here is persistence integrity. */
  async function count(table: "case_studies" | "projects") {
    const result = await connection.db.execute<{ count: string }>(
      sql`SELECT count(*) AS count FROM ${sql.identifier("profile")}.${sql.identifier(table)}`,
    );
    return Number(result.rows[0]?.count);
  }

  const project = (slug: string, experience: string, position: number) => ({
    slug,
    experience,
    name: slug,
    summary: "A fictional project.",
    problem: "A fictional problem.",
    workDone: "Fictional work.",
    result: "A fictional result.",
    startedOn: "2022-01-01",
    endedOn: null,
    links: [],
    selectedForHomepage: false,
    position,
    technologies: [],
  });

  beforeAll(async () => {
    database = await createTemporaryDatabase(readDatabaseConfig(process.env));
    connection = openConnection(database.config);
    profile = createProfilePersistence(connection.db);
    await profile.createOrganization({
      slug: "northwind",
      name: "Northwind",
      website: null,
      description: null,
    });
    const experience = {
      title: "Engineer",
      kind: "main_job" as const,
      summary: "A fictional role.",
      responsibilities: [],
      inCv: true,
      technologies: [],
      organization: "northwind",
      endedOn: null,
    };
    await profile.createExperience({
      ...experience,
      slug: "northwind-lead",
      startedOn: "2021-01-01",
    });
    await profile.createExperience({
      ...experience,
      slug: "northwind-staff",
      startedOn: "2020-01-01",
    });
  });

  afterAll(async () => {
    await connection.close();
    await database.drop();
  });

  beforeEach(async () => {
    await connection.db.execute(sql`DELETE FROM profile.case_studies`);
    for (const { slug } of await profile.listProjects()) await profile.deleteProject(slug);
    await profile.createProject(project("routing-engine", "northwind-lead", 0));
    await profile.createProject(project("fleet-dashboard", "northwind-lead", 1));
  });

  it("finds no case study while a project has none, and the project carries null", async () => {
    expect(await profile.findCaseStudy("routing-engine")).toBeNull();
    expect(await profile.findCaseStudy("unknown-project")).toBeNull();
    expect((await profile.findProject("routing-engine"))?.caseStudy).toBeNull();
  });

  it("creates the case study of a project and returns it with the project's slug", async () => {
    const result = await profile.createCaseStudy("routing-engine", narrative);

    expect(result).toEqual({
      ok: true,
      caseStudy: {
        id: expect.any(String) as unknown,
        project: "routing-engine",
        ...narrative,
        createdAt: expect.any(Date) as unknown,
        updatedAt: expect.any(Date) as unknown,
      },
    });
    expect(await profile.findCaseStudy("routing-engine")).toEqual(
      result.ok ? result.caseStudy : undefined,
    );
  });

  it("puts the case study into its project, its project list entry and its experience", async () => {
    const created = await profile.createCaseStudy("routing-engine", narrative);
    const caseStudy = created.ok ? created.caseStudy : undefined;

    expect((await profile.findProject("routing-engine"))?.caseStudy).toEqual(caseStudy);
    expect((await profile.findProject("fleet-dashboard"))?.caseStudy).toBeNull();
    const listed = await profile.listProjects();
    expect(listed.map((record) => [record.slug, record.caseStudy?.role ?? null])).toEqual([
      ["routing-engine", narrative.role],
      ["fleet-dashboard", null],
    ]);
    const experience = await profile.findExperience("northwind-lead");
    expect(experience?.projects.map((record) => record.caseStudy)).toEqual([caseStudy, null]);
  });

  it("refuses a case study for an unknown project", async () => {
    expect(await profile.createCaseStudy("unknown-project", narrative)).toEqual({
      ok: false,
      reason: "unknown_project",
    });
    expect(await count("case_studies")).toBe(0);
  });

  it("keeps one case study per project, also for concurrent creates", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        profile.createCaseStudy("routing-engine", { ...narrative, role: `Role ${String(index)}` }),
      ),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual(
      Array.from({ length: 4 }, () => ({ ok: false, reason: "conflict" })),
    );
    expect(await count("case_studies")).toBe(1);
    expect(await profile.createCaseStudy("routing-engine", narrative)).toEqual({
      ok: false,
      reason: "conflict",
    });
  });

  it("lets every project have its own case study", async () => {
    await profile.createCaseStudy("routing-engine", narrative);
    const second = await profile.createCaseStudy("fleet-dashboard", { ...narrative, role: "Solo" });

    expect(second).toMatchObject({ ok: true, caseStudy: { project: "fleet-dashboard" } });
    expect(await count("case_studies")).toBe(2);
  });

  it("changes only the given fields, keeps id and createdAt and advances updatedAt", async () => {
    const created = await profile.createCaseStudy("routing-engine", narrative);
    if (!created.ok) throw new Error("The case study was not created.");

    const updated = await profile.updateCaseStudy("routing-engine", { role: "Architect" });

    expect(updated).toEqual({
      ok: true,
      caseStudy: {
        ...created.caseStudy,
        role: "Architect",
        updatedAt: expect.any(Date) as unknown,
      },
    });
    if (!updated.ok) throw new Error("The case study was not updated.");
    expect(updated.caseStudy.updatedAt.getTime()).toBeGreaterThan(
      created.caseStudy.updatedAt.getTime(),
    );
    expect((await profile.findProject("routing-engine"))?.caseStudy?.role).toBe("Architect");
  });

  it("updates nothing without a case study or a project", async () => {
    expect(await profile.updateCaseStudy("routing-engine", { role: "x" })).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(await profile.updateCaseStudy("unknown-project", { role: "x" })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("deletes the case study once and leaves its project intact", async () => {
    await profile.createCaseStudy("routing-engine", narrative);
    const before = await profile.findProject("routing-engine");

    expect(await profile.deleteCaseStudy("routing-engine")).toEqual({ ok: true });
    expect(await profile.deleteCaseStudy("routing-engine")).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(await profile.deleteCaseStudy("unknown-project")).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(await profile.findProject("routing-engine")).toEqual({ ...before, caseStudy: null });
    expect(await count("projects")).toBe(2);
  });

  it("refuses to delete a project that has a case study, and keeps both", async () => {
    await profile.createCaseStudy("routing-engine", narrative);

    expect(await profile.deleteProject("routing-engine")).toEqual({
      ok: false,
      reason: "referenced",
    });
    expect(await count("projects")).toBe(2);
    expect(await count("case_studies")).toBe(1);

    await profile.deleteCaseStudy("routing-engine");
    expect(await profile.deleteProject("routing-engine")).toEqual({ ok: true });
  });

  it("moves the case study with its project to another experience", async () => {
    await profile.createCaseStudy("routing-engine", narrative);

    await profile.updateProject("routing-engine", { experience: "northwind-staff" });

    const moved = await profile.findExperience("northwind-staff");
    expect(moved?.projects.map((record) => record.caseStudy?.project)).toEqual(["routing-engine"]);
  });
});
