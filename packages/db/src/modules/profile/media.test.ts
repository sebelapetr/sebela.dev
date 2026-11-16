import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { readDatabaseConfig } from "../../config.js";
import { openConnection, type Connection } from "../../connection.js";
import { createTemporaryDatabase, type TemporaryDatabase } from "../../testing.js";
import {
  createProfilePersistence,
  type MediaFields,
  type PersonFields,
  type ProfilePersistence,
} from "./index.js";

let sequence = 0;
const key = (extension: string) => {
  sequence += 1;
  return `test/fictional-${String(sequence)}.${extension}`;
};

const png = (): MediaFields => ({
  key: key("png"),
  mediaType: "image/png",
  byteSize: 120,
  width: 64,
  height: 32,
  altText: "A fictional logo.",
});

const pdf = (): MediaFields => ({
  key: key("pdf"),
  mediaType: "application/pdf",
  byteSize: 900,
  width: null,
  height: null,
  altText: null,
});

const person: PersonFields = {
  name: "Ada Example",
  headline: "Fictional engineer",
  shortBio: "A made-up person for tests.",
  longBio: null,
  location: null,
  email: null,
  links: [],
  availability: null,
  careerStartedOn: null,
};

describe("media persistence", () => {
  let database: TemporaryDatabase;
  let connection: Connection;
  let profile: ProfilePersistence;

  const created = async (fields: MediaFields) => profile.createMedia(fields);

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
    for (const { slug } of await profile.listProjects()) await profile.deleteProject(slug);
    for (const { slug } of await profile.listExperiences()) await profile.deleteExperience(slug);
    for (const { slug } of await profile.listOrganizations()) {
      await profile.deleteOrganization(slug);
    }
    for (const { id } of await profile.listMedia()) await profile.deleteMedia(id);
  });

  it("records media and reads it back by id and by key", async () => {
    const fields = png();
    const media = await created(fields);

    expect(media).toMatchObject(fields);
    expect(media.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(media.createdAt).toBeInstanceOf(Date);
    await expect(profile.findMedia(media.id)).resolves.toEqual(media);
    await expect(profile.findMediaByKey(fields.key)).resolves.toEqual(media);
    await expect(profile.findMedia("00000000-0000-4000-8000-000000000000")).resolves.toBeNull();
    await expect(profile.findMediaByKey("test/missing.png")).resolves.toBeNull();
  });

  it("lists media newest first", async () => {
    const first = await created(png());
    const second = await created(pdf());

    const listed = await profile.listMedia();
    expect(listed.map((media) => media.id)).toEqual([second.id, first.id]);
  });

  it("changes the alt text only and advances updatedAt", async () => {
    const media = await created(png());

    const updated = await profile.updateMedia(media.id, { altText: "Changed." });

    expect(updated).toMatchObject({ id: media.id, key: media.key, altText: "Changed." });
    expect(updated?.createdAt).toEqual(media.createdAt);
    expect(updated?.updatedAt.getTime()).toBeGreaterThan(media.updatedAt.getTime());
    await expect(profile.updateMedia(media.id, { altText: null })).resolves.toMatchObject({
      altText: null,
    });
    await expect(
      profile.updateMedia("00000000-0000-4000-8000-000000000000", { altText: "x" }),
    ).resolves.toBeNull();
  });

  it("refuses a second record with the same key", async () => {
    const fields = png();
    await created(fields);

    await expect(created({ ...pdf(), key: fields.key })).rejects.toThrow();
    expect(await profile.listMedia()).toHaveLength(1);
  });

  it.each([
    ["an empty file", { ...png(), byteSize: 0 }],
    ["an image without dimensions", { ...png(), width: null, height: null }],
    ["an image with a zero width", { ...png(), width: 0 }],
    ["a PDF with dimensions", { ...pdf(), width: 10, height: 10 }],
  ])("refuses %s in the database", async (_name, fields) => {
    await expect(created(fields)).rejects.toThrow();
    await expect(profile.listMedia()).resolves.toEqual([]);
  });

  it("refuses a media type outside the allowlist in the database", async () => {
    await expect(
      connection.db.execute(
        sql`INSERT INTO profile.media (key, media_type, byte_size) VALUES ('x/y.svg', 'image/svg+xml', 10)`,
      ),
    ).rejects.toThrow();
  });

  it("records the content digest and finds the oldest media with it", async () => {
    const digest = "a".repeat(64);
    const first = await created({ ...png(), sha256: digest });
    await created({ ...png(), sha256: digest });
    const other = await created({ ...pdf(), sha256: "b".repeat(64) });

    expect(first.sha256).toBe(digest);
    await expect(profile.findMediaByDigest(digest)).resolves.toEqual(first);
    await expect(profile.findMediaByDigest("b".repeat(64))).resolves.toEqual(other);
    await expect(profile.findMediaByDigest("c".repeat(64))).resolves.toBeNull();
  });

  it("records media without a digest as having none", async () => {
    const media = await created(png());

    expect(media.sha256).toBeNull();
    await expect(profile.findMedia(media.id)).resolves.toMatchObject({ sha256: null });
  });

  it("refuses a digest that is not 64 lower-case hexadecimal digits in the database", async () => {
    await expect(created({ ...png(), sha256: "A".repeat(64) })).rejects.toThrow();
    await expect(created({ ...png(), sha256: "a".repeat(63) })).rejects.toThrow();
    await expect(profile.listMedia()).resolves.toEqual([]);
  });

  it("deletes media once and returns the deleted record", async () => {
    const media = await created(png());

    await expect(profile.deleteMedia(media.id)).resolves.toEqual({ ok: true, media });
    await expect(profile.deleteMedia(media.id)).resolves.toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  describe("attached to the person", () => {
    it("attaches a photo and a CV PDF, refuses referenced deletes and clears them", async () => {
      const photo = await created(png());
      const cv = await created(pdf());

      const result = await profile.createPerson({ ...person, photoId: photo.id, cvPdfId: cv.id });
      expect(result).toMatchObject({ ok: true, person: { photoId: photo.id, cvPdfId: cv.id } });

      await expect(profile.deleteMedia(photo.id)).resolves.toEqual({
        ok: false,
        reason: "referenced",
      });
      await expect(profile.deleteMedia(cv.id)).resolves.toEqual({
        ok: false,
        reason: "referenced",
      });
      await expect(profile.findMedia(photo.id)).resolves.not.toBeNull();

      const cleared = await profile.updatePerson({ photoId: null, cvPdfId: null });
      expect(cleared).toMatchObject({ ok: true, person: { photoId: null, cvPdfId: null } });
      await expect(profile.deleteMedia(photo.id)).resolves.toMatchObject({ ok: true });
      await expect(profile.deleteMedia(cv.id)).resolves.toMatchObject({ ok: true });
    });

    it("creates a person without media", async () => {
      await expect(profile.createPerson(person)).resolves.toMatchObject({
        ok: true,
        person: { photoId: null, cvPdfId: null },
      });
    });

    it("refuses a PDF as the photo and an image as the CV PDF", async () => {
      const image = await created(png());
      const document = await created(pdf());

      await expect(profile.createPerson({ ...person, photoId: document.id })).resolves.toEqual({
        ok: false,
        reason: "unsuitable_media",
        field: "photoId",
      });
      await expect(profile.findPerson()).resolves.toBeNull();

      await profile.createPerson(person);
      await expect(profile.updatePerson({ cvPdfId: image.id })).resolves.toEqual({
        ok: false,
        reason: "unsuitable_media",
        field: "cvPdfId",
      });
      await expect(profile.findPerson()).resolves.toMatchObject({ cvPdfId: null });
    });

    it("refuses unknown media and changes nothing", async () => {
      await profile.createPerson(person);

      await expect(
        profile.updatePerson({
          headline: "Changed",
          photoId: "00000000-0000-4000-8000-000000000000",
        }),
      ).resolves.toEqual({ ok: false, reason: "unknown_media", field: "photoId" });
      await expect(profile.findPerson()).resolves.toMatchObject({
        headline: person.headline,
        photoId: null,
      });
    });

    it("updates nothing while there is no person", async () => {
      await expect(profile.updatePerson({ headline: "Changed" })).resolves.toEqual({
        ok: false,
        reason: "not_found",
      });
    });
  });

  describe("attached to an organization and a project", () => {
    const organization = {
      slug: "northwind",
      name: "Northwind Example",
      website: null,
      description: null,
    };

    const experienceAndProject = async (coverId: string | null) => {
      await profile.createExperience({
        slug: "northwind-lead",
        title: "Lead",
        kind: "main_job",
        startedOn: "2021-01-01",
        endedOn: null,
        summary: "Fictional.",
        responsibilities: [],
        inCv: true,
        organization: "northwind",
        technologies: [],
      });
      return profile.createProject({
        slug: "routing",
        experience: "northwind-lead",
        name: "Routing",
        summary: "Fictional.",
        problem: "Fictional.",
        workDone: "Fictional.",
        result: "Fictional.",
        startedOn: "2021-01-01",
        endedOn: null,
        links: [],
        selectedForHomepage: false,
        position: 0,
        technologies: [],
        coverId,
      });
    };

    it("attaches a logo and a cover, refuses referenced deletes and clears them", async () => {
      const logo = await created(png());
      const cover = await created(png());

      await expect(
        profile.createOrganization({ ...organization, logoId: logo.id }),
      ).resolves.toMatchObject({ ok: true, organization: { logoId: logo.id } });
      await expect(experienceAndProject(cover.id)).resolves.toMatchObject({
        ok: true,
        project: { coverId: cover.id },
      });
      await expect(profile.findExperience("northwind-lead")).resolves.toMatchObject({
        organization: { logoId: logo.id },
        projects: [{ coverId: cover.id }],
      });

      for (const media of [logo, cover]) {
        await expect(profile.deleteMedia(media.id)).resolves.toEqual({
          ok: false,
          reason: "referenced",
        });
      }

      await expect(
        profile.updateOrganization("northwind", { logoId: null }),
      ).resolves.toMatchObject({ ok: true, organization: { logoId: null } });
      await expect(profile.updateProject("routing", { coverId: null })).resolves.toMatchObject({
        ok: true,
        project: { coverId: null },
      });
      await expect(profile.deleteMedia(logo.id)).resolves.toMatchObject({ ok: true });
      await expect(profile.deleteMedia(cover.id)).resolves.toMatchObject({ ok: true });
    });

    it("refuses a PDF or unknown media as a logo or a cover", async () => {
      const document = await created(pdf());
      const unknown = "00000000-0000-4000-8000-000000000000";

      await expect(
        profile.createOrganization({ ...organization, logoId: document.id }),
      ).resolves.toEqual({ ok: false, reason: "unsuitable_media", field: "logoId" });
      await expect(profile.listOrganizations()).resolves.toEqual([]);

      await profile.createOrganization(organization);
      await expect(profile.updateOrganization("northwind", { logoId: unknown })).resolves.toEqual({
        ok: false,
        reason: "unknown_media",
        field: "logoId",
      });
      await expect(profile.updateOrganization("missing", { name: "X" })).resolves.toEqual({
        ok: false,
        reason: "not_found",
      });

      await expect(experienceAndProject(document.id)).resolves.toEqual({
        ok: false,
        reason: "unsuitable_media",
        field: "coverId",
      });
      await expect(profile.listProjects()).resolves.toEqual([]);
      await experienceAndProject(null);
      await expect(profile.updateProject("routing", { coverId: unknown })).resolves.toEqual({
        ok: false,
        reason: "unknown_media",
        field: "coverId",
      });
    });
  });
});
