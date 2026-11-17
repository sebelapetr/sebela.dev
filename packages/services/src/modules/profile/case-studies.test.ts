import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { CaseStudySchema, ExperienceSchema, ProjectSchema } from "@sebela/contracts";
import { createPersistence, readDatabaseConfig, type Persistence } from "@sebela/db";
import { createTemporaryDatabase, type TemporaryDatabase } from "@sebela/db/testing";

import { DomainError } from "../../errors.js";
import { createProfileService, type ProfileService } from "./index.js";

const narrative = {
  role: "Lead engineer of a fictional team of four.",
  body: "## Context\n\nA **fictional** dispatcher planned routes by hand.",
};

describe("case-study service", () => {
  let database: TemporaryDatabase;
  let persistence: Persistence;
  let profile: ProfileService;

  const project = (slug: string, position: number) => ({
    slug,
    experience: "northwind-lead",
    name: slug,
    summary: "A fictional project.",
    problem: "A fictional problem.",
    workDone: "Fictional work.",
    result: "A fictional result.",
    startedOn: "2022-01-01",
    endedOn: null,
    links: [],
    selectedForHomepage: true,
    position,
    technologies: [],
    coverId: null,
  });

  beforeAll(async () => {
    database = await createTemporaryDatabase(readDatabaseConfig(process.env));
    persistence = createPersistence(database.config);
    profile = createProfileService(persistence.profile);
    await profile.createOrganization({
      slug: "northwind",
      name: "Northwind",
      website: null,
      description: null,
      logoId: null,
    });
    await profile.createExperience({
      slug: "northwind-lead",
      organization: "northwind",
      title: "Engineer",
      kind: "main_job",
      startedOn: "2021-01-01",
      endedOn: null,
      summary: "A fictional role.",
      responsibilities: [],
      inCv: true,
      technologies: [],
    });
  });

  afterAll(async () => {
    await persistence.close();
    await database.drop();
  });

  beforeEach(async () => {
    for (const { slug, caseStudy } of await persistence.profile.listProjects()) {
      if (caseStudy) await persistence.profile.deleteCaseStudy(slug);
      await persistence.profile.deleteProject(slug);
    }
    await profile.createProject(project("routing-engine", 0));
    await profile.createProject(project("fleet-dashboard", 1));
  });

  it("creates the case study in the contract shape and reads it back", async () => {
    const created = await profile.createCaseStudy("routing-engine", narrative);

    expect(CaseStudySchema.parse(created)).toEqual(created);
    expect(created).toMatchObject({ project: "routing-engine", ...narrative });
    await expect(profile.getCaseStudy("routing-engine")).resolves.toEqual(created);
  });

  it("delivers the case study with its project and inside its experience", async () => {
    const created = await profile.createCaseStudy("routing-engine", narrative);

    const read = await profile.getProject("routing-engine");
    expect(ProjectSchema.parse(read)).toEqual(read);
    expect(read.caseStudy).toEqual(created);
    await expect(profile.getProject("fleet-dashboard")).resolves.toMatchObject({
      caseStudy: null,
    });
    const listed = await profile.listProjects();
    expect(listed.map((record) => record.caseStudy)).toEqual([created, null]);
    const experience = await profile.getExperience("northwind-lead");
    expect(ExperienceSchema.parse(experience)).toEqual(experience);
    expect(experience.projects.map((record) => record.caseStudy)).toEqual([created, null]);
  });

  it("refuses a second case study for the same project as a conflict", async () => {
    await profile.createCaseStudy("routing-engine", narrative);

    await expect(profile.createCaseStudy("routing-engine", narrative)).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("keeps exactly one of concurrent creates", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => profile.createCaseStudy("fleet-dashboard", narrative)),
    );

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    for (const result of results.filter((entry) => entry.status === "rejected")) {
      expect(result.reason).toMatchObject({ code: "conflict" });
    }
  });

  it("answers not_found for an unknown project or a missing case study", async () => {
    await expect(profile.getCaseStudy("routing-engine")).rejects.toBeInstanceOf(DomainError);
    await expect(profile.getCaseStudy("routing-engine")).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(profile.getCaseStudy("missing")).rejects.toMatchObject({ code: "not_found" });
    await expect(profile.createCaseStudy("missing", narrative)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(profile.updateCaseStudy("routing-engine", { role: "x" })).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(profile.deleteCaseStudy("routing-engine")).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("changes only the given fields and advances updatedAt", async () => {
    const created = await profile.createCaseStudy("routing-engine", narrative);

    const updated = await profile.updateCaseStudy("routing-engine", { body: "Shorter." });

    expect(updated).toMatchObject({ id: created.id, role: narrative.role, body: "Shorter." });
    expect(updated.createdAt).toBe(created.createdAt);
    expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt));
  });

  it("ignores undefined fields of an update", async () => {
    await profile.createCaseStudy("routing-engine", narrative);

    const updated = await profile.updateCaseStudy("routing-engine", {
      role: "Architect",
      body: undefined,
    });

    expect(updated).toMatchObject({ role: "Architect", body: narrative.body });
  });

  it("removes the case study and leaves the project", async () => {
    await profile.createCaseStudy("routing-engine", narrative);

    await profile.deleteCaseStudy("routing-engine");

    await expect(profile.getProject("routing-engine")).resolves.toMatchObject({ caseStudy: null });
    await expect(profile.getCaseStudy("routing-engine")).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("refuses to delete a project with a case study as a conflict", async () => {
    await profile.createCaseStudy("routing-engine", narrative);

    await expect(profile.deleteProject("routing-engine")).rejects.toMatchObject({
      code: "conflict",
    });
    await expect(profile.getCaseStudy("routing-engine")).resolves.toMatchObject(narrative);
  });
});
