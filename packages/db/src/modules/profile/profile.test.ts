import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { readDatabaseConfig } from "../../config.js";
import { openConnection, type Connection } from "../../connection.js";
import { createTemporaryDatabase, type TemporaryDatabase } from "../../testing.js";
import { createProfilePersistence, type PersonFields, type ProfilePersistence } from "./index.js";

const fictional: PersonFields = {
  name: "Ada Example",
  headline: "Fictional engineer",
  shortBio: "A made-up person for tests.",
  longBio: null,
  location: "Nowhere",
  email: "ada@example.test",
  links: [{ label: "Site", url: "https://example.test" }],
  availability: null,
  careerStartedOn: "2010-09-01",
};

describe("profile persistence", () => {
  let database: TemporaryDatabase;
  let connection: Connection;
  let profile: ProfilePersistence;

  beforeAll(async () => {
    database = await createTemporaryDatabase(readDatabaseConfig(process.env));
    connection = openConnection(database.config);
    profile = createProfilePersistence(connection.db);
  });

  afterAll(async () => {
    await connection.close();
    await database.drop();
  });

  beforeEach(async () => {
    await profile.deletePerson();
  });

  it("finds nothing while there is no person", async () => {
    await expect(profile.findPerson()).resolves.toBeNull();
  });

  it("creates the person and reads it back with every field", async () => {
    const created = await profile.createPerson(fictional);

    expect(created.ok).toBe(true);
    const found = await profile.findPerson();
    expect(found).toMatchObject(fictional);
    expect(found?.createdAt).toBeInstanceOf(Date);
  });

  it("refuses a second person as a conflict", async () => {
    await profile.createPerson(fictional);

    await expect(profile.createPerson(fictional)).resolves.toEqual({
      ok: false,
      reason: "conflict",
    });
  });

  it("lets exactly one of concurrent creates succeed", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => profile.createPerson(fictional)),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(4);
  });

  it("updates given fields, keeps id and createdAt and advances updatedAt", async () => {
    const created = await profile.createPerson(fictional);
    if (!created.ok) throw new Error("expected a person");

    const updated = await profile.updatePerson({
      headline: "Changed",
      longBio: "Long",
    });

    if (!updated.ok) throw new Error("expected the updated person");
    expect(updated.person).toMatchObject({ ...fictional, headline: "Changed", longBio: "Long" });
    expect(updated.person.id).toBe(created.person.id);
    expect(updated.person.createdAt).toEqual(created.person.createdAt);
    expect(updated.person.updatedAt.getTime()).toBeGreaterThan(created.person.updatedAt.getTime());
  });

  it("updates nothing while there is no person", async () => {
    await expect(profile.updatePerson({ headline: "Changed" })).resolves.toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("deletes the person once", async () => {
    await profile.createPerson(fictional);

    await expect(profile.deletePerson()).resolves.toBe(true);
    await expect(profile.deletePerson()).resolves.toBe(false);
    await expect(profile.findPerson()).resolves.toBeNull();
  });
});
