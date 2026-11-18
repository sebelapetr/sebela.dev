import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  CvSchema,
  explorationStatuses,
  type ExperienceCreate,
  type ExplorationCreate,
  type PersonCreate,
  type TechnologyCreate,
} from "@sebela/contracts";
import { createPersistence, readDatabaseConfig, type Persistence } from "@sebela/db";
import { createTemporaryDatabase, type TemporaryDatabase } from "@sebela/db/testing";

import { DomainError } from "../../errors.js";
import { createProfileService, type ProfileService } from "./index.js";

/** A fictional person. */
const alex: PersonCreate = {
  name: "Alex Example",
  headline: "Fictional engineer",
  shortBio: "A **fictional** person used in tests.",
  longBio: "A longer, equally fictional story.",
  location: "Harbour City",
  email: "alex@example.test",
  links: [{ label: "Website", url: "https://alex.example.test/" }],
  availability: null,
  careerStartedOn: "2012-09-01",
  servicesIntro: null,
  collaborationSteps: [],
  servicesNote: null,
  photoId: null,
  cvPdfId: null,
};

const role: ExperienceCreate = {
  slug: "northwind-platform",
  title: "Platform engineer",
  kind: "main_job",
  organization: "northwind",
  startedOn: "2018-01-01",
  endedOn: null,
  summary: "A **fictional** role.",
  responsibilities: ["Run the platform"],
  inCv: true,
  technologies: ["typescript"],
};

const exploration: ExplorationCreate = {
  slug: "agent-lab",
  name: "Agent lab",
  summary: "A **fictional** exploration.",
  status: "tested",
  concepts: ["Tool calling"],
  startedOn: "2025-02-01",
  endedOn: null,
  position: 0,
  technologies: ["typescript"],
  topics: ["agents"],
};

const technology = (
  slug: string,
  tier: TechnologyCreate["tier"],
  group: TechnologyCreate["group"],
  position: number,
): TechnologyCreate => ({ slug, name: slug, tier, group, logoKey: null, position });

/** A fictional public base; the service only passes keys to it. */
const address = (key: string) => `https://files.example.test/${key}`;

describe("CV service", () => {
  let database: TemporaryDatabase;
  let persistence: Persistence;
  let profile: ProfileService;

  beforeAll(async () => {
    database = await createTemporaryDatabase(readDatabaseConfig(process.env));
    persistence = createPersistence(database.config);
    profile = createProfileService(persistence.profile, { mediaAddress: address });
    await profile.createTopic({ slug: "agents", name: "Agents", position: 0 });
  });

  afterAll(async () => {
    await persistence.close();
    await database.drop();
  });

  beforeEach(async () => {
    await profile.deletePerson().catch(() => undefined);
    for (const { slug } of await profile.listExperiences()) await profile.deleteExperience(slug);
    for (const { slug } of await profile.listExplorations()) await profile.deleteExploration(slug);
    for (const { slug } of await profile.listEducation()) await profile.deleteEducation(slug);
    for (const { slug } of await profile.listOrganizations())
      await profile.deleteOrganization(slug);
    for (const { slug } of await profile.listTechnologies()) await profile.deleteTechnology(slug);
    for (const { id } of await persistence.profile.listMedia())
      await persistence.profile.deleteMedia(id);
  });

  /** The person, a fictional organization and one primary core technology. */
  async function seedPerson(person: PersonCreate = alex) {
    await profile.createPerson(person);
    await profile.createOrganization({
      slug: "northwind",
      name: "Northwind",
      website: null,
      description: null,
      logoId: null,
    });
    await profile.createTechnology(technology("typescript", "primary", "core", 0));
  }

  it("answers not_found while there is no person, and creates nothing", async () => {
    await profile.createTechnology(technology("typescript", "primary", "core", 0));

    const failure = await profile.getCv().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(DomainError);
    expect(failure).toMatchObject({ code: "not_found" });
    await expect(profile.getPerson()).rejects.toMatchObject({ code: "not_found" });
    expect((await profile.listTechnologies()).map(({ slug }) => slug)).toEqual(["typescript"]);
  });

  it("assembles the person and empty sections when the person is all there is", async () => {
    const person = await profile.createPerson(alex);

    const cv = await profile.getCv();

    expect(cv).toEqual({
      person,
      experiences: [],
      technologies: { primary: { core: [], aiEngineeringFocus: [] }, secondary: [] },
      education: [],
      explorations: [],
      cvPdf: null,
    });
    expect(CvSchema.parse(cv)).toEqual(cv);
  });

  it("includes the experiences selected for the CV in the experience order and leaves out the rest", async () => {
    await seedPerson();
    for (const experience of [
      { slug: "a-early", startedOn: "2012-09-01", endedOn: "2015-12-31", inCv: true },
      { slug: "b-hidden", startedOn: "2016-01-01", endedOn: "2017-12-31", inCv: false },
      { slug: "c-later", startedOn: "2018-01-01", endedOn: "2019-12-31", inCv: true },
      { slug: "d-current", startedOn: "2014-01-01", endedOn: null, inCv: true },
    ])
      await profile.createExperience({ ...role, ...experience });

    const cv = await profile.getCv();

    expect(cv.experiences.map(({ slug }) => slug)).toEqual(["d-current", "c-later", "a-early"]);
    expect(cv.experiences[0]).toEqual(await profile.getExperience("d-current"));
    expect(CvSchema.parse(cv)).toEqual(cv);
  });

  it("groups the technologies by tier and group, each in catalog order", async () => {
    await profile.createPerson(alex);
    for (const entry of [
      technology("vitest", "secondary", null, 1),
      technology("bash", "secondary", null, 0),
      technology("evals", "primary", "ai_engineering_focus", 0),
      technology("typescript", "primary", "core", 1),
      technology("postgres", "primary", "core", 0),
    ])
      await profile.createTechnology(entry);

    const { technologies } = await profile.getCv();

    const slugs = (list: { slug: string }[]) => list.map(({ slug }) => slug);
    expect(slugs(technologies.primary.core)).toEqual(["postgres", "typescript"]);
    expect(slugs(technologies.primary.aiEngineeringFocus)).toEqual(["evals"]);
    expect(slugs(technologies.secondary)).toEqual(["bash", "vitest"]);
    expect(technologies.primary.core[0]).toEqual(await profile.getTechnology("postgres"));
  });

  it("lists education by position, then slug", async () => {
    await profile.createPerson(alex);
    for (const [slug, position] of [
      ["school", 1],
      ["course", 0],
      ["certification", 1],
    ] as const)
      await profile.createEducation({
        slug,
        kind: slug,
        title: `A fictional ${slug}`,
        institution: null,
        startedOn: "2010-01-01",
        endedOn: null,
        description: null,
        position,
      });

    const { education } = await profile.getCv();

    expect(education.map(({ slug }) => slug)).toEqual(["course", "certification", "school"]);
    expect(education[0]).toEqual(await profile.getEducation("course"));
  });

  it("keeps every exploration status truthful in a section of its own, never as an experience", async () => {
    await seedPerson();
    await profile.createExperience(role);
    for (const [position, status] of explorationStatuses.entries())
      await profile.createExploration({
        ...exploration,
        slug: `${status}-exploration`,
        name: `A ${status} exploration`,
        status,
        position,
      });

    const cv = await profile.getCv();

    expect(cv.explorations.map(({ slug, status }) => [slug, status])).toEqual(
      explorationStatuses.map((status) => [`${status}-exploration`, status]),
    );
    expect(cv.experiences.map(({ slug }) => slug)).toEqual(["northwind-platform"]);
    expect(cv.experiences.flatMap(({ projects }) => projects)).toEqual([]);
    const stored = await profile.getExploration("tested-exploration");
    expect(cv.explorations[explorationStatuses.indexOf("tested")]).toEqual({
      id: stored.id,
      slug: stored.slug,
      name: stored.name,
      summary: stored.summary,
      status: "tested",
      concepts: stored.concepts,
      startedOn: stored.startedOn,
      endedOn: stored.endedOn,
      technologies: stored.technologies,
    });
    expect(CvSchema.parse(cv)).toEqual(cv);
  });

  it("names the current CV PDF with its public address", async () => {
    const pdf = await persistence.profile.createMedia({
      key: "test/media/cv.pdf",
      mediaType: "application/pdf",
      byteSize: 2048,
      width: null,
      height: null,
      altText: "The fictional CV",
    });
    await profile.createPerson({ ...alex, cvPdfId: pdf.id });

    const { cvPdf } = await profile.getCv();

    expect(cvPdf).toEqual({
      id: pdf.id,
      key: "test/media/cv.pdf",
      mediaType: "application/pdf",
      byteSize: 2048,
      width: null,
      height: null,
      altText: "The fictional CV",
      url: "https://files.example.test/test/media/cv.pdf",
      createdAt: pdf.createdAt.toISOString(),
      updatedAt: pdf.updatedAt.toISOString(),
    });
  });

  it("gives the CV PDF no address without a media address", async () => {
    const pdf = await persistence.profile.createMedia({
      key: "test/media/cv.pdf",
      mediaType: "application/pdf",
      byteSize: 2048,
      width: null,
      height: null,
      altText: null,
    });
    await profile.createPerson({ ...alex, cvPdfId: pdf.id });

    const { cvPdf } = await createProfileService(persistence.profile).getCv();

    expect(cvPdf).toMatchObject({ id: pdf.id, url: null });
  });

  it("reflects a change of the profile in the next assembled CV", async () => {
    await seedPerson();
    await profile.createExperience(role);
    await profile.createExploration(exploration);
    await profile.getCv();

    await profile.updatePerson({ headline: "Changed fictional headline" });
    await profile.updateExperience(role.slug, { inCv: false });
    await profile.updateExploration(exploration.slug, { status: "built" });
    const cv = await profile.getCv();

    expect(cv.person.headline).toBe("Changed fictional headline");
    expect(cv.experiences).toEqual([]);
    expect(cv.explorations.map(({ status }) => status)).toEqual(["built"]);
  });
});
