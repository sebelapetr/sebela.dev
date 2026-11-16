import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  ExperienceSchema,
  TestimonialListSchema,
  TestimonialSchema,
  type TestimonialCreate,
  type TestimonialUpdate,
} from "@sebela/contracts";
import { createPersistence, readDatabaseConfig, type Persistence } from "@sebela/db";
import { createTemporaryDatabase, type TemporaryDatabase } from "@sebela/db/testing";

import { DomainError } from "../../errors.js";
import { createProfileService, type ProfileService } from "./index.js";

/** A fictional quote by a fictional colleague. */
const kindWords: TestimonialCreate = {
  slug: "dana-on-routing",
  experience: "northwind-lead",
  quote: "Planning our fictional delivery routes went from a day to a coffee break.",
  authorName: "Dana Placeholder",
  authorRole: "Head of Operations",
  position: 1,
};

const praise: TestimonialCreate = {
  ...kindWords,
  slug: "lee-on-fleet",
  quote: "The fictional fleet dashboard finally told us where the vans were.",
  authorName: "Lee Example",
  authorRole: "Dispatcher",
  position: 2,
};

describe("testimonial service", () => {
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
    await profile.createExperience({
      ...experience,
      slug: "acme-founder",
      organization: "acme",
      startedOn: "2023-01-01",
      endedOn: null,
    });
  });

  afterAll(async () => {
    await persistence.close();
    await database.drop();
  });

  beforeEach(async () => {
    for (const { slug } of await persistence.profile.listTestimonials()) {
      await persistence.profile.deleteTestimonial(slug);
    }
  });

  it("lists no testimonials", async () => {
    await expect(profile.listTestimonials()).resolves.toEqual([]);
  });

  it("creates testimonials in the contract shape", async () => {
    const created = await profile.createTestimonial(kindWords);

    expect(TestimonialSchema.parse(created)).toEqual(created);
    expect(created).toMatchObject(kindWords);
    await expect(profile.getTestimonial("dana-on-routing")).resolves.toEqual(created);
  });

  it("lists testimonials by experience order, then by position", async () => {
    const later = await profile.createTestimonial(praise);
    const first = await profile.createTestimonial(kindWords);
    const current = await profile.createTestimonial({
      ...praise,
      slug: "kim-on-shop",
      experience: "acme-founder",
      position: 9,
    });

    const listed = await profile.listTestimonials();

    expect(TestimonialListSchema.parse(listed)).toEqual([current, first, later]);
  });

  it("puts the testimonials into their experience in order, beside its organization", async () => {
    const later = await profile.createTestimonial(praise);
    const first = await profile.createTestimonial(kindWords);

    const experience = await profile.getExperience("northwind-lead");

    expect(ExperienceSchema.parse(experience)).toEqual(experience);
    expect(experience.testimonials).toEqual([first, later]);
    expect(experience.organization.slug).toBe("northwind");
    await expect(profile.listExperiences()).resolves.toMatchObject([
      { slug: "acme-founder", testimonials: [] },
      { slug: "northwind-lead", testimonials: [first, later] },
    ]);
  });

  it("reports an unknown slug as not found", async () => {
    await expect(profile.getTestimonial("missing")).rejects.toBeInstanceOf(DomainError);
    await expect(profile.getTestimonial("missing")).rejects.toMatchObject({ code: "not_found" });
    await expect(profile.updateTestimonial("missing", { quote: "X" })).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(profile.deleteTestimonial("missing")).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("refuses a duplicate slug as a conflict", async () => {
    await profile.createTestimonial(kindWords);

    await expect(
      profile.createTestimonial({ ...kindWords, experience: "acme-founder" }),
    ).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining("dana-on-routing") as unknown,
    });
  });

  it("refuses a create with an unknown experience as invalid", async () => {
    await expect(
      profile.createTestimonial({ ...kindWords, experience: "missing" }),
    ).rejects.toMatchObject({
      code: "validation_failed",
      fields: [{ path: "experience", message: expect.stringContaining("missing") as unknown }],
    });
    await expect(profile.listTestimonials()).resolves.toEqual([]);
  });

  it("refuses an update with an unknown experience and changes nothing", async () => {
    const created = await profile.createTestimonial(kindWords);

    await expect(
      profile.updateTestimonial("dana-on-routing", { quote: "Changed.", experience: "missing" }),
    ).rejects.toMatchObject({ code: "validation_failed", fields: [{ path: "experience" }] });
    await expect(profile.getTestimonial("dana-on-routing")).resolves.toEqual(created);
  });

  it("changes only the given fields", async () => {
    const created = await profile.createTestimonial(kindWords);
    const changes: TestimonialUpdate = { authorRole: "Chief Operating Officer", quote: undefined };

    const updated = await profile.updateTestimonial("dana-on-routing", changes);

    expect(updated).toMatchObject({
      authorRole: "Chief Operating Officer",
      quote: kindWords.quote,
      authorName: kindWords.authorName,
      experience: "northwind-lead",
    });
    expect(updated.id).toBe(created.id);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt));
  });

  it("moves a testimonial to another experience", async () => {
    await profile.createTestimonial(kindWords);

    const moved = await profile.updateTestimonial("dana-on-routing", {
      experience: "acme-founder",
    });

    expect(moved.experience).toBe("acme-founder");
    await expect(profile.getExperience("acme-founder")).resolves.toMatchObject({
      testimonials: [moved],
    });
    await expect(profile.getExperience("northwind-lead")).resolves.toMatchObject({
      testimonials: [],
    });
  });

  it("deletes a testimonial and keeps its experience", async () => {
    await profile.createTestimonial(kindWords);

    await profile.deleteTestimonial("dana-on-routing");

    await expect(profile.getTestimonial("dana-on-routing")).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(profile.getExperience("northwind-lead")).resolves.toMatchObject({
      testimonials: [],
    });
  });

  it("refuses to delete an experience with a testimonial as a conflict that names it", async () => {
    const created = await profile.createTestimonial(kindWords);

    await expect(profile.deleteExperience("northwind-lead")).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringMatching(/northwind-lead.*testimonials/) as unknown,
    });
    await expect(profile.getTestimonial("dana-on-routing")).resolves.toEqual(created);
  });
});
