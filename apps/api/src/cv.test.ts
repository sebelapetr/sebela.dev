import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { CvSchema, explorationStatuses, MediaSchema, type Cv } from "@sebela/contracts";
import { samplePdf } from "@sebela/services/testing";

import {
  anyText,
  bearer,
  connection,
  json,
  MEDIA_PUBLIC_BASE,
  openTestBackend,
  person,
  upload,
  type TestBackend,
} from "./test-support.js";

/** A fictional role; each test varies its slug, period and CV flag. */
const role = {
  title: "Platform engineer",
  kind: "main_job",
  organization: "northwind",
  summary: "A **fictional** role.",
  responsibilities: ["Run the platform"],
  technologies: ["typescript"],
};

describe("the CV API", () => {
  let backend: TestBackend;
  let auth: Record<string, string>;

  beforeAll(async () => {
    backend = await openTestBackend();
    auth = bearer((await backend.services.apiKeys.createKey("cv routes")).key);
  });

  afterAll(async () => {
    await backend.close();
  });

  beforeEach(async () => {
    const { profile, media } = backend.services;
    await profile.deletePerson().catch(() => undefined);
    for (const { slug } of await profile.listExperiences()) await profile.deleteExperience(slug);
    for (const { slug } of await profile.listExplorations()) await profile.deleteExploration(slug);
    for (const { slug } of await profile.listEducation()) await profile.deleteEducation(slug);
    for (const { slug } of await profile.listOrganizations())
      await profile.deleteOrganization(slug);
    for (const { slug } of await profile.listTechnologies()) await profile.deleteTechnology(slug);
    for (const { id } of await media.listMedia()) await media.deleteMedia(id);
  });

  const request = (path: string, method = "GET", init: RequestInit = {}) =>
    backend.api().app.request(path, { method, ...init }, connection());
  const write = async (path: string, body: object, method = "POST") => {
    const response = await request(path, method, json(body, auth));
    expect(response.status, `${method} ${path}`).toBeLessThan(300);
  };
  const readCv = async (): Promise<Cv> => {
    const response = await request("/v1/cv");
    expect(response.status).toBe(200);
    return CvSchema.parse(await response.json());
  };

  /** The person, a fictional organization and one primary core technology, written over HTTP. */
  async function seed() {
    await write("/v1/person", person);
    await write("/v1/organizations", { slug: "northwind", name: "Northwind" });
    await write("/v1/technologies", {
      slug: "typescript",
      name: "TypeScript",
      tier: "primary",
      group: "core",
      position: 0,
    });
  }

  it("answers 404 not_found publicly while there is no person, and creates nothing", async () => {
    const response = await request("/v1/cv");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "not_found", message: anyText } });
    expect((await request("/v1/person")).status).toBe(404);
  });

  it("assembles the person with empty sections, without a key", async () => {
    await write("/v1/person", person);

    const cv = await readCv();

    expect(cv.person).toMatchObject(person);
    expect(cv).toMatchObject({
      experiences: [],
      technologies: { primary: { core: [], aiEngineeringFocus: [] }, secondary: [] },
      education: [],
      explorations: [],
      cvPdf: null,
    });
  });

  it("selects the CV experiences, groups technologies and keeps explorations truthful and apart", async () => {
    await seed();
    await write("/v1/technologies", {
      slug: "bash",
      name: "Bash",
      tier: "secondary",
      group: null,
      position: 0,
    });
    for (const experience of [
      { slug: "a-early", startedOn: "2012-09-01", endedOn: "2015-12-31", inCv: true },
      { slug: "b-hidden", startedOn: "2016-01-01", endedOn: "2017-12-31", inCv: false },
      { slug: "c-current", startedOn: "2018-01-01", endedOn: null, inCv: true },
    ])
      await write("/v1/experiences", { ...role, ...experience });
    await write("/v1/education", {
      slug: "harbour-tech",
      kind: "school",
      title: "Software engineering",
      startedOn: "2008-09-01",
      endedOn: "2012-06-30",
      position: 0,
    });
    for (const [position, status] of explorationStatuses.entries())
      await write("/v1/explorations", {
        slug: `${status}-exploration`,
        name: `A ${status} exploration`,
        summary: "A **fictional** exploration.",
        status,
        startedOn: "2025-02-01",
        position,
      });

    const cv = await readCv();

    expect(cv.experiences.map(({ slug }) => slug)).toEqual(["c-current", "a-early"]);
    expect(cv.technologies.primary.core.map(({ slug }) => slug)).toEqual(["typescript"]);
    expect(cv.technologies.secondary.map(({ slug }) => slug)).toEqual(["bash"]);
    expect(cv.education.map(({ slug }) => slug)).toEqual(["harbour-tech"]);
    expect(cv.explorations.map(({ slug, status }) => [slug, status])).toEqual(
      explorationStatuses.map((status) => [`${status}-exploration`, status]),
    );
    const careerSlugs = cv.experiences.flatMap(({ slug, projects }) => [
      slug,
      ...projects.map((project) => project.slug),
    ]);
    for (const { slug } of cv.explorations) expect(careerSlugs).not.toContain(slug);
  });

  it("names the uploaded CV PDF with its public address, without generating it", async () => {
    const uploaded = await request(
      "/v1/media",
      "POST",
      upload({ bytes: samplePdf(), name: "cv.pdf", type: "application/pdf" }, {}, auth),
    );
    expect(uploaded.status).toBe(201);
    const pdf = MediaSchema.parse(await uploaded.json());
    await write("/v1/person", { ...person, cvPdfId: pdf.id });
    const files = await backend.storedFiles();

    const cv = await readCv();

    expect(cv.cvPdf).toEqual(pdf);
    expect(cv.cvPdf?.url).toBe(`${MEDIA_PUBLIC_BASE}/${pdf.key}`);
    expect(await backend.storedFiles()).toEqual(files);
  });

  it("reflects a profile change in the next response", async () => {
    await seed();
    await write("/v1/experiences", {
      ...role,
      slug: "northwind-platform",
      startedOn: "2020-01-01",
      inCv: true,
    });
    expect((await readCv()).experiences).toHaveLength(1);

    await write("/v1/experiences/northwind-platform", { inCv: false }, "PATCH");
    await write("/v1/person", { headline: "Changed fictional headline" }, "PATCH");
    const cv = await readCv();

    expect(cv.experiences).toEqual([]);
    expect(cv.person.headline).toBe("Changed fictional headline");
  });

  it("offers no write to the CV", async () => {
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      const response = await request("/v1/cv", method, json({}, auth));
      expect(response.status, method).toBe(404);
    }
  });
});
