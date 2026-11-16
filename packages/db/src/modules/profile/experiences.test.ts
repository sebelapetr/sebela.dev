import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { readDatabaseConfig } from "../../config.js";
import { openConnection, type Connection } from "../../connection.js";
import { createTemporaryDatabase, type TemporaryDatabase } from "../../testing.js";
import {
  createProfilePersistence,
  type ExperienceFields,
  type ExperienceRelations,
  type ProfilePersistence,
} from "./index.js";

type ExperienceInput = ExperienceFields & ExperienceRelations & { slug: string };

const lead: ExperienceInput = {
  slug: "northwind-lead",
  title: "Lead Engineer",
  kind: "main_job",
  organization: "northwind",
  startedOn: "2021-03-01",
  endedOn: "2024-06-30",
  summary: "Led a fictional logistics platform.",
  responsibilities: ["Designed the routing service", "Mentored two engineers"],
  inCv: true,
  technologies: ["typescript", "postgres"],
};

const experience = (
  slug: string,
  startedOn: string,
  endedOn: string | null,
  overrides: Partial<ExperienceInput> = {},
): ExperienceInput => ({
  ...lead,
  slug,
  startedOn,
  endedOn,
  technologies: [],
  ...overrides,
});

describe("experience persistence", () => {
  let database: TemporaryDatabase;
  let connection: Connection;
  let profile: ProfilePersistence;

  /** Counts every stored row of a table; the subject here is persistence integrity. */
  async function count(table: "experiences" | "experience_technologies") {
    const result = await connection.db.execute<{ count: string }>(
      sql`SELECT count(*) AS count FROM ${sql.identifier("profile")}.${sql.identifier(table)}`,
    );
    return Number(result.rows[0]?.count);
  }

  const technologySlugs = async (slug: string) =>
    (await profile.findExperience(slug))?.technologies.map((technology) => technology.slug);

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
    for (const { slug } of await profile.listExperiences()) await profile.deleteExperience(slug);
  });

  it("lists nothing while there are no experiences", async () => {
    await expect(profile.listExperiences()).resolves.toEqual([]);
  });

  it("creates an experience with its organization and technologies resolved", async () => {
    const created = await profile.createExperience(lead);

    const { organization, technologies, ...fields } = lead;
    expect(created).toMatchObject({ ok: true, experience: fields });
    const found = await profile.findExperience("northwind-lead");
    expect(found).toMatchObject(fields);
    expect(found?.id).toEqual(expect.any(String));
    expect(found?.createdAt).toBeInstanceOf(Date);
    expect(found?.updatedAt).toBeInstanceOf(Date);
    expect(found?.organization).toMatchObject({ slug: organization, name: "northwind" });
    expect(found?.technologies.map((technology) => technology.slug)).toEqual(technologies);
    expect(found?.technologies[0]).toMatchObject({ name: "typescript", tier: "secondary" });
  });

  it("keeps the technologies in the order they were given", async () => {
    await profile.createExperience({ ...lead, technologies: ["rust", "typescript", "postgres"] });

    await expect(technologySlugs("northwind-lead")).resolves.toEqual([
      "rust",
      "typescript",
      "postgres",
    ]);
  });

  it("stores a current role without an end, responsibilities or technologies", async () => {
    await profile.createExperience(
      experience("acme-founder", "2023-01-01", null, { responsibilities: [] }),
    );

    await expect(profile.findExperience("acme-founder")).resolves.toMatchObject({
      endedOn: null,
      responsibilities: [],
      technologies: [],
    });
  });

  it("finds nothing for an unknown slug", async () => {
    await expect(profile.findExperience("missing")).resolves.toBeNull();
  });

  it("orders current roles first, then by latest start, latest end and slug", async () => {
    await profile.createExperience(experience("old", "2015-01-01", "2016-01-01"));
    await profile.createExperience(experience("current-early", "2018-01-01", null));
    await profile.createExperience(experience("recent-b", "2022-01-01", "2023-01-01"));
    await profile.createExperience(experience("recent-a", "2022-01-01", "2023-01-01"));
    await profile.createExperience(experience("recent-longer", "2022-01-01", "2024-01-01"));
    await profile.createExperience(experience("current-late", "2024-01-01", null));

    const slugs = (await profile.listExperiences()).map((record) => record.slug);

    expect(slugs).toEqual([
      "current-late",
      "current-early",
      "recent-longer",
      "recent-a",
      "recent-b",
      "old",
    ]);
  });

  it("lists every experience with its own technologies", async () => {
    await profile.createExperience(lead);
    await profile.createExperience(
      experience("acme-founder", "2023-01-01", null, {
        organization: "acme",
        technologies: ["rust"],
      }),
    );

    const listed = await profile.listExperiences();

    expect(
      listed.map((record) => [
        record.slug,
        record.organization.slug,
        record.technologies.map((technology) => technology.slug),
      ]),
    ).toEqual([
      ["acme-founder", "acme", ["rust"]],
      ["northwind-lead", "northwind", ["typescript", "postgres"]],
    ]);
  });

  describe("an invalid create writes nothing", () => {
    it("refuses an unknown organization", async () => {
      await expect(profile.createExperience({ ...lead, organization: "missing" })).resolves.toEqual(
        { ok: false, reason: "unknown_organization" },
      );
      expect(await count("experiences")).toBe(0);
      expect(await count("experience_technologies")).toBe(0);
    });

    it("refuses unknown technologies and names them", async () => {
      await expect(
        profile.createExperience({
          ...lead,
          technologies: ["typescript", "cobol", "postgres", "fortran"],
        }),
      ).resolves.toEqual({
        ok: false,
        reason: "unknown_technologies",
        slugs: ["cobol", "fortran"],
      });
      expect(await count("experiences")).toBe(0);
      expect(await count("experience_technologies")).toBe(0);
    });

    it("refuses a repeated technology", async () => {
      await expect(
        profile.createExperience({ ...lead, technologies: ["typescript", "rust", "typescript"] }),
      ).resolves.toEqual({ ok: false, reason: "repeated_technologies" });
      expect(await count("experiences")).toBe(0);
      expect(await count("experience_technologies")).toBe(0);
    });

    it("refuses an end before the start", async () => {
      await expect(
        profile.createExperience({ ...lead, startedOn: "2024-01-02", endedOn: "2024-01-01" }),
      ).resolves.toEqual({ ok: false, reason: "invalid_period" });
      expect(await count("experiences")).toBe(0);
      expect(await count("experience_technologies")).toBe(0);
    });
  });

  it("refuses a duplicate slug as a conflict, also for concurrent creates", async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, () => profile.createExperience(lead)),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual(
      Array.from({ length: 3 }, () => ({ ok: false, reason: "conflict" })),
    );
    expect(await count("experiences")).toBe(1);
    expect(await count("experience_technologies")).toBe(2);
  });

  describe("updates", () => {
    it("changes given fields, keeps the slug, id and createdAt and advances updatedAt", async () => {
      const created = await profile.createExperience(lead);
      if (!created.ok) throw new Error("expected an experience");

      const updated = await profile.updateExperience("northwind-lead", {
        title: "Staff Engineer",
        endedOn: null,
        organization: "acme",
      });

      expect(updated).toMatchObject({
        ok: true,
        experience: {
          slug: "northwind-lead",
          title: "Staff Engineer",
          endedOn: null,
          summary: lead.summary,
          id: created.experience.id,
          createdAt: created.experience.createdAt,
          organization: { slug: "acme" },
        },
      });
      if (!updated.ok) throw new Error("expected an experience");
      expect(updated.experience.updatedAt.getTime()).toBeGreaterThan(
        created.experience.updatedAt.getTime(),
      );
    });

    it("keeps the technologies when they are omitted", async () => {
      await profile.createExperience(lead);

      await profile.updateExperience("northwind-lead", { inCv: false });

      await expect(technologySlugs("northwind-lead")).resolves.toEqual(["typescript", "postgres"]);
    });

    it("replaces every technology link with a given list, in its order", async () => {
      await profile.createExperience(lead);

      const updated = await profile.updateExperience("northwind-lead", {
        technologies: ["rust", "typescript"],
      });

      expect(updated.ok).toBe(true);
      await expect(technologySlugs("northwind-lead")).resolves.toEqual(["rust", "typescript"]);
      expect(await count("experience_technologies")).toBe(2);
    });

    it("removes every technology link with an empty list and advances updatedAt", async () => {
      const created = await profile.createExperience(lead);
      if (!created.ok) throw new Error("expected an experience");

      const updated = await profile.updateExperience("northwind-lead", { technologies: [] });

      expect(updated).toMatchObject({ ok: true, experience: { technologies: [] } });
      if (!updated.ok) throw new Error("expected an experience");
      expect(updated.experience.updatedAt.getTime()).toBeGreaterThan(
        created.experience.updatedAt.getTime(),
      );
      expect(await count("experience_technologies")).toBe(0);
    });

    it("updates nothing for an unknown slug", async () => {
      await expect(profile.updateExperience("missing", { title: "Missing" })).resolves.toEqual({
        ok: false,
        reason: "not_found",
      });
    });

    // Each change also replaces the technologies and the title, so a refusal must undo them.
    const refusals: [string, Partial<ExperienceInput>, object][] = [
      ["an unknown organization", { organization: "missing" }, { reason: "unknown_organization" }],
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
      const created = await profile.createExperience(lead);
      if (!created.ok) throw new Error("expected an experience");

      const result = await profile.updateExperience("northwind-lead", {
        title: "Changed",
        technologies: ["rust"],
        ...changes,
      });

      expect(result).toEqual({ ok: false, ...failure });
      await expect(profile.findExperience("northwind-lead")).resolves.toEqual(created.experience);
      expect(await count("experience_technologies")).toBe(2);
    });

    it("leaves exactly one of several concurrent technology replacements", async () => {
      await profile.createExperience(lead);
      const lists = [["rust"], ["typescript", "postgres"], ["postgres", "rust", "typescript"], []];

      const results = await Promise.all(
        lists.map((technologies) => profile.updateExperience("northwind-lead", { technologies })),
      );

      expect(results.every((result) => result.ok)).toBe(true);
      const stored = await technologySlugs("northwind-lead");
      expect(lists).toContainEqual(stored);
      expect(await count("experience_technologies")).toBe(stored?.length);
    });
  });

  describe("deletes", () => {
    it("deletes an experience once, with only its own technology links", async () => {
      await profile.createExperience(lead);
      await profile.createExperience(
        experience("acme-founder", "2023-01-01", null, { technologies: ["typescript"] }),
      );

      await expect(profile.deleteExperience("northwind-lead")).resolves.toEqual({ ok: true });
      await expect(profile.deleteExperience("northwind-lead")).resolves.toEqual({
        ok: false,
        reason: "not_found",
      });

      await expect(profile.findExperience("northwind-lead")).resolves.toBeNull();
      await expect(technologySlugs("acme-founder")).resolves.toEqual(["typescript"]);
      expect(await count("experience_technologies")).toBe(1);
      await expect(profile.findOrganization("northwind")).resolves.not.toBeNull();
      await expect(profile.findTechnology("postgres")).resolves.not.toBeNull();
    });

    it("refuses to delete an experience that another record references", async () => {
      // A stand-in for a later referencing table, such as projects: a plain foreign key.
      await connection.db.execute(
        sql`CREATE TABLE profile.fictional_references (
          experience_id uuid NOT NULL REFERENCES profile.experiences (id)
        )`,
      );
      const created = await profile.createExperience(lead);
      if (!created.ok) throw new Error("expected an experience");
      await connection.db.execute(
        sql`INSERT INTO profile.fictional_references VALUES (${created.experience.id})`,
      );

      await expect(profile.deleteExperience("northwind-lead")).resolves.toEqual({
        ok: false,
        reason: "referenced",
      });
      await expect(profile.findExperience("northwind-lead")).resolves.toEqual(created.experience);
    });

    it("refuses to delete an organization that an experience refers to", async () => {
      await profile.createExperience(lead);

      await expect(profile.deleteOrganization("northwind")).resolves.toEqual({
        ok: false,
        reason: "referenced",
      });
      await expect(profile.findOrganization("northwind")).resolves.not.toBeNull();
    });

    it("refuses to delete a technology that an experience links to", async () => {
      await profile.createExperience(lead);

      await expect(profile.deleteTechnology("postgres")).resolves.toEqual({
        ok: false,
        reason: "referenced",
      });
      await expect(technologySlugs("northwind-lead")).resolves.toEqual(["typescript", "postgres"]);
    });

    it("deletes a technology and an organization once nothing refers to them", async () => {
      await profile.createOrganization({
        slug: "spare",
        name: "Spare",
        website: null,
        description: null,
      });
      await profile.createTechnology({
        slug: "spare",
        name: "Spare",
        tier: "secondary",
        group: null,
        logoKey: null,
        position: 9,
      });
      await profile.createExperience({
        ...lead,
        organization: "spare",
        technologies: ["spare"],
      });
      await profile.deleteExperience("northwind-lead");

      await expect(profile.deleteTechnology("spare")).resolves.toEqual({ ok: true });
      await expect(profile.deleteOrganization("spare")).resolves.toEqual({ ok: true });
    });
  });
});
