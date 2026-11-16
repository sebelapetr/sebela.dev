import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createPersistence, readDatabaseConfig, type Persistence } from "@sebela/db";
import { createTemporaryDatabase, type TemporaryDatabase } from "@sebela/db/testing";

import { DomainError } from "../../errors.js";
import { samplePdf, samplePng, sampleJpeg } from "../../testing.js";
import { createMediaService, type CleanupFailure, type MediaLimits } from "../media/index.js";
import { createProfileService, type ProfileService } from "../profile/index.js";
import { openStorage, type OpenedStorage } from "../storage/index.js";
import { createSeedService, type SeedKind, type SeedReport } from "./index.js";

const limits: MediaLimits = { maxBytes: 64 * 1024, maxImageDimension: 2000 };

/** The files of a small fictional seed, by their path inside the seed folder. */
type SeedFiles = Record<string, unknown>;

const portrait = sampleJpeg({ width: 30, height: 40 });
const logo = samplePng({ width: 16, height: 16 });
const cover = samplePng({ width: 60, height: 30 });
const otherCover = samplePng({ width: 61, height: 30 });
const cv = samplePdf();

/** A small, complete fictional seed: every kind of record, every relation and some media. */
const fixture = (): SeedFiles => ({
  "person.json": {
    name: "Robin Example",
    headline: "Fictional platform engineer",
    shortBio: "A **fictional** person for seed tests.",
    location: "Harbour City",
    email: "robin@example.test",
    links: [{ label: "Website", url: "https://robin.example.test/" }],
    careerStartedOn: "2014-03-01",
    photo: { file: "files/portrait.jpg", altText: "A fictional portrait." },
    cvPdf: { file: "files/cv.pdf" },
  },
  "technologies.json": [
    { slug: "typescript", name: "TypeScript", tier: "primary", group: "core", position: 0 },
    { slug: "postgres", name: "PostgreSQL", tier: "primary", group: "core", position: 1 },
    {
      slug: "langgraph",
      name: "LangGraph",
      tier: "primary",
      group: "ai_engineering_focus",
      position: 0,
    },
    { slug: "bash", name: "Bash", tier: "secondary", position: 0 },
  ],
  "topics.json": [
    { slug: "agents", name: "Agents", position: 0 },
    { slug: "rag", name: "RAG", position: 1 },
  ],
  "organizations.json": [
    {
      slug: "northwind",
      name: "Northwind Freight",
      website: "https://northwind.example.test/",
      logo: { file: "files/northwind.png", altText: "The fictional Northwind logo." },
    },
  ],
  "experiences.json": [
    {
      slug: "northwind-platform",
      title: "Platform engineer",
      kind: "main_job",
      organization: "northwind",
      startedOn: "2019-01-01",
      summary: "A **fictional** role.",
      responsibilities: ["Run the platform"],
      inCv: true,
      technologies: ["typescript", "postgres"],
    },
    {
      slug: "northwind-consulting",
      title: "Consultant",
      kind: "own_business",
      organization: "northwind",
      startedOn: "2016-01-01",
      endedOn: "2018-12-31",
      summary: "A **fictional** business.",
      inCv: false,
    },
  ],
  "projects.json": [
    {
      slug: "dock-planner",
      experience: "northwind-platform",
      name: "Dock planner",
      summary: "A fictional planner.",
      problem: "Docks were planned by hand.",
      workDone: "Built a planner.",
      result: "Shorter waits.",
      startedOn: "2020-01-01",
      selectedForHomepage: true,
      position: 0,
      technologies: ["typescript"],
      cover: { file: "files/cover.png", altText: "A fictional dock." },
      caseStudy: { role: "Lead engineer", body: "A **fictional** case study." },
    },
    {
      slug: "rate-sheet",
      experience: "northwind-consulting",
      name: "Rate sheet",
      summary: "A fictional rate sheet.",
      problem: "Rates were scattered.",
      workDone: "Collected them.",
      result: "One sheet.",
      startedOn: "2017-01-01",
      endedOn: "2017-06-30",
      position: 0,
    },
  ],
  "explorations.json": [
    {
      slug: "agent-lab",
      name: "Agent lab",
      summary: "A fictional exploration.",
      status: "built",
      startedOn: "2025-01-01",
      position: 0,
      technologies: ["langgraph"],
      topics: ["agents"],
    },
    {
      slug: "rag-notes",
      name: "RAG notes",
      summary: "A fictional design.",
      status: "designed",
      startedOn: "2025-03-01",
      position: 1,
      topics: ["rag"],
    },
  ],
  "services.json": [
    {
      slug: "platform-review",
      name: "Platform review",
      summary: "A fictional service.",
      audience: "Fictional teams.",
      deliverable: "A fictional report.",
      position: 0,
      evidence: [
        { kind: "project", project: "dock-planner" },
        { kind: "exploration", exploration: "agent-lab" },
        { kind: "link", label: "Roadmap", path: "/roadmap" },
      ],
    },
  ],
  "education.json": [
    {
      slug: "harbour-university",
      kind: "school",
      title: "Computer science",
      institution: "Harbour University",
      startedOn: "2010-09-01",
      endedOn: "2014-06-30",
      position: 0,
    },
  ],
  "testimonials.json": [
    {
      slug: "dock-lead",
      experience: "northwind-platform",
      quote: "A fictional compliment.",
      authorName: "Sam Example",
      authorRole: "Head of Operations",
      position: 0,
    },
  ],
  "current-focus.json": [
    {
      slug: "planner-agents",
      title: "Agents for the planner",
      description: "Fictional focus.",
      position: 0,
      project: "dock-planner",
      topics: ["agents", "rag"],
    },
  ],
  "files/portrait.jpg": portrait,
  "files/northwind.png": logo,
  "files/cover.png": cover,
  "files/cv.pdf": cv,
});

const kinds: SeedKind[] = [
  "person",
  "technologies",
  "topics",
  "organizations",
  "experiences",
  "projects",
  "caseStudies",
  "explorations",
  "services",
  "education",
  "testimonials",
  "currentFocus",
];

const fixtureCounts: Record<SeedKind, number> = {
  person: 1,
  technologies: 4,
  topics: 2,
  organizations: 1,
  experiences: 2,
  projects: 2,
  caseStudies: 1,
  explorations: 2,
  services: 1,
  education: 1,
  testimonials: 1,
  currentFocus: 1,
};

const allCreated = Object.fromEntries(
  kinds.map((kind) => [kind, { created: fixtureCounts[kind], updated: 0 }]),
);
const allUpdated = Object.fromEntries(
  kinds.map((kind) => [kind, { created: 0, updated: fixtureCounts[kind] }]),
);

async function writeSeed(folder: string, files: SeedFiles): Promise<string> {
  for (const [path, content] of Object.entries(files)) {
    const target = join(folder, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, Buffer.isBuffer(content) ? content : JSON.stringify(content, null, 2));
  }
  return folder;
}

async function filesBelow(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => !entry.isDirectory())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}

async function refusal(operation: Promise<unknown>): Promise<DomainError> {
  const error = await operation.then(
    () => null,
    (reason: unknown) => reason,
  );
  if (!(error instanceof DomainError)) throw new Error(`Expected a DomainError: ${String(error)}`);
  return error;
}

/** A copy without `updatedAt`, which every load advances. */
function withoutUpdatedAt(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutUpdatedAt);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "updatedAt")
        .map(([key, nested]) => [key, withoutUpdatedAt(nested)]),
    );
  }
  return value;
}

describe("seed service", () => {
  let database: TemporaryDatabase;
  let persistence: Persistence;
  let profile: ProfileService;
  let seedFolder: string;
  let storageFolder: string;
  let opened: OpenedStorage;
  let failures: CleanupFailure[];

  const media = () =>
    createMediaService(persistence.profile, {
      storage: opened,
      limits,
      onCleanupFailure: (failure) => failures.push(failure),
    });

  const seed = (over: Pick<Persistence, "profile" | "transaction"> = persistence) =>
    createSeedService(over, {
      storage: opened,
      limits,
      onCleanupFailure: (failure) => failures.push(failure),
    });

  const load = async (files: SeedFiles): Promise<SeedReport> => {
    const folder = await mkdtemp(join(seedFolder, "load-"));
    return seed().loadSeed(await writeSeed(folder, files));
  };

  /** Everything the profile and the media library hold, as the services return it. */
  const snapshot = async () => ({
    person: await profile.getPerson().catch(() => null),
    technologies: await profile.listTechnologies(),
    topics: await profile.listTopics(),
    organizations: await profile.listOrganizations(),
    experiences: await profile.listExperiences(),
    projects: await profile.listProjects(),
    explorations: await profile.listExplorations(),
    services: await profile.listServices(),
    education: await profile.listEducation(),
    testimonials: await profile.listTestimonials(),
    currentFocus: await profile.listCurrentFocus(),
    media: await media().listMedia(),
  });

  const expectEmpty = async () => {
    const state = await snapshot();
    expect(state.person).toBeNull();
    for (const [name, records] of Object.entries(state)) {
      if (name !== "person") expect(records, name).toEqual([]);
    }
    expect(await filesBelow(storageFolder)).toEqual([]);
  };

  beforeEach(async () => {
    database = await createTemporaryDatabase(readDatabaseConfig(process.env));
    persistence = createPersistence(database.config);
    profile = createProfileService(persistence.profile);
    seedFolder = await mkdtemp(join(tmpdir(), "sebela-seed-"));
    storageFolder = await mkdtemp(join(tmpdir(), "sebela-seed-storage-"));
    opened = openStorage({
      driver: "local",
      root: storageFolder,
      environment: "test",
      worktree: "seed",
      publicBaseUrl: "https://media.example.test/files",
    });
    failures = [];
  });

  afterEach(async () => {
    await persistence.close();
    await database.drop();
    await rm(seedFolder, { recursive: true, force: true });
    await rm(storageFolder, { recursive: true, force: true });
  });

  describe("into an empty database", () => {
    it("creates every record with its relations and media and reports the counts", async () => {
      await expect(load(fixture())).resolves.toEqual({
        records: allCreated,
        media: { uploaded: 4, reused: 0, removed: 0 },
      });

      const state = await snapshot();
      const byKey = new Map(state.media.map((item) => [item.id, item]));
      expect(state.person).toMatchObject({
        name: "Robin Example",
        longBio: null,
        availability: null,
        links: [{ label: "Website", url: "https://robin.example.test/" }],
      });
      expect(byKey.get(state.person?.photoId ?? "")).toMatchObject({
        mediaType: "image/jpeg",
        width: 30,
        height: 40,
        altText: "A fictional portrait.",
      });
      expect(byKey.get(state.person?.cvPdfId ?? "")).toMatchObject({
        mediaType: "application/pdf",
        altText: null,
      });
      expect(byKey.get(state.organizations[0]?.logoId ?? "")).toMatchObject({
        altText: "The fictional Northwind logo.",
      });
      expect(state.technologies.map(({ slug }) => slug)).toEqual([
        "typescript",
        "postgres",
        "langgraph",
        "bash",
      ]);
      expect(
        state.experiences.map(({ slug, organization, technologies }) => ({
          slug,
          organization: organization.slug,
          technologies: technologies.map((technology) => technology.slug),
        })),
      ).toEqual([
        {
          slug: "northwind-platform",
          organization: "northwind",
          technologies: ["typescript", "postgres"],
        },
        { slug: "northwind-consulting", organization: "northwind", technologies: [] },
      ]);
      const planner = state.projects.find(({ slug }) => slug === "dock-planner");
      expect(planner).toMatchObject({
        experience: "northwind-platform",
        selectedForHomepage: true,
        caseStudy: { project: "dock-planner", role: "Lead engineer" },
      });
      expect(byKey.get(planner?.coverId ?? "")).toMatchObject({ width: 60, height: 30 });
      expect(state.projects.find(({ slug }) => slug === "rate-sheet")).toMatchObject({
        coverId: null,
        caseStudy: null,
        links: [],
      });
      expect(state.explorations.map(({ slug, status }) => [slug, status])).toEqual([
        ["agent-lab", "built"],
        ["rag-notes", "designed"],
      ]);
      expect(state.services[0]?.evidence.map((piece) => piece.kind)).toEqual([
        "project",
        "exploration",
        "link",
      ]);
      expect(state.testimonials[0]).toMatchObject({ experience: "northwind-platform" });
      expect(state.currentFocus[0]).toMatchObject({
        project: { slug: "dock-planner" },
        topics: [{ slug: "agents" }, { slug: "rag" }],
      });
      expect(await filesBelow(storageFolder)).toHaveLength(4);
    });

    it("accepts a folder given as a file URL", async () => {
      const folder = await writeSeed(await mkdtemp(join(seedFolder, "url-")), {
        "topics.json": [{ slug: "agents", name: "Agents", position: 0 }],
      });
      const report = await seed().loadSeed(pathToFileURL(`${folder}/`));
      expect(report.records.topics).toEqual({ created: 1, updated: 0 });
    });
  });

  describe("again", () => {
    it("keeps every record, link, media record and file of an identical rerun", async () => {
      await load(fixture());
      const before = await snapshot();
      const files = await filesBelow(storageFolder);

      await expect(load(fixture())).resolves.toEqual({
        records: allUpdated,
        media: { uploaded: 0, reused: 4, removed: 0 },
      });

      expect(withoutUpdatedAt(await snapshot())).toEqual(withoutUpdatedAt(before));
      expect(await filesBelow(storageFolder)).toEqual(files);
      expect(failures).toEqual([]);
    });

    it("updates a changed record without duplicating its links or media", async () => {
      await load(fixture());
      const before = await snapshot();
      const changed = fixture();
      const [platform, consulting] = changed["experiences.json"] as Record<string, unknown>[];
      changed["experiences.json"] = [
        { ...platform, title: "Staff platform engineer", technologies: ["postgres", "bash"] },
        consulting,
      ];
      const [planner, rateSheet] = changed["projects.json"] as Record<string, unknown>[];
      changed["projects.json"] = [
        { ...planner, cover: { file: "files/cover-2.png", altText: "A new fictional dock." } },
        rateSheet,
      ];
      changed["files/cover-2.png"] = otherCover;

      const report = await load(changed);

      expect(report.media).toEqual({ uploaded: 1, reused: 3, removed: 1 });
      const after = await snapshot();
      const experience = after.experiences.find(({ slug }) => slug === "northwind-platform");
      expect(experience?.title).toBe("Staff platform engineer");
      expect(experience?.technologies.map(({ slug }) => slug)).toEqual(["postgres", "bash"]);
      expect(experience?.id).toBe(
        before.experiences.find(({ slug }) => slug === "northwind-platform")?.id,
      );
      const oldCover = before.projects.find(({ slug }) => slug === "dock-planner")?.coverId;
      const newCover = after.projects.find(({ slug }) => slug === "dock-planner")?.coverId;
      expect(newCover).not.toBe(oldCover);
      expect(after.media).toHaveLength(4);
      expect(after.media.find(({ id }) => id === newCover)).toMatchObject({
        width: 61,
        altText: "A new fictional dock.",
      });
      expect(after.media.some(({ id }) => id === oldCover)).toBe(false);
      expect(await filesBelow(storageFolder)).toHaveLength(4);
      expect(after.projects).toHaveLength(2);
      expect(after.services[0]?.evidence).toHaveLength(3);
      expect(withoutUpdatedAt(after.topics)).toEqual(withoutUpdatedAt(before.topics));
    });

    it("overwrites edited seed records and keeps records and case studies it does not name", async () => {
      await load(fixture());
      await profile.updatePerson({ headline: "Edited by hand" });
      await profile.createTopic({ slug: "evals", name: "Evals", position: 5 });
      await profile.createCaseStudy("rate-sheet", { role: "Analyst", body: "Written by hand." });

      await load(fixture());

      expect((await profile.getPerson()).headline).toBe("Fictional platform engineer");
      expect((await profile.listTopics()).map(({ slug }) => slug)).toEqual([
        "agents",
        "rag",
        "evals",
      ]);
      await expect(profile.getCaseStudy("rate-sheet")).resolves.toMatchObject({
        role: "Analyst",
      });
    });

    it("loads only the data files that exist and leaves the other kinds untouched", async () => {
      await load(fixture());
      const before = await snapshot();

      const report = await load({
        "experiences.json": [
          {
            slug: "northwind-support",
            title: "Support engineer",
            kind: "side_project",
            organization: "northwind",
            startedOn: "2015-01-01",
            endedOn: "2015-12-31",
            summary: "A fictional side project on stored references.",
            inCv: false,
            technologies: ["bash"],
          },
        ],
      });

      expect(report.records.experiences).toEqual({ created: 1, updated: 0 });
      expect(report.records.person).toEqual({ created: 0, updated: 0 });
      expect(report.media).toEqual({ uploaded: 0, reused: 0, removed: 0 });
      const after = await snapshot();
      expect(after.experiences).toHaveLength(3);
      expect(after.person).toEqual(before.person);
      expect(after.projects).toEqual(before.projects);
      expect(after.media).toEqual(before.media);
    });
  });

  describe("an invalid seed", () => {
    it("is refused as a whole, naming every problem by file and field, before any write", async () => {
      const files = fixture();
      const [typescript, postgres] = files["technologies.json"] as Record<string, unknown>[];
      files["technologies.json"] = [typescript, { ...postgres, group: null }];
      files["topics.json"] = [
        { slug: "agents", name: "Agents", position: 0 },
        { slug: "agents", name: "Agents again", position: 1 },
      ];
      files["person.json"] = {
        ...(files["person.json"] as Record<string, unknown>),
        photoId: "00000000-0000-4000-8000-000000000000",
        cvPdf: { file: "files/portrait.jpg" },
      };
      files["organizations.json"] = [
        { slug: "northwind", name: "Northwind Freight", logo: { file: "../outside.png" } },
      ];
      const [planner, rateSheet] = files["projects.json"] as Record<string, unknown>[];
      files["projects.json"] = [{ ...planner, cover: { file: "files/missing.png" } }, rateSheet];
      files["extras.json"] = [];
      await writeFile(join(seedFolder, "outside.png"), logo);

      const folder = await writeSeed(await mkdtemp(join(seedFolder, "invalid-")), files);
      const error = await refusal(seed().loadSeed(folder));

      expect(error.code).toBe("validation_failed");
      expect(error.fields?.map(({ path }) => path).sort()).toEqual(
        [
          "extras.json",
          "organizations.json[0].logo.file",
          "person.json.cvPdf.file",
          "person.json.photoId",
          "projects.json[0].cover.file",
          "technologies.json[1].group",
          "topics.json[1].slug",
        ].sort(),
      );
      expect(JSON.stringify([error.message, error.fields])).not.toContain(seedFolder);
      await expectEmpty();
    });

    it("rejects a malformed data file", async () => {
      const folder = await mkdtemp(join(seedFolder, "malformed-"));
      await writeFile(join(folder, "topics.json"), "[{ not json");
      await writeFile(join(folder, "person.json"), "[]");

      const error = await refusal(seed().loadSeed(folder));

      expect(error.code).toBe("validation_failed");
      expect(error.fields?.map(({ path }) => path).sort()).toEqual(["person.json", "topics.json"]);
      await expectEmpty();
    });

    it("rejects references to records that neither the seed nor the database has", async () => {
      const files = fixture();
      const [platform, consulting] = files["experiences.json"] as Record<string, unknown>[];
      files["experiences.json"] = [
        { ...platform, organization: "ghost-freight", technologies: ["typescript", "cobol"] },
        consulting,
      ];
      files["current-focus.json"] = [
        {
          slug: "planner-agents",
          title: "Agents",
          description: "Fictional.",
          position: 0,
          project: "ghost-project",
        },
      ];

      const error = await refusal(load(files));

      expect(error.code).toBe("validation_failed");
      expect(error.fields?.map(({ path }) => path).sort()).toEqual([
        "current-focus.json[0].project",
        "experiences.json[0].organization",
        "experiences.json[0].technologies[1]",
      ]);
      await expectEmpty();
    });

    it("refuses a missing seed folder without naming it", async () => {
      const missing = join(seedFolder, "does-not-exist");
      const error = await refusal(seed().loadSeed(missing));
      expect(error.code).toBe("validation_failed");
      expect(JSON.stringify([error.message, error.fields])).not.toContain(missing);
    });
  });

  describe("a failure while writing", () => {
    it("rolls every write back and removes the files it stored", async () => {
      const failing: Pick<Persistence, "profile" | "transaction"> = {
        profile: persistence.profile,
        transaction: (work) =>
          persistence.transaction((profileInTransaction) =>
            work({
              ...profileInTransaction,
              createCurrentFocus: () => Promise.reject(new Error("A fictional failure.")),
            }),
          ),
      };
      const folder = await writeSeed(await mkdtemp(join(seedFolder, "failing-")), fixture());

      await expect(seed(failing).loadSeed(folder)).rejects.toThrow("A fictional failure.");

      await expectEmpty();
      expect(failures).toEqual([]);
    });

    it("leaves a loaded profile as it was", async () => {
      await load(fixture());
      const before = await snapshot();
      const changed = fixture();
      changed["files/cover.png"] = otherCover;
      const failing: Pick<Persistence, "profile" | "transaction"> = {
        profile: persistence.profile,
        transaction: (work) =>
          persistence.transaction((profileInTransaction) =>
            work({
              ...profileInTransaction,
              updateCurrentFocus: () => Promise.reject(new Error("A fictional failure.")),
            }),
          ),
      };
      const folder = await writeSeed(await mkdtemp(join(seedFolder, "failing-")), changed);

      await expect(seed(failing).loadSeed(folder)).rejects.toThrow("A fictional failure.");

      expect(await snapshot()).toEqual(before);
      expect(await filesBelow(storageFolder)).toHaveLength(4);
    });
  });
});
