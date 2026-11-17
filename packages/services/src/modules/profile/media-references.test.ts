import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PersonCreate, ProjectCreate, TestimonialCreate } from "@sebela/contracts";
import {
  createPersistence,
  readDatabaseConfig,
  type MediaFields,
  type Persistence,
} from "@sebela/db";
import { createTemporaryDatabase, type TemporaryDatabase } from "@sebela/db/testing";

import { DomainError } from "../../errors.js";
import { createProfileService, type ProfileService } from "./index.js";

const unknown = "00000000-0000-4000-8000-000000000000";

let sequence = 0;
const image = (): MediaFields => {
  sequence += 1;
  return {
    key: `test/fictional-${String(sequence)}.png`,
    mediaType: "image/png",
    byteSize: 100,
    width: 10,
    height: 10,
    altText: null,
  };
};
const document = (): MediaFields => ({
  ...image(),
  key: `test/fictional-${String(sequence)}.pdf`,
  mediaType: "application/pdf",
  width: null,
  height: null,
});

const person: PersonCreate = {
  name: "Ada Example",
  headline: "Fictional engineer",
  shortBio: "A made-up person for tests.",
  longBio: null,
  location: null,
  email: null,
  links: [],
  availability: null,
  careerStartedOn: null,
  servicesIntro: null,
  collaborationSteps: [],
  servicesNote: null,
  photoId: null,
  cvPdfId: null,
};

const project: ProjectCreate = {
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
  coverId: null,
};

const testimonial: TestimonialCreate = {
  slug: "dana-on-routing",
  experience: "northwind-lead",
  quote: "A fictional quote.",
  authorName: "Dana Placeholder",
  authorRole: "Head of Operations",
  position: 0,
  authorPhotoId: null,
};

async function refusal(operation: Promise<unknown>): Promise<DomainError> {
  const error = await operation.then(
    () => null,
    (reason: unknown) => reason,
  );
  if (!(error instanceof DomainError)) throw new Error("Expected a DomainError.");
  return error;
}

const field = async (operation: Promise<unknown>) => {
  const error = await refusal(operation);
  return { code: error.code, paths: error.fields?.map(({ path }) => path) };
};

describe("profile records referring to media", () => {
  let database: TemporaryDatabase;
  let persistence: Persistence;
  let profile: ProfileService;
  let photoId: string;
  let pdfId: string;

  beforeAll(async () => {
    database = await createTemporaryDatabase(readDatabaseConfig(process.env));
    persistence = createPersistence(database.config);
    profile = createProfileService(persistence.profile);
    photoId = (await persistence.profile.createMedia(image())).id;
    pdfId = (await persistence.profile.createMedia(document())).id;
    await profile.createOrganization({
      slug: "northwind",
      name: "Northwind",
      website: null,
      description: null,
      logoId: null,
    });
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
  });

  afterAll(async () => {
    await persistence.close();
    await database.drop();
  });

  beforeEach(async () => {
    await persistence.profile.deletePerson();
    for (const { slug } of await persistence.profile.listTestimonials()) {
      await persistence.profile.deleteTestimonial(slug);
    }
    for (const { slug } of await persistence.profile.listProjects()) {
      await persistence.profile.deleteProject(slug);
    }
    await persistence.profile.updateOrganization("northwind", { logoId: null });
  });

  it("attaches and clears the photo and the current CV PDF", async () => {
    const created = await profile.createPerson({ ...person, photoId, cvPdfId: pdfId });
    expect(created).toMatchObject({ photoId, cvPdfId: pdfId });

    await expect(profile.updatePerson({ photoId: null })).resolves.toMatchObject({
      photoId: null,
      cvPdfId: pdfId,
    });
  });

  it("refuses unknown or unsuitable person media naming the field, changing nothing", async () => {
    await expect(field(profile.createPerson({ ...person, photoId: pdfId }))).resolves.toEqual({
      code: "validation_failed",
      paths: ["photoId"],
    });
    await expect(field(profile.getPerson())).resolves.toMatchObject({ code: "not_found" });

    await profile.createPerson(person);
    await expect(field(profile.updatePerson({ cvPdfId: photoId }))).resolves.toEqual({
      code: "validation_failed",
      paths: ["cvPdfId"],
    });
    await expect(field(profile.updatePerson({ photoId: unknown }))).resolves.toEqual({
      code: "validation_failed",
      paths: ["photoId"],
    });
    await expect(profile.getPerson()).resolves.toMatchObject({ photoId: null, cvPdfId: null });
  });

  it("still reports a missing person as not found", async () => {
    await expect(field(profile.updatePerson({ headline: "x" }))).resolves.toMatchObject({
      code: "not_found",
    });
  });

  it("attaches, refuses and clears an organization logo", async () => {
    await expect(
      profile.updateOrganization("northwind", { logoId: photoId }),
    ).resolves.toMatchObject({ logoId: photoId });
    await expect(
      field(profile.updateOrganization("northwind", { logoId: pdfId })),
    ).resolves.toEqual({ code: "validation_failed", paths: ["logoId"] });
    await expect(
      field(
        profile.createOrganization({
          slug: "acme",
          name: "Acme",
          website: null,
          description: null,
          logoId: unknown,
        }),
      ),
    ).resolves.toEqual({ code: "validation_failed", paths: ["logoId"] });
    await expect(
      field(profile.updateOrganization("missing", { name: "x" })),
    ).resolves.toMatchObject({ code: "not_found" });
    await expect(profile.getOrganization("northwind")).resolves.toMatchObject({ logoId: photoId });
  });

  it("attaches, refuses and clears a project cover", async () => {
    await expect(field(profile.createProject({ ...project, coverId: pdfId }))).resolves.toEqual({
      code: "validation_failed",
      paths: ["coverId"],
    });
    await expect(profile.createProject({ ...project, coverId: photoId })).resolves.toMatchObject({
      coverId: photoId,
    });
    await expect(field(profile.updateProject("routing", { coverId: unknown }))).resolves.toEqual({
      code: "validation_failed",
      paths: ["coverId"],
    });
    await expect(profile.updateProject("routing", { coverId: null })).resolves.toMatchObject({
      coverId: null,
    });
  });

  it("attaches, refuses and clears a testimonial author photo", async () => {
    await expect(
      field(profile.createTestimonial({ ...testimonial, authorPhotoId: pdfId })),
    ).resolves.toEqual({ code: "validation_failed", paths: ["authorPhotoId"] });
    await expect(profile.listTestimonials()).resolves.toEqual([]);
    await expect(
      profile.createTestimonial({ ...testimonial, authorPhotoId: photoId }),
    ).resolves.toMatchObject({ authorPhotoId: photoId });
    await expect(
      field(profile.updateTestimonial("dana-on-routing", { authorPhotoId: unknown })),
    ).resolves.toEqual({ code: "validation_failed", paths: ["authorPhotoId"] });
    await expect(
      field(profile.updateTestimonial("missing", { authorPhotoId: photoId })),
    ).resolves.toMatchObject({ code: "not_found" });
    await expect(
      profile.updateTestimonial("dana-on-routing", { authorPhotoId: null }),
    ).resolves.toMatchObject({ authorPhotoId: null });
  });
});
