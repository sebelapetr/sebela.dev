import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { readDatabaseConfig } from "../../config.js";
import { openConnection, type Connection } from "../../connection.js";
import { createTemporaryDatabase, type TemporaryDatabase } from "../../testing.js";
import { createProfilePersistence, type ProfilePersistence } from "./index.js";

/** A fictional person. */
const alex = {
  name: "Alex Example",
  headline: "Fictional engineer",
  shortBio: "A **fictional** person used in tests.",
  longBio: null,
  location: "Harbour City",
  email: "alex@example.test",
  links: [{ label: "Website", url: "https://alex.example.test/" }],
  availability: null,
  careerStartedOn: "2012-09-01",
};

const role = {
  kind: "main_job" as const,
  summary: "A **fictional** role.",
  responsibilities: ["Run the platform"],
  organization: "northwind",
  technologies: ["typescript"],
};

const exploration = {
  summary: "A **fictional** exploration.",
  concepts: ["Tool calling"],
  startedOn: "2025-02-01",
  endedOn: null,
  technologies: [],
  topics: [],
};

describe("CV persistence", () => {
  let database: TemporaryDatabase;
  let connection: Connection;
  let profile: ProfilePersistence;

  /** Counts the rows of every profile table the CV reads; the subject is that reading writes nothing. */
  async function rowCounts() {
    const result = await connection.db.execute<Record<string, string>>(sql`
      SELECT
        (SELECT count(*) FROM profile.persons) AS persons,
        (SELECT count(*) FROM profile.experiences) AS experiences,
        (SELECT count(*) FROM profile.technologies) AS technologies,
        (SELECT count(*) FROM profile.education) AS education,
        (SELECT count(*) FROM profile.explorations) AS explorations,
        (SELECT count(*) FROM profile.media) AS media
    `);
    return result.rows[0];
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
    await profile.deletePerson();
    for (const { slug } of await profile.listExperiences()) await profile.deleteExperience(slug);
    for (const { slug } of await profile.listExplorations()) await profile.deleteExploration(slug);
    for (const { slug } of await profile.listEducation()) await profile.deleteEducation(slug);
    for (const { slug } of await profile.listOrganizations())
      await profile.deleteOrganization(slug);
    for (const { slug } of await profile.listTechnologies()) await profile.deleteTechnology(slug);
    for (const { id } of await profile.listMedia()) await profile.deleteMedia(id);
  });

  /** A person with a fictional organization and one primary core technology. */
  async function seedPerson() {
    await profile.createPerson(alex);
    await profile.createOrganization({
      slug: "northwind",
      name: "Northwind",
      website: null,
      description: null,
    });
    await profile.createTechnology({
      slug: "typescript",
      name: "TypeScript",
      tier: "primary",
      group: "core",
      logoKey: null,
      position: 0,
    });
  }

  it("reads no CV while there is no person, and creates nothing", async () => {
    const before = await rowCounts();

    await expect(profile.readCv()).resolves.toBeNull();
    expect(await rowCounts()).toEqual(before);
  });

  it("reads only the experiences selected for the CV, current roles first, then latest start", async () => {
    await seedPerson();
    const experiences = [
      {
        slug: "a-early",
        title: "Early",
        startedOn: "2012-09-01",
        endedOn: "2015-12-31",
        inCv: true,
      },
      {
        slug: "b-hidden",
        title: "Hidden",
        startedOn: "2016-01-01",
        endedOn: "2017-12-31",
        inCv: false,
      },
      {
        slug: "c-later",
        title: "Later",
        startedOn: "2018-01-01",
        endedOn: "2019-12-31",
        inCv: true,
      },
      { slug: "d-current", title: "Current", startedOn: "2014-01-01", endedOn: null, inCv: true },
    ];
    for (const experience of experiences)
      await profile.createExperience({ ...role, ...experience });

    const cv = await profile.readCv();

    expect(cv?.experiences.map(({ slug }) => slug)).toEqual(["d-current", "c-later", "a-early"]);
    expect(cv?.experiences[0]).toMatchObject({
      organization: { slug: "northwind" },
      technologies: [{ slug: "typescript" }],
      projects: [],
      testimonials: [],
    });
  });

  it("reads the person, technologies, education and every exploration in their defined order", async () => {
    await seedPerson();
    await profile.createTechnology({
      slug: "bash",
      name: "Bash",
      tier: "secondary",
      group: null,
      logoKey: null,
      position: 0,
    });
    await profile.createTechnology({
      slug: "evals",
      name: "Evals",
      tier: "primary",
      group: "ai_engineering_focus",
      logoKey: null,
      position: 0,
    });
    for (const [slug, position] of [
      ["school", 1],
      ["course", 0],
    ] as const) {
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
    }
    const statuses = [
      { slug: "built-one", name: "Built", status: "built", position: 2 },
      { slug: "designed-one", name: "Designed", status: "designed", position: 0 },
      { slug: "tested-one", name: "Tested", status: "tested", position: 1 },
    ] as const;
    for (const entry of statuses) await profile.createExploration({ ...exploration, ...entry });

    const cv = await profile.readCv();

    expect(cv?.person).toMatchObject({ ...alex, cvPdfId: null });
    expect(cv?.technologies.map(({ slug }) => slug)).toEqual(["typescript", "evals", "bash"]);
    expect(cv?.education.map(({ slug }) => slug)).toEqual(["course", "school"]);
    expect(cv?.explorations.map(({ slug, status }) => [slug, status])).toEqual([
      ["designed-one", "designed"],
      ["tested-one", "tested"],
      ["built-one", "built"],
    ]);
    expect(cv?.cvPdf).toBeNull();
  });

  it("reads empty sections when the person is all there is", async () => {
    await profile.createPerson(alex);

    await expect(profile.readCv()).resolves.toMatchObject({
      experiences: [],
      technologies: [],
      education: [],
      explorations: [],
      cvPdf: null,
    });
  });

  it("reads the media record of the current CV PDF the person names", async () => {
    const pdf = await profile.createMedia({
      key: "test/media/cv.pdf",
      mediaType: "application/pdf",
      byteSize: 2048,
      width: null,
      height: null,
      altText: null,
    });
    await profile.createPerson({ ...alex, cvPdfId: pdf.id });

    const cv = await profile.readCv();

    expect(cv?.cvPdf).toEqual(pdf);
  });

  it("reads the stored facts as they are now, after a change", async () => {
    await seedPerson();
    await profile.createExperience({
      ...role,
      slug: "northwind-platform",
      title: "Platform engineer",
      startedOn: "2020-01-01",
      endedOn: null,
      inCv: true,
    });
    await profile.readCv();

    await profile.updateExperience("northwind-platform", { inCv: false });
    await profile.updatePerson({ headline: "Changed fictional headline" });
    const cv = await profile.readCv();

    expect(cv?.experiences).toEqual([]);
    expect(cv?.person.headline).toBe("Changed fictional headline");
  });
});
