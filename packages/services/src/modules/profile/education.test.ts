import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  EducationListSchema,
  EducationSchema,
  educationKinds,
  type EducationCreate,
  type EducationUpdate,
} from "@sebela/contracts";
import { createPersistence, readDatabaseConfig, type Persistence } from "@sebela/db";
import { createTemporaryDatabase, type TemporaryDatabase } from "@sebela/db/testing";

import { DomainError } from "../../errors.js";
import { createProfileService, type ProfileService } from "./index.js";

/** A fictional school with a full period. */
const harbourTech: EducationCreate = {
  slug: "harbour-tech",
  kind: "school",
  title: "Software engineering",
  institution: "Harbour Technical College",
  startedOn: "2008-09-01",
  endedOn: "2012-06-30",
  description: "A **fictional** degree used in tests.",
  position: 1,
};

/** A fictional certification awarded on one day. */
const cloudAssociate: EducationCreate = {
  slug: "cloud-associate",
  kind: "certification",
  title: "Cloud associate",
  institution: null,
  startedOn: null,
  endedOn: "2021-05-14",
  description: null,
  position: 0,
};

describe("education service", () => {
  let database: TemporaryDatabase;
  let persistence: Persistence;
  let profile: ProfileService;

  beforeAll(async () => {
    database = await createTemporaryDatabase(readDatabaseConfig(process.env));
    persistence = createPersistence(database.config);
    profile = createProfileService(persistence.profile);
  });

  afterAll(async () => {
    await persistence.close();
    await database.drop();
  });

  beforeEach(async () => {
    for (const { slug } of await persistence.profile.listEducation()) {
      await persistence.profile.deleteEducation(slug);
    }
  });

  it("lists no education", async () => {
    await expect(profile.listEducation()).resolves.toEqual([]);
  });

  it("creates education in the contract shape", async () => {
    const created = await profile.createEducation(harbourTech);

    expect(EducationSchema.parse(created)).toEqual(created);
    expect(created).toMatchObject(harbourTech);
    await expect(profile.getEducation("harbour-tech")).resolves.toEqual(created);
  });

  it("creates a record with only an end date and no institution", async () => {
    const created = await profile.createEducation(cloudAssociate);

    expect(EducationSchema.parse(created)).toEqual(created);
    expect(created).toMatchObject(cloudAssociate);
  });

  it.each(educationKinds)("returns the kind %s exactly as written", async (kind) => {
    await profile.createEducation({ ...harbourTech, kind });

    await expect(profile.getEducation("harbour-tech")).resolves.toMatchObject({ kind });
  });

  it("lists education by position, then slug", async () => {
    const later = await profile.createEducation(harbourTech);
    const first = await profile.createEducation(cloudAssociate);
    const tied = await profile.createEducation({ ...cloudAssociate, slug: "data-course" });

    const listed = await profile.listEducation();

    expect(EducationListSchema.parse(listed)).toEqual([first, tied, later]);
  });

  it("reports an unknown slug as not found", async () => {
    await expect(profile.getEducation("missing")).rejects.toBeInstanceOf(DomainError);
    await expect(profile.getEducation("missing")).rejects.toMatchObject({ code: "not_found" });
    await expect(profile.updateEducation("missing", { title: "X" })).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(profile.deleteEducation("missing")).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("refuses a duplicate slug as a conflict", async () => {
    await profile.createEducation(harbourTech);

    await expect(profile.createEducation(harbourTech)).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining("harbour-tech") as unknown,
    });
  });

  it("refuses a create with an end before the start as invalid, naming the end", async () => {
    await expect(
      profile.createEducation({ ...harbourTech, endedOn: "2000-01-01" }),
    ).rejects.toMatchObject({
      code: "validation_failed",
      fields: [{ path: "endedOn", message: expect.stringContaining("start") as unknown }],
    });
    await expect(profile.listEducation()).resolves.toEqual([]);
  });

  it("refuses a create without any date as invalid, naming both dates", async () => {
    await expect(
      profile.createEducation({ ...harbourTech, startedOn: null, endedOn: null }),
    ).rejects.toMatchObject({
      code: "validation_failed",
      fields: [{ path: "startedOn" }, { path: "endedOn" }],
    });
    await expect(profile.listEducation()).resolves.toEqual([]);
  });

  it.each([
    ["an end before the stored start", { endedOn: "2000-01-01" }, [{ path: "endedOn" }]],
    ["a start after the stored end", { startedOn: "2020-01-01" }, [{ path: "endedOn" }]],
    [
      "clearing both dates",
      { startedOn: null, endedOn: null },
      [{ path: "startedOn" }, { path: "endedOn" }],
    ],
  ])("refuses an update with %s and changes nothing", async (_, change, fields) => {
    const created = await profile.createEducation(harbourTech);

    await expect(
      profile.updateEducation("harbour-tech", { title: "Changed", ...change }),
    ).rejects.toMatchObject({ code: "validation_failed", fields });
    await expect(profile.getEducation("harbour-tech")).resolves.toEqual(created);
  });

  it("refuses clearing the only stored date, naming both dates", async () => {
    await profile.createEducation(cloudAssociate);

    await expect(
      profile.updateEducation("cloud-associate", { endedOn: null }),
    ).rejects.toMatchObject({
      code: "validation_failed",
      fields: [{ path: "startedOn" }, { path: "endedOn" }],
    });
  });

  it("changes only the given fields", async () => {
    const created = await profile.createEducation(harbourTech);
    const changes: EducationUpdate = { kind: "course", endedOn: null, title: undefined };

    const updated = await profile.updateEducation("harbour-tech", changes);

    expect(updated).toMatchObject({ kind: "course", endedOn: null, title: harbourTech.title });
    expect(updated.id).toBe(created.id);
    expect(updated.slug).toBe(created.slug);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt));
  });

  it("deletes an education record", async () => {
    await profile.createEducation(harbourTech);

    await profile.deleteEducation("harbour-tech");

    await expect(profile.getEducation("harbour-tech")).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("leaves the career timeline untouched", async () => {
    await profile.createEducation(harbourTech);

    await expect(profile.listExperiences()).resolves.toEqual([]);
    await expect(profile.listProjects()).resolves.toEqual([]);
  });
});
