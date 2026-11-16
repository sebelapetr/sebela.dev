import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { readDatabaseConfig } from "../../config.js";
import { openConnection, type Connection } from "../../connection.js";
import { createTemporaryDatabase, type TemporaryDatabase } from "../../testing.js";
import {
  createProfilePersistence,
  type EducationFields,
  type EducationKind,
  type ProfilePersistence,
} from "./index.js";

type EducationInput = EducationFields & { slug: string };

/** A fictional school with a full period. */
const harbourTech: EducationInput = {
  slug: "harbour-tech",
  kind: "school",
  title: "Software engineering",
  institution: "Harbour Technical College",
  startedOn: "2008-09-01",
  endedOn: "2012-06-30",
  description: "A **fictional** degree used in tests.",
  position: 1,
};

const education = (
  slug: string,
  position: number,
  overrides: Partial<EducationInput> = {},
): EducationInput => ({ ...harbourTech, slug, position, ...overrides });

const kinds: EducationKind[] = ["school", "course", "certification", "milestone"];

describe("education persistence", () => {
  let database: TemporaryDatabase;
  let connection: Connection;
  let profile: ProfilePersistence;

  /** Counts every stored education row; the subject here is persistence integrity. */
  async function count() {
    const result = await connection.db.execute<{ count: string }>(
      sql`SELECT count(*) AS count FROM profile.education`,
    );
    return Number(result.rows[0]?.count);
  }

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
    for (const { slug } of await profile.listEducation()) await profile.deleteEducation(slug);
  });

  it("lists nothing while there is no education", async () => {
    await expect(profile.listEducation()).resolves.toEqual([]);
  });

  it("creates an education record and reads it back by slug", async () => {
    const created = await profile.createEducation(harbourTech);

    expect(created).toMatchObject({ ok: true, education: harbourTech });
    const found = await profile.findEducation("harbour-tech");
    expect(found).toMatchObject(harbourTech);
    expect(found?.id).toEqual(expect.any(String));
    expect(found?.createdAt).toBeInstanceOf(Date);
    expect(found?.updatedAt).toBeInstanceOf(Date);
  });

  it.each(kinds)("stores and returns the kind %s exactly", async (kind) => {
    await profile.createEducation({ ...harbourTech, kind });

    await expect(profile.findEducation("harbour-tech")).resolves.toMatchObject({ kind });
  });

  it.each([
    ["a start without an end", { startedOn: "2024-01-15", endedOn: null }],
    ["an end without a start", { startedOn: null, endedOn: "2021-05-14" }],
    ["a single day", { startedOn: "2019-03-02", endedOn: "2019-03-02" }],
  ])("stores %s", async (_, period) => {
    await profile.createEducation({ ...harbourTech, ...period });

    await expect(profile.findEducation("harbour-tech")).resolves.toMatchObject(period);
  });

  it("stores a record without institution and description", async () => {
    await profile.createEducation({ ...harbourTech, institution: null, description: null });

    await expect(profile.findEducation("harbour-tech")).resolves.toMatchObject({
      institution: null,
      description: null,
    });
  });

  it("finds nothing for an unknown slug", async () => {
    await expect(profile.findEducation("missing")).resolves.toBeNull();
  });

  it("lists by position, then by slug for equal positions", async () => {
    await profile.createEducation(education("delta", 2));
    await profile.createEducation(education("charlie", 1));
    await profile.createEducation(education("bravo", 2));
    await profile.createEducation(education("alpha", 3));

    const listed = await profile.listEducation();
    expect(listed.map(({ slug }) => slug)).toEqual(["charlie", "bravo", "delta", "alpha"]);
  });

  it("refuses a duplicate slug as a conflict, also for concurrent creates", async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, () => profile.createEducation(harbourTech)),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual(
      Array.from({ length: 3 }, () => ({ ok: false, reason: "conflict" })),
    );
    expect(await count()).toBe(1);
  });

  describe("an invalid create writes nothing", () => {
    it.each([
      [
        "an end before the start",
        { startedOn: "2012-01-02", endedOn: "2012-01-01" },
        "invalid_period",
      ],
      ["no date at all", { startedOn: null, endedOn: null }, "undated_period"],
    ])("refuses %s", async (_, period, reason) => {
      await expect(profile.createEducation({ ...harbourTech, ...period })).resolves.toEqual({
        ok: false,
        reason,
      });
      expect(await count()).toBe(0);
    });

    it("refuses a kind outside the defined ones in the database itself", async () => {
      await expect(
        connection.db.execute(
          sql`INSERT INTO profile.education (slug, kind, title, started_on, position)
              VALUES ('rogue', 'bootcamp', 'Rogue', '2025-01-01', 0)`,
        ),
      ).rejects.toThrow();
      expect(await count()).toBe(0);
    });

    it("refuses a negative position in the database itself", async () => {
      await expect(
        connection.db.execute(
          sql`INSERT INTO profile.education (slug, kind, title, started_on, position)
              VALUES ('rogue', 'course', 'Rogue', '2025-01-01', -1)`,
        ),
      ).rejects.toThrow();
      expect(await count()).toBe(0);
    });
  });

  describe("updates", () => {
    it("changes given fields, keeps the slug, id and createdAt and advances updatedAt", async () => {
      const created = await profile.createEducation(harbourTech);
      if (!created.ok) throw new Error("expected an education record");

      const updated = await profile.updateEducation("harbour-tech", {
        kind: "course",
        title: "Evening course",
        institution: null,
        endedOn: null,
      });

      expect(updated).toEqual({
        ok: true,
        education: {
          ...created.education,
          kind: "course",
          title: "Evening course",
          institution: null,
          endedOn: null,
          updatedAt: expect.any(Date) as Date,
        },
      });
      if (!updated.ok) throw new Error("expected an education record");
      expect(updated.education.updatedAt.getTime()).toBeGreaterThan(
        created.education.updatedAt.getTime(),
      );
    });

    it("clears the start while the end stays", async () => {
      await profile.createEducation(harbourTech);

      await expect(
        profile.updateEducation("harbour-tech", { startedOn: null }),
      ).resolves.toMatchObject({ ok: true, education: { startedOn: null, endedOn: "2012-06-30" } });
    });

    it("updates nothing for an unknown slug", async () => {
      await expect(profile.updateEducation("missing", { title: "Missing" })).resolves.toEqual({
        ok: false,
        reason: "not_found",
      });
    });

    it.each([
      ["an end before the stored start", { endedOn: "2000-01-01" }, "invalid_period"],
      ["a start after the stored end", { startedOn: "2020-01-01" }, "invalid_period"],
      ["clearing both dates", { startedOn: null, endedOn: null }, "undated_period"],
    ])("refuses %s and changes nothing", async (_, changes, reason) => {
      const created = await profile.createEducation(harbourTech);
      if (!created.ok) throw new Error("expected an education record");

      const result = await profile.updateEducation("harbour-tech", {
        title: "Changed",
        ...changes,
      });

      expect(result).toEqual({ ok: false, reason });
      await expect(profile.findEducation("harbour-tech")).resolves.toEqual(created.education);
    });

    it("refuses clearing the only stored date", async () => {
      await profile.createEducation({ ...harbourTech, startedOn: null });

      await expect(profile.updateEducation("harbour-tech", { endedOn: null })).resolves.toEqual({
        ok: false,
        reason: "undated_period",
      });
      await expect(profile.findEducation("harbour-tech")).resolves.toMatchObject({
        endedOn: "2012-06-30",
      });
    });
  });

  describe("deletes", () => {
    it("deletes an education record once and keeps the others", async () => {
      await profile.createEducation(harbourTech);
      await profile.createEducation(education("night-course", 2));

      await expect(profile.deleteEducation("harbour-tech")).resolves.toEqual({ ok: true });
      await expect(profile.deleteEducation("harbour-tech")).resolves.toEqual({
        ok: false,
        reason: "not_found",
      });

      await expect(profile.findEducation("harbour-tech")).resolves.toBeNull();
      await expect(profile.findEducation("night-course")).resolves.not.toBeNull();
    });

    it("deletes nothing for an unknown slug", async () => {
      await expect(profile.deleteEducation("missing")).resolves.toEqual({
        ok: false,
        reason: "not_found",
      });
    });
  });
});
