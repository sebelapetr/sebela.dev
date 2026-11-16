import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  ExperienceListSchema,
  ExperienceSchema,
  type ExperienceCreate,
  type ExperienceUpdate,
} from "@sebela/contracts";
import { createPersistence, readDatabaseConfig, type Persistence } from "@sebela/db";
import { createTemporaryDatabase, type TemporaryDatabase } from "@sebela/db/testing";

import { DomainError } from "../../errors.js";
import { createProfileService, type ProfileService } from "./index.js";

const lead: ExperienceCreate = {
  slug: "northwind-lead",
  title: "Lead Engineer",
  kind: "main_job",
  organization: "northwind",
  startedOn: "2021-03-01",
  endedOn: "2024-06-30",
  summary: "Led a fictional logistics platform.",
  responsibilities: ["Designed the routing service"],
  inCv: true,
  technologies: ["typescript", "postgres"],
};

const founder: ExperienceCreate = {
  ...lead,
  slug: "acme-founder",
  title: "Founder",
  kind: "own_business",
  organization: "acme",
  startedOn: "2023-01-01",
  endedOn: null,
  technologies: [],
};

describe("experience service", () => {
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
  });

  afterAll(async () => {
    await persistence.close();
    await database.drop();
  });

  beforeEach(async () => {
    for (const { slug } of await persistence.profile.listExperiences()) {
      await persistence.profile.deleteExperience(slug);
    }
  });

  it("lists no experiences", async () => {
    await expect(profile.listExperiences()).resolves.toEqual([]);
  });

  it("creates experiences in the contract shape with resolved relations", async () => {
    const created = await profile.createExperience(lead);

    expect(ExperienceSchema.parse(created)).toEqual(created);
    const { organization, technologies, ...fields } = lead;
    expect(created).toMatchObject(fields);
    expect(created.organization).toMatchObject({ slug: organization, name: "northwind" });
    expect(created.technologies.map((technology) => technology.slug)).toEqual(technologies);
    await expect(profile.getExperience("northwind-lead")).resolves.toEqual(created);
  });

  it("lists current roles first", async () => {
    const past = await profile.createExperience(lead);
    const current = await profile.createExperience(founder);

    const listed = await profile.listExperiences();

    expect(ExperienceListSchema.parse(listed)).toEqual([current, past]);
  });

  it("reports an unknown slug as not found", async () => {
    await expect(profile.getExperience("missing")).rejects.toBeInstanceOf(DomainError);
    await expect(profile.getExperience("missing")).rejects.toMatchObject({ code: "not_found" });
    await expect(profile.updateExperience("missing", { title: "X" })).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(profile.deleteExperience("missing")).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("refuses a duplicate slug as a conflict", async () => {
    await profile.createExperience(lead);

    await expect(profile.createExperience(lead)).rejects.toMatchObject({ code: "conflict" });
  });

  const refusals: [string, Partial<ExperienceCreate>, string, string][] = [
    ["an unknown organization", { organization: "missing" }, "organization", "missing"],
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
    await expect(profile.createExperience({ ...lead, ...change })).rejects.toMatchObject({
      code: "validation_failed",
      fields: [{ path, message: expect.stringContaining(text) as unknown }],
    });
    await expect(profile.listExperiences()).resolves.toEqual([]);
  });

  it.each(refusals)("refuses an update with %s and changes nothing", async (_, change, path) => {
    const created = await profile.createExperience(lead);

    await expect(
      profile.updateExperience("northwind-lead", { title: "Changed", ...change }),
    ).rejects.toMatchObject({ code: "validation_failed", fields: [{ path }] });
    await expect(profile.getExperience("northwind-lead")).resolves.toEqual(created);
  });

  it("changes only the given fields and keeps the technologies when they are omitted", async () => {
    const created = await profile.createExperience(lead);
    const changes: ExperienceUpdate = { endedOn: null, organization: "acme", summary: undefined };

    const updated = await profile.updateExperience("northwind-lead", changes);

    expect(updated).toMatchObject({ endedOn: null, summary: lead.summary, title: lead.title });
    expect(updated.organization.slug).toBe("acme");
    expect(updated.technologies).toEqual(created.technologies);
    expect(updated.id).toBe(created.id);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt));
  });

  it("replaces the technologies with a given list", async () => {
    await profile.createExperience(lead);

    const updated = await profile.updateExperience("northwind-lead", {
      technologies: ["rust", "typescript"],
    });

    expect(updated.technologies.map((technology) => technology.slug)).toEqual([
      "rust",
      "typescript",
    ]);
  });

  it("deletes an experience", async () => {
    await profile.createExperience(lead);

    await profile.deleteExperience("northwind-lead");

    await expect(profile.getExperience("northwind-lead")).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("refuses to delete a referenced experience as a conflict", async () => {
    // Persistence reports a reference that a foreign key holds (tested in @sebela/db); no table
    // refers to experiences yet.
    const referenced = createProfileService({
      ...persistence.profile,
      deleteExperience: () => Promise.resolve({ ok: false, reason: "referenced" }),
    });

    await expect(referenced.deleteExperience("northwind-lead")).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining("northwind-lead") as unknown,
    });
  });

  it("refuses to delete an organization or a technology an experience uses as a conflict", async () => {
    await profile.createExperience(lead);

    await expect(profile.deleteOrganization("northwind")).rejects.toMatchObject({
      code: "conflict",
    });
    await expect(profile.deleteTechnology("postgres")).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining("postgres") as unknown,
    });
    await expect(profile.getExperience("northwind-lead")).resolves.toMatchObject({
      organization: { slug: "northwind" },
    });
    await expect(profile.getTechnology("postgres")).resolves.toMatchObject({ slug: "postgres" });
  });
});
