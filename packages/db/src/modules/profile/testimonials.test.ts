import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { readDatabaseConfig } from "../../config.js";
import { openConnection, type Connection } from "../../connection.js";
import { createTemporaryDatabase, type TemporaryDatabase } from "../../testing.js";
import {
  createProfilePersistence,
  type ProfilePersistence,
  type TestimonialFields,
  type TestimonialRelations,
} from "./index.js";

type TestimonialInput = TestimonialFields & TestimonialRelations & { slug: string };

/** A fictional quote by a fictional colleague. */
const kindWords: TestimonialInput = {
  slug: "dana-on-routing",
  experience: "northwind-lead",
  quote: "Planning our fictional delivery routes went from a day to a coffee break.",
  authorName: "Dana Placeholder",
  authorRole: "Head of Operations",
  position: 1,
};

const testimonial = (
  slug: string,
  experience: string,
  position: number,
  overrides: Partial<TestimonialInput> = {},
): TestimonialInput => ({ ...kindWords, slug, experience, position, ...overrides });

describe("testimonial persistence", () => {
  let database: TemporaryDatabase;
  let connection: Connection;
  let profile: ProfilePersistence;

  /** Counts every stored row of a table; the subject here is persistence integrity. */
  async function count(table: "testimonials" | "experiences") {
    const result = await connection.db.execute<{ count: string }>(
      sql`SELECT count(*) AS count FROM ${sql.identifier("profile")}.${sql.identifier(table)}`,
    );
    return Number(result.rows[0]?.count);
  }

  const testimonialSlugsOf = async (experience: string) =>
    (await profile.findExperience(experience))?.testimonials.map((record) => record.slug);

  beforeAll(async () => {
    database = await createTemporaryDatabase(readDatabaseConfig(process.env));
    connection = openConnection(database.config);
    profile = createProfilePersistence(connection.db);
    for (const slug of ["northwind", "acme"]) {
      await profile.createOrganization({ slug, name: slug, website: null, description: null });
    }
  });

  afterAll(async () => {
    await connection.close();
    await database.drop();
  });

  beforeEach(async () => {
    for (const { slug } of await profile.listTestimonials()) await profile.deleteTestimonial(slug);
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

  it("lists nothing while there are no testimonials", async () => {
    await expect(profile.listTestimonials()).resolves.toEqual([]);
    await expect(testimonialSlugsOf("northwind-lead")).resolves.toEqual([]);
  });

  it("creates a testimonial that names its experience", async () => {
    const created = await profile.createTestimonial(kindWords);

    expect(created).toMatchObject({ ok: true, testimonial: { ...kindWords, authorPhotoId: null } });
    const found = await profile.findTestimonial("dana-on-routing");
    expect(found).toMatchObject(kindWords);
    expect(found?.id).toEqual(expect.any(String));
    expect(found?.createdAt).toBeInstanceOf(Date);
    expect(found?.updatedAt).toBeInstanceOf(Date);
    if (!created.ok) throw new Error("expected a testimonial");
    expect(found).toEqual(created.testimonial);
  });

  it("finds nothing for an unknown slug", async () => {
    await expect(profile.findTestimonial("missing")).resolves.toBeNull();
  });

  it("lists testimonials by experience order, then by position and slug", async () => {
    await profile.createTestimonial(testimonial("pat", "northwind-lead", 1));
    await profile.createTestimonial(testimonial("zoe", "acme-founder", 5));
    await profile.createTestimonial(testimonial("kim", "northwind-lead", 0));
    await profile.createTestimonial(testimonial("lee", "northwind-lead", 1));
    await profile.createTestimonial(testimonial("ana", "acme-founder", 2));

    const listed = await profile.listTestimonials();

    expect(listed.map((record) => [record.experience, record.slug])).toEqual([
      ["acme-founder", "ana"],
      ["acme-founder", "zoe"],
      ["northwind-lead", "kim"],
      ["northwind-lead", "lee"],
      ["northwind-lead", "pat"],
    ]);
  });

  it("puts each experience's testimonials into it in their order, beside its projects", async () => {
    await profile.createTestimonial(testimonial("pat", "northwind-lead", 2));
    await profile.createTestimonial(kindWords);
    await profile.createTestimonial(testimonial("zoe", "acme-founder", 0));
    await profile.createProject({
      slug: "routing-engine",
      experience: "northwind-lead",
      name: "Routing engine",
      summary: "A fictional route planner.",
      problem: "Routes were planned by hand.",
      workDone: "Built the planner.",
      result: "Routes in minutes.",
      startedOn: "2022-01-01",
      endedOn: null,
      links: [],
      selectedForHomepage: false,
      position: 0,
      technologies: [],
    });

    const lead = await profile.findExperience("northwind-lead");
    expect(lead?.testimonials.map((record) => record.slug)).toEqual(["dana-on-routing", "pat"]);
    expect(lead?.testimonials[0]).toEqual(await profile.findTestimonial("dana-on-routing"));
    expect(lead?.projects.map((record) => record.slug)).toEqual(["routing-engine"]);
    expect(lead?.organization.slug).toBe("northwind");

    const listed = await profile.listExperiences();
    expect(
      listed.map((record) => [record.slug, record.testimonials.map((entry) => entry.slug)]),
    ).toEqual([
      ["acme-founder", ["zoe"]],
      ["northwind-lead", ["dana-on-routing", "pat"]],
    ]);
  });

  it("refuses an unknown experience and writes nothing", async () => {
    await expect(
      profile.createTestimonial({ ...kindWords, experience: "missing" }),
    ).resolves.toEqual({ ok: false, reason: "unknown_experience" });
    expect(await count("testimonials")).toBe(0);
  });

  it("refuses a duplicate slug as a conflict, also for concurrent creates", async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        // Also across experiences: a slug is unique among every testimonial.
        profile.createTestimonial({
          ...kindWords,
          experience: index % 2 === 0 ? "northwind-lead" : "acme-founder",
        }),
      ),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual(
      Array.from({ length: 3 }, () => ({ ok: false, reason: "conflict" })),
    );
    expect(await count("testimonials")).toBe(1);
  });

  describe("updates", () => {
    it("changes given fields, keeps the slug, id and createdAt and advances updatedAt", async () => {
      const created = await profile.createTestimonial(kindWords);
      if (!created.ok) throw new Error("expected a testimonial");

      const updated = await profile.updateTestimonial("dana-on-routing", {
        quote: "Still a fictional coffee break.",
        authorRole: "Chief Operating Officer",
      });

      expect(updated).toMatchObject({
        ok: true,
        testimonial: {
          slug: "dana-on-routing",
          quote: "Still a fictional coffee break.",
          authorRole: "Chief Operating Officer",
          authorName: kindWords.authorName,
          experience: "northwind-lead",
          id: created.testimonial.id,
          createdAt: created.testimonial.createdAt,
        },
      });
      if (!updated.ok) throw new Error("expected a testimonial");
      expect(updated.testimonial.updatedAt.getTime()).toBeGreaterThan(
        created.testimonial.updatedAt.getTime(),
      );
      await expect(profile.findTestimonial("dana-on-routing")).resolves.toEqual(
        updated.testimonial,
      );
    });

    it("moves the testimonial to another experience, which then has it alone", async () => {
      await profile.createTestimonial(kindWords);

      const moved = await profile.updateTestimonial("dana-on-routing", {
        experience: "acme-founder",
      });

      expect(moved).toMatchObject({ ok: true, testimonial: { experience: "acme-founder" } });
      await expect(testimonialSlugsOf("acme-founder")).resolves.toEqual(["dana-on-routing"]);
      await expect(testimonialSlugsOf("northwind-lead")).resolves.toEqual([]);
      expect(await count("testimonials")).toBe(1);
    });

    it("reorders the testimonials of an experience by a changed position", async () => {
      await profile.createTestimonial(testimonial("kim", "northwind-lead", 0));
      await profile.createTestimonial(testimonial("pat", "northwind-lead", 1));

      await profile.updateTestimonial("kim", { position: 3 });

      await expect(testimonialSlugsOf("northwind-lead")).resolves.toEqual(["pat", "kim"]);
    });

    it("updates nothing for an unknown slug", async () => {
      await expect(profile.updateTestimonial("missing", { quote: "Missing." })).resolves.toEqual({
        ok: false,
        reason: "not_found",
      });
    });

    it("refuses an unknown experience and changes nothing", async () => {
      const created = await profile.createTestimonial(kindWords);
      if (!created.ok) throw new Error("expected a testimonial");

      const result = await profile.updateTestimonial("dana-on-routing", {
        quote: "Changed.",
        experience: "missing",
      });

      expect(result).toEqual({ ok: false, reason: "unknown_experience" });
      await expect(profile.findTestimonial("dana-on-routing")).resolves.toEqual(
        created.testimonial,
      );
    });
  });

  describe("deletes", () => {
    it("deletes a testimonial once, never its experience", async () => {
      await profile.createTestimonial(kindWords);
      await profile.createTestimonial(testimonial("pat", "northwind-lead", 2));

      await expect(profile.deleteTestimonial("dana-on-routing")).resolves.toEqual({ ok: true });
      await expect(profile.deleteTestimonial("dana-on-routing")).resolves.toEqual({
        ok: false,
        reason: "not_found",
      });

      await expect(profile.findTestimonial("dana-on-routing")).resolves.toBeNull();
      await expect(testimonialSlugsOf("northwind-lead")).resolves.toEqual(["pat"]);
      expect(await count("experiences")).toBe(2);
    });

    it("refuses to delete an experience that a testimonial belongs to", async () => {
      await profile.createTestimonial(kindWords);
      const before = await profile.findExperience("northwind-lead");

      await expect(profile.deleteExperience("northwind-lead")).resolves.toEqual({
        ok: false,
        reason: "referenced",
      });
      await expect(profile.findExperience("northwind-lead")).resolves.toEqual(before);
      expect(await count("testimonials")).toBe(1);
    });

    it("deletes the experience once its testimonials are gone", async () => {
      await profile.createTestimonial(kindWords);
      await profile.deleteTestimonial("dana-on-routing");

      await expect(profile.deleteExperience("northwind-lead")).resolves.toEqual({ ok: true });
    });
  });
});
