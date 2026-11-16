import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PersonSchema, type PersonCreate } from "@sebela/contracts";
import { createPersistence, readDatabaseConfig, type Persistence } from "@sebela/db";
import { createTemporaryDatabase, type TemporaryDatabase } from "@sebela/db/testing";

import { DomainError } from "../../errors.js";
import { createProfileService, type ProfileService } from "./index.js";

const fictional: PersonCreate = {
  name: "Ada Example",
  headline: "Fictional engineer",
  shortBio: "A made-up person for tests.",
  longBio: null,
  location: null,
  email: "ada@example.test",
  links: [{ label: "Site", url: "https://example.test" }],
  availability: null,
  careerStartedOn: "2010-09-01",
};

describe("profile service", () => {
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
    await profile.deletePerson().catch(() => undefined);
  });

  it("reports a missing person as not found", async () => {
    await expect(profile.getPerson()).rejects.toMatchObject({ code: "not_found" });
    await expect(profile.getPerson()).rejects.toBeInstanceOf(DomainError);
  });

  it("creates the person in the contract shape and reads it back", async () => {
    const created = await profile.createPerson(fictional);

    expect(PersonSchema.parse(created)).toEqual(created);
    expect(created).toMatchObject(fictional);
    await expect(profile.getPerson()).resolves.toEqual(created);
  });

  it("refuses a second person as a conflict", async () => {
    await profile.createPerson(fictional);

    await expect(profile.createPerson(fictional)).rejects.toMatchObject({ code: "conflict" });
  });

  it("changes only the given fields and keeps id and createdAt", async () => {
    const created = await profile.createPerson(fictional);

    const updated = await profile.updatePerson({ headline: "Changed", email: null });

    expect(updated).toMatchObject({ ...fictional, headline: "Changed", email: null });
    expect(updated.id).toBe(created.id);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt));
  });

  it("reports updating or deleting a missing person as not found", async () => {
    await expect(profile.updatePerson({ headline: "Changed" })).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(profile.deletePerson()).rejects.toMatchObject({ code: "not_found" });
  });

  it("deletes the person", async () => {
    await profile.createPerson(fictional);

    await profile.deletePerson();

    await expect(profile.getPerson()).rejects.toMatchObject({ code: "not_found" });
  });
});
