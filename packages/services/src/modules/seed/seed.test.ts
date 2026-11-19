import { chmod, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
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
import { createRoadmapService, type RoadmapService } from "../roadmap/index.js";
import { openStorage, type OpenedStorage } from "../storage/index.js";
import { createSeedService, type SeedKind, type SeedReport } from "./index.js";

const limits: MediaLimits = { maxBytes: 64 * 1024, maxImageDimension: 2000 };

/** The files of a small fictional seed, by their path inside the seed folder. */
type SeedFiles = Record<string, unknown>;

const portrait = sampleJpeg({ width: 30, height: 40 });
const logo = samplePng({ width: 16, height: 16 });
const cover = samplePng({ width: 60, height: 30 });
const otherCover = samplePng({ width: 61, height: 30 });
const avatar = samplePng({ width: 20, height: 20 });
const otherAvatar = samplePng({ width: 21, height: 21 });
const bookCover = samplePng({ width: 50, height: 75 });
const otherBookCover = samplePng({ width: 51, height: 75 });
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
      authorPhoto: { file: "files/sam.png", altText: "A fictional illustrated avatar." },
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
  "roadmap-areas.json": [
    { slug: "foundations", name: "Foundations", weight: 40, position: 0 },
    {
      slug: "practice",
      name: "Practice",
      description: "A **fictional** area.",
      weight: 60,
      position: 1,
    },
  ],
  "roadmap-modules.json": [
    { slug: "prompting", area: "foundations", name: "Prompting", position: 0 },
    { slug: "retrieval-basics", area: "foundations", name: "Retrieval basics", position: 1 },
    { slug: "shipping", area: "practice", name: "Shipping", position: 0 },
  ],
  "roadmap-resources.json": [
    {
      slug: "prompting-guide",
      module: "prompting",
      name: "A fictional prompting guide",
      type: "link",
      status: "completed",
      estimatedMinutes: 90,
      startedAt: "2025-01-02T09:00:00.000Z",
      finishedAt: "2025-01-05T18:00:00.000Z",
      link: "https://guide.example.test/",
      position: 0,
      topics: ["agents"],
    },
    {
      slug: "prompting-drills",
      module: "prompting",
      name: "Fictional drills",
      type: "project",
      status: "skipped",
      position: 1,
    },
    {
      slug: "vector-talk",
      module: "retrieval-basics",
      name: "A fictional talk",
      type: "youtube-video",
      status: "in-progress",
      estimatedMinutes: 45,
      startedAt: "2025-02-01T09:00:00.000Z",
      position: 0,
      topics: ["rag", "agents"],
    },
  ],
  "roadmap-diary.json": [
    { date: "2025-02-03", notes: "Watched a **fictional** talk about vectors." },
    { date: "2025-02-05", notes: "Only planned the week." },
  ],
  "roadmap-time-entries.json": [
    {
      resource: "vector-talk",
      startedAt: "2025-02-03T23:30:00+01:00",
      endedAt: "2025-02-04T00:30:00+01:00",
    },
    {
      resource: "prompting-guide",
      startedAt: "2025-02-03T08:00:00Z",
      endedAt: "2025-02-03T09:15:00Z",
    },
  ],
  "files/portrait.jpg": portrait,
  "files/northwind.png": logo,
  "files/cover.png": cover,
  "files/sam.png": avatar,
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
  "roadmapAreas",
  "roadmapModules",
  "roadmapBooks",
  "roadmapResources",
  "roadmapEvents",
  "roadmapDiary",
  "roadmapTimeEntries",
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
  roadmapAreas: 2,
  roadmapModules: 3,
  roadmapBooks: 0,
  roadmapResources: 3,
  roadmapEvents: 0,
  roadmapDiary: 2,
  roadmapTimeEntries: 2,
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

/** A copy without `updatedAt` and the roadmap's `lastUpdatedAt` derived from it, which every load advances. */
function withoutUpdatedAt(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutUpdatedAt);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "updatedAt" && key !== "lastUpdatedAt")
        .map(([key, nested]) => [key, withoutUpdatedAt(nested)]),
    );
  }
  return value;
}

describe("seed service", () => {
  let database: TemporaryDatabase;
  let persistence: Persistence;
  let profile: ProfileService;
  let roadmap: RoadmapService;
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

  const seed = (over: Pick<Persistence, "profile" | "roadmap" | "transaction"> = persistence) =>
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
    roadmap: (await roadmap.getRoadmap()).areas,
    diary: (await roadmap.getDiary()).days,
    books: await roadmap.listBooks(),
    events: await roadmap.listEvents(),
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
    roadmap = createRoadmapService(persistence.roadmap);
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
        media: { uploaded: 5, reused: 0, removed: 0 },
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
      const avatarMedia = state.media.find(
        ({ altText }) => altText === "A fictional illustrated avatar.",
      );
      expect(avatarMedia).toMatchObject({ mediaType: "image/png", width: 20, height: 20 });
      expect(state.testimonials[0]).toMatchObject({ authorPhotoId: avatarMedia?.id });
      expect(state.currentFocus[0]).toMatchObject({
        project: { slug: "dock-planner" },
        topics: [{ slug: "agents" }, { slug: "rag" }],
      });
      expect(await filesBelow(storageFolder)).toHaveLength(5);
    });

    it("creates the roadmap hierarchy in order with its topic links and derived progress", async () => {
      await load(fixture());

      const tree = await roadmap.getRoadmap();
      expect(
        tree.areas.map((area) => ({
          slug: area.slug,
          modules: area.modules.map((module) => ({
            slug: module.slug,
            resources: module.resources.map((resource) => [
              resource.slug,
              resource.status,
              resource.estimatedMinutes,
              resource.topics.map((topic) => topic.slug),
            ]),
          })),
        })),
      ).toEqual([
        {
          slug: "foundations",
          modules: [
            {
              slug: "prompting",
              resources: [
                ["prompting-guide", "completed", 90, ["agents"]],
                ["prompting-drills", "skipped", null, []],
              ],
            },
            {
              slug: "retrieval-basics",
              resources: [["vector-talk", "in-progress", 45, ["rag", "agents"]]],
            },
          ],
        },
        { slug: "practice", modules: [{ slug: "shipping", resources: [] }] },
      ]);
      expect(tree.areas[0]?.modules[0]?.progress).toMatchObject({
        completed: 1,
        total: 2,
        status: "completed",
        completedAt: "2025-01-05T18:00:00.000Z",
      });
      expect(tree.summary).toMatchObject({ areaCount: 2, moduleCount: 3, resourceCount: 3 });
    });

    it("creates the diary in Prague days with a session split at midnight", async () => {
      await load(fixture());

      const diary = await roadmap.getDiary();
      expect(
        diary.days.map((day) => ({
          date: day.date,
          notes: day.notes,
          entries: day.entries.map((entry) => [entry.resource?.slug, entry.durationSeconds]),
          totalSeconds: day.totalSeconds,
        })),
      ).toEqual([
        { date: "2025-02-05", notes: "Only planned the week.", entries: [], totalSeconds: 0 },
        { date: "2025-02-04", notes: null, entries: [["vector-talk", 1800]], totalSeconds: 1800 },
        {
          date: "2025-02-03",
          notes: "Watched a **fictional** talk about vectors.",
          entries: [
            ["prompting-guide", 4500],
            ["vector-talk", 1800],
          ],
          totalSeconds: 6300,
        },
      ]);
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
        media: { uploaded: 0, reused: 5, removed: 0 },
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

      expect(report.media).toEqual({ uploaded: 1, reused: 4, removed: 1 });
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
      expect(after.media).toHaveLength(5);
      expect(after.media.find(({ id }) => id === newCover)).toMatchObject({
        width: 61,
        altText: "A new fictional dock.",
      });
      expect(after.media.some(({ id }) => id === oldCover)).toBe(false);
      expect(await filesBelow(storageFolder)).toHaveLength(5);
      expect(after.projects).toHaveLength(2);
      expect(after.services[0]?.evidence).toHaveLength(3);
      expect(withoutUpdatedAt(after.topics)).toEqual(withoutUpdatedAt(before.topics));
    });

    it("moves a roadmap module and resource and relinks topics without duplicating them", async () => {
      await load(fixture());
      const before = await roadmap.getResource("vector-talk");
      const changed = fixture();
      const [prompting, retrieval, shipping] = changed["roadmap-modules.json"] as Record<
        string,
        unknown
      >[];
      changed["roadmap-modules.json"] = [
        prompting,
        { ...retrieval, area: "practice", position: 1 },
        shipping,
      ];
      const [guide, drills, talk] = changed["roadmap-resources.json"] as Record<string, unknown>[];
      changed["roadmap-resources.json"] = [
        guide,
        drills,
        { ...talk, module: "shipping", topics: ["agents"] },
      ];

      await expect(load(changed)).resolves.toMatchObject({
        records: {
          roadmapAreas: { created: 0, updated: 2 },
          roadmapModules: { created: 0, updated: 3 },
          roadmapResources: { created: 0, updated: 3 },
        },
      });

      expect(await roadmap.getModule("retrieval-basics")).toMatchObject({ area: "practice" });
      const after = await roadmap.getResource("vector-talk");
      expect(after).toMatchObject({ id: before.id, module: "shipping" });
      expect(after.topics.map((topic) => topic.slug)).toEqual(["agents"]);
      const tree = await roadmap.getRoadmap();
      expect(tree.summary).toMatchObject({ areaCount: 2, moduleCount: 3, resourceCount: 3 });
      expect(tree.areas.map((area) => area.modules.map((module) => module.slug))).toEqual([
        ["prompting"],
        ["shipping", "retrieval-basics"],
      ]);
    });

    it("overwrites diary notes and adds a new session while matching the logged ones", async () => {
      await load(fixture());
      const changed = fixture();
      changed["roadmap-diary.json"] = [
        { date: "2025-02-03", notes: "Rewritten notes." },
        { date: "2025-02-04", notes: "A new note on the day after midnight." },
      ];
      changed["roadmap-time-entries.json"] = [
        ...(changed["roadmap-time-entries.json"] as unknown[]),
        {
          resource: "prompting-guide",
          startedAt: "2025-02-03T09:15:00Z",
          endedAt: "2025-02-03T09:45:00Z",
        },
      ];

      const report = await load(changed);

      expect(report.records.roadmapDiary).toEqual({ created: 1, updated: 1 });
      expect(report.records.roadmapTimeEntries).toEqual({ created: 1, updated: 2 });
      await expect(roadmap.getDiaryDay("2025-02-03")).resolves.toMatchObject({
        notes: "Rewritten notes.",
        totalSeconds: 6300 + 1800,
      });
      await expect(roadmap.getDiaryDay("2025-02-04")).resolves.toMatchObject({
        notes: "A new note on the day after midnight.",
        totalSeconds: 1800,
      });
      await expect(roadmap.getDiaryDay("2025-02-05")).resolves.toMatchObject({
        notes: "Only planned the week.",
      });
    });

    it("matches a session written with another offset as the same instants", async () => {
      await load(fixture());
      const before = await snapshot();
      const changed = fixture();
      changed["roadmap-time-entries.json"] = [
        {
          resource: "vector-talk",
          startedAt: "2025-02-03T22:30:00Z",
          endedAt: "2025-02-03T23:30:00Z",
        },
      ];

      const report = await load(changed);

      expect(report.records.roadmapTimeEntries).toEqual({ created: 0, updated: 1 });
      expect(withoutUpdatedAt(await snapshot())).toEqual(withoutUpdatedAt(before));
    });

    it("refuses a session that overlaps logged time at its location and writes nothing", async () => {
      await load(fixture());
      const before = await snapshot();
      const changed = fixture();
      changed["roadmap-diary.json"] = [{ date: "2025-02-03", notes: "Must not be written." }];
      changed["roadmap-time-entries.json"] = [
        {
          resource: "prompting-drills",
          startedAt: "2025-02-03T09:00:00Z",
          endedAt: "2025-02-03T10:00:00Z",
        },
      ];

      const error = await refusal(load(changed));

      expect(error.code).toBe("conflict");
      expect(error.fields?.map(({ path }) => path)).toEqual(["roadmap-time-entries.json[0]"]);
      expect(withoutUpdatedAt(await snapshot())).toEqual(withoutUpdatedAt(before));
    });

    it("resolves roadmap parents and topics that only the database holds", async () => {
      await load(fixture());

      const report = await load({
        "roadmap-resources.json": [
          {
            slug: "shipping-checklist",
            module: "shipping",
            name: "A fictional checklist",
            type: "text",
            position: 0,
            topics: ["rag"],
          },
        ],
      });

      expect(report.records.roadmapResources).toEqual({ created: 1, updated: 0 });
      await expect(roadmap.getResource("shipping-checklist")).resolves.toMatchObject({
        module: "shipping",
        status: "planned",
        estimatedMinutes: null,
      });
    });

    it("replaces a changed author photo and clears a removed one", async () => {
      await load(fixture());
      const before = await snapshot();
      const oldPhoto = before.media.find(({ width }) => width === 20)?.id;
      expect(before.testimonials[0]).toMatchObject({ authorPhotoId: oldPhoto });
      const changed = fixture();
      const [words] = changed["testimonials.json"] as Record<string, unknown>[];
      changed["testimonials.json"] = [{ ...words, authorPhoto: { file: "files/sam-2.png" } }];
      changed["files/sam-2.png"] = otherAvatar;

      await expect(load(changed)).resolves.toMatchObject({
        media: { uploaded: 1, reused: 4, removed: 1 },
      });
      const after = await snapshot();
      const newPhoto = after.media.find(({ width }) => width === 21)?.id;
      expect(newPhoto).toEqual(expect.any(String));
      expect(after.testimonials[0]).toMatchObject({ authorPhotoId: newPhoto });
      expect(after.media.some(({ id }) => id === oldPhoto)).toBe(false);

      changed["testimonials.json"] = [{ ...words, authorPhoto: null }];
      await expect(load(changed)).resolves.toMatchObject({
        media: { uploaded: 0, reused: 4, removed: 1 },
      });
      expect((await snapshot()).testimonials[0]).toMatchObject({ authorPhotoId: null });
      expect(await filesBelow(storageFolder)).toHaveLength(4);
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

  describe("the bookshelf", () => {
    /** The fixture with two fictional books, one with a cover, read by a resource of type book. */
    const withBooks = (): SeedFiles => {
      const files = fixture();
      files["roadmap-books.json"] = [
        {
          slug: "fictional-patterns",
          title: "Fictional patterns",
          author: "Ada Example",
          pages: 320,
          priority: 0,
          startedOn: "2025-02-01",
          summary: "A **fictional** summary.",
          cover: { file: "files/book.png", altText: "A fictional book cover." },
        },
        { slug: "fictional-backlog", title: "A fictional backlog", priority: 1 },
      ];
      files["roadmap-resources.json"] = [
        ...(files["roadmap-resources.json"] as unknown[]),
        {
          slug: "patterns-reading",
          module: "shipping",
          name: "Reading fictional patterns",
          type: "book",
          status: "in-progress",
          position: 0,
          book: "fictional-patterns",
          topics: ["agents", "rag"],
        },
      ];
      files["roadmap-time-entries.json"] = [
        ...(files["roadmap-time-entries.json"] as unknown[]),
        {
          resource: "patterns-reading",
          startedAt: "2025-02-06T19:00:00Z",
          endedAt: "2025-02-06T19:40:00Z",
        },
      ];
      files["files/book.png"] = bookCover;
      return files;
    };

    it("creates books with their cover, the resource link and the reading time", async () => {
      await expect(load(withBooks())).resolves.toMatchObject({
        records: {
          roadmapBooks: { created: 2, updated: 0 },
          roadmapResources: { created: 4, updated: 0 },
          roadmapTimeEntries: { created: 3, updated: 0 },
        },
        media: { uploaded: 6, reused: 0, removed: 0 },
      });

      const books = await roadmap.listBooks();
      expect(books.map(({ slug, status }) => [slug, status])).toEqual([
        ["fictional-patterns", "reading"],
        ["fictional-backlog", "to-read"],
      ]);
      expect(books[0]).toMatchObject({
        author: "Ada Example",
        pages: 320,
        summary: "A **fictional** summary.",
        cover: { width: 50, height: 75, altText: "A fictional book cover." },
        resource: { slug: "patterns-reading", module: "shipping", area: "practice" },
        readingSeconds: 2400,
      });
      expect(books[1]).toMatchObject({ author: null, cover: null, resource: null });
      await expect(roadmap.getResource("patterns-reading")).resolves.toMatchObject({
        book: "fictional-patterns",
      });
    });

    it("keeps every book, link and cover of an identical rerun", async () => {
      await load(withBooks());
      const before = await snapshot();
      const files = await filesBelow(storageFolder);

      await expect(load(withBooks())).resolves.toMatchObject({
        records: { roadmapBooks: { created: 0, updated: 2 } },
        media: { uploaded: 0, reused: 6, removed: 0 },
      });

      expect(withoutUpdatedAt(await snapshot())).toEqual(withoutUpdatedAt(before));
      expect(await filesBelow(storageFolder)).toEqual(files);
      expect(failures).toEqual([]);
    });

    it("replaces a changed cover and removes the one no record uses any more", async () => {
      await load(withBooks());
      const oldCover = (await roadmap.getBook("fictional-patterns")).coverId;
      const changed = withBooks();
      const [patterns, backlog] = changed["roadmap-books.json"] as Record<string, unknown>[];
      changed["roadmap-books.json"] = [
        { ...patterns, cover: { file: "files/book-2.png", altText: "A new fictional cover." } },
        backlog,
      ];
      changed["files/book-2.png"] = otherBookCover;

      await expect(load(changed)).resolves.toMatchObject({
        media: { uploaded: 1, reused: 5, removed: 1 },
      });

      const after = await roadmap.getBook("fictional-patterns");
      expect(after.coverId).not.toBe(oldCover);
      expect(after.cover).toMatchObject({ width: 51, altText: "A new fictional cover." });
      expect((await media().listMedia()).some(({ id }) => id === oldCover)).toBe(false);
      expect(await filesBelow(storageFolder)).toHaveLength(6);
      expect(await roadmap.listBooks()).toHaveLength(2);
    });

    it("rejects a link to a book that neither the seed nor the database has", async () => {
      const files = withBooks();
      const resources = files["roadmap-resources.json"] as Record<string, unknown>[];
      files["roadmap-resources.json"] = resources.map((resource) =>
        resource["slug"] === "patterns-reading" ? { ...resource, book: "ghost-book" } : resource,
      );

      const error = await refusal(load(files));

      expect(error.code).toBe("validation_failed");
      expect(error.fields?.map(({ path }) => path)).toEqual(["roadmap-resources.json[3].book"]);
      await expectEmpty();
    });

    it("resolves a link to a book that only the database holds", async () => {
      await roadmap.createBook({
        slug: "hand-shelved",
        title: "A fictional hand-shelved book",
        author: null,
        description: null,
        pages: null,
        year: null,
        isbn: null,
        priority: 0,
        startedOn: null,
        endedOn: null,
        summary: null,
        coverId: null,
      });
      const files = withBooks();
      delete files["roadmap-books.json"];
      const resources = files["roadmap-resources.json"] as Record<string, unknown>[];
      files["roadmap-resources.json"] = resources.map((resource) =>
        resource["slug"] === "patterns-reading" ? { ...resource, book: "hand-shelved" } : resource,
      );

      await load(files);

      await expect(roadmap.getBook("hand-shelved")).resolves.toMatchObject({
        resource: { slug: "patterns-reading" },
        readingSeconds: 2400,
      });
    });

    it("treats a bookshelf with only a book as not empty", async () => {
      await roadmap.createBook({
        slug: "hand-shelved",
        title: "A fictional hand-shelved book",
        author: null,
        description: null,
        pages: null,
        year: null,
        isbn: null,
        priority: 0,
        startedOn: null,
        endedOn: null,
        summary: null,
        coverId: null,
      });
      const before = await snapshot();
      const folder = await mkdtemp(join(seedFolder, "empty-books-"));

      await expect(
        seed().loadSeedIntoEmpty(await writeSeed(folder, withBooks())),
      ).resolves.toBeNull();

      expect(await snapshot()).toEqual(before);
      expect(await filesBelow(storageFolder)).toEqual([]);
    });
  });

  describe("the attended events", () => {
    /**
     * The fixture with two fictional events, one across the turn of a year and one online on a
     * single day, and attendance logged on the first.
     */
    const withEvents = (): SeedFiles => {
      const files = fixture();
      files["roadmap-events.json"] = [
        {
          slug: "harbour-summit",
          name: "Fictional Harbour Summit",
          kind: "conference",
          organizer: "Harbour Guild",
          startsOn: "2025-12-30",
          endsOn: "2026-01-02",
          place: "Harbour City",
          link: "https://summit.example.test/",
          takeaways: "A **fictional** takeaway.",
          topics: ["rag", "agents"],
        },
        {
          slug: "agents-evening",
          name: "A fictional agents evening",
          kind: "meetup",
          startsOn: "2025-02-10",
          endsOn: "2025-02-10",
          online: true,
        },
      ];
      files["roadmap-time-entries.json"] = [
        ...(files["roadmap-time-entries.json"] as unknown[]),
        {
          event: "harbour-summit",
          startedAt: "2025-12-31T09:00:00+01:00",
          endedAt: "2025-12-31T10:30:00+01:00",
        },
      ];
      return files;
    };

    it("creates events with their topics, their days in the diary and the attendance", async () => {
      await expect(load(withEvents())).resolves.toMatchObject({
        records: {
          roadmapEvents: { created: 2, updated: 0 },
          roadmapTimeEntries: { created: 3, updated: 0 },
        },
      });

      const events = await roadmap.listEvents();
      expect(events.map(({ slug }) => slug)).toEqual(["harbour-summit", "agents-evening"]);
      expect(events[0]).toMatchObject({
        organizer: "Harbour Guild",
        startsOn: "2025-12-30",
        endsOn: "2026-01-02",
        online: false,
        attendanceSeconds: 5400,
      });
      expect(events[0]?.topics.map(({ slug }) => slug)).toEqual(["rag", "agents"]);
      expect(events[1]).toMatchObject({ online: true, place: null, attendanceSeconds: 0 });

      const days = (await roadmap.getDiary()).days;
      const eventDays = days
        .filter((day) => day.events.length > 0)
        .map((day) => [day.date, day.events.map(({ slug }) => slug)]);
      expect(eventDays).toEqual([
        ["2026-01-02", ["harbour-summit"]],
        ["2026-01-01", ["harbour-summit"]],
        ["2025-12-31", ["harbour-summit"]],
        ["2025-12-30", ["harbour-summit"]],
        ["2025-02-10", ["agents-evening"]],
      ]);
    });

    it("keeps every event, topic link and attendance session of an identical rerun", async () => {
      await load(withEvents());
      const before = await snapshot();

      await expect(load(withEvents())).resolves.toMatchObject({
        records: {
          roadmapEvents: { created: 0, updated: 2 },
          roadmapTimeEntries: { created: 0, updated: 3 },
        },
      });

      expect(withoutUpdatedAt(await snapshot())).toEqual(withoutUpdatedAt(before));
    });

    it("overwrites an edited event with the seed's values", async () => {
      await load(withEvents());
      await roadmap.updateEvent("agents-evening", { name: "Renamed by hand", topics: ["rag"] });

      await load(withEvents());

      await expect(roadmap.getEvent("agents-evening")).resolves.toMatchObject({
        name: "A fictional agents evening",
        topics: [],
      });
    });

    it("rejects event and topic references that neither the seed nor the database has", async () => {
      const files = withEvents();
      const [summit, evening] = files["roadmap-events.json"] as Record<string, unknown>[];
      files["roadmap-events.json"] = [{ ...summit, topics: ["rag", "ghost-topic"] }, evening];
      const sessions = files["roadmap-time-entries.json"] as Record<string, unknown>[];
      files["roadmap-time-entries.json"] = sessions.map((session) =>
        session["event"] === "harbour-summit" ? { ...session, event: "ghost-event" } : session,
      );

      const error = await refusal(load(files));

      expect(error.code).toBe("validation_failed");
      expect(error.fields?.map(({ path }) => path)).toEqual([
        "roadmap-events.json[0].topics[1]",
        "roadmap-time-entries.json[2].event",
      ]);
      await expectEmpty();
    });

    it("refuses attendance outside its event at its location and writes nothing", async () => {
      const files = withEvents();
      const sessions = files["roadmap-time-entries.json"] as Record<string, unknown>[];
      files["roadmap-time-entries.json"] = sessions.map((session) =>
        session["event"] === "harbour-summit"
          ? {
              ...session,
              startedAt: "2026-01-03T09:00:00+01:00",
              endedAt: "2026-01-03T10:00:00+01:00",
            }
          : session,
      );

      const error = await refusal(load(files));

      expect(error.code).toBe("validation_failed");
      expect(error.fields?.map(({ path }) => path)).toEqual([
        "roadmap-time-entries.json[2].startedAt",
      ]);
      await expectEmpty();
    });

    it("treats a roadmap with only an event as not empty", async () => {
      await roadmap.createEvent({
        slug: "hand-noted",
        name: "A fictional hand-noted event",
        kind: "lecture",
        organizer: null,
        startsOn: "2025-03-01",
        endsOn: "2025-03-01",
        place: null,
        online: false,
        link: null,
        takeaways: null,
        topics: [],
      });
      const before = await snapshot();
      const folder = await mkdtemp(join(seedFolder, "empty-events-"));

      await expect(
        seed().loadSeedIntoEmpty(await writeSeed(folder, withEvents())),
      ).resolves.toBeNull();

      expect(await snapshot()).toEqual(before);
    });
  });

  describe("only into an empty profile", () => {
    const loadIntoEmpty = async (files: SeedFiles) => {
      const folder = await mkdtemp(join(seedFolder, "empty-"));
      return seed().loadSeedIntoEmpty(await writeSeed(folder, files));
    };

    it("loads the seed when the profile holds nothing", async () => {
      await expect(loadIntoEmpty(fixture())).resolves.toMatchObject({
        records: allCreated,
        media: { uploaded: 5, reused: 0, removed: 0 },
      });
      expect(await profile.getPerson()).toMatchObject({ name: "Robin Example" });
    });

    it("loads nothing and keeps every edit once the profile holds anything", async () => {
      await loadIntoEmpty(fixture());
      await profile.updatePerson({ headline: "Edited by hand" });
      const before = await snapshot();
      const files = await filesBelow(storageFolder);

      await expect(loadIntoEmpty(fixture())).resolves.toBeNull();

      expect(await snapshot()).toEqual(before);
      expect(await filesBelow(storageFolder)).toEqual(files);
      expect((await profile.getPerson()).headline).toBe("Edited by hand");
    });

    it.each([
      [
        "a topic",
        (p: ProfileService) => p.createTopic({ slug: "evals", name: "Evals", position: 0 }),
      ],
      [
        "a technology",
        (p: ProfileService) =>
          p.createTechnology({
            slug: "go",
            name: "Go",
            tier: "secondary",
            group: null,
            logoKey: null,
            position: 0,
          }),
      ],
      [
        "an education record",
        (p: ProfileService) =>
          p.createEducation({
            slug: "school",
            kind: "school",
            title: "Fictional studies",
            institution: "Fictional School",
            startedOn: "2008-09-01",
            endedOn: null,
            description: null,
            position: 0,
          }),
      ],
    ])("treats a profile with only %s as not empty", async (_name, create) => {
      await create(profile);
      const before = await snapshot();

      await expect(loadIntoEmpty(fixture())).resolves.toBeNull();

      expect(await snapshot()).toEqual(before);
      expect(await filesBelow(storageFolder)).toEqual([]);
    });

    it("treats a roadmap with only an area as not empty", async () => {
      await roadmap.createArea({
        slug: "hand-made",
        name: "Hand made",
        description: null,
        weight: 10,
        position: 0,
      });
      const before = await snapshot();

      await expect(loadIntoEmpty(fixture())).resolves.toBeNull();

      expect(await snapshot()).toEqual(before);
      expect(await filesBelow(storageFolder)).toEqual([]);
    });

    it("treats a diary with only notes as not empty", async () => {
      await roadmap.writeDiaryNotes("2025-01-01", { notes: "Hand-written." });
      const before = await snapshot();

      await expect(loadIntoEmpty(fixture())).resolves.toBeNull();

      expect(await snapshot()).toEqual(before);
    });

    it("treats a media library with a file as not empty", async () => {
      await media().uploadMedia({
        bytes: samplePng({ width: 8, height: 8 }),
        filename: "dot.png",
        declaredType: "image/png",
        altText: "A fictional dot.",
      });
      const files = await filesBelow(storageFolder);

      await expect(loadIntoEmpty(fixture())).resolves.toBeNull();

      expect(await profile.getPerson().catch(() => null)).toBeNull();
      expect(await filesBelow(storageFolder)).toEqual(files);
    });

    it("still refuses an invalid seed", async () => {
      const folder = await mkdtemp(join(seedFolder, "empty-malformed-"));
      await writeFile(join(folder, "topics.json"), "[{ not json");

      const error = await refusal(seed().loadSeedIntoEmpty(folder));

      expect(error.code).toBe("validation_failed");
      await expectEmpty();
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
      const [words] = files["testimonials.json"] as Record<string, unknown>[];
      files["testimonials.json"] = [{ ...words, authorPhoto: { file: "files/cv.pdf" } }];
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
          "testimonials.json[0].authorPhoto.file",
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

    it("rejects a reserved roadmap area slug and an invalid resource before any write", async () => {
      const files = fixture();
      const [foundations, practice] = files["roadmap-areas.json"] as Record<string, unknown>[];
      files["roadmap-areas.json"] = [foundations, { ...practice, slug: "bookshelf" }];
      const [guide, drills, talk] = files["roadmap-resources.json"] as Record<string, unknown>[];
      files["roadmap-resources.json"] = [
        { ...guide, finishedAt: "2024-12-31T00:00:00.000Z" },
        { ...drills, status: "abandoned" },
        talk,
      ];

      const error = await refusal(load(files));

      expect(error.code).toBe("validation_failed");
      expect(error.fields?.map(({ path }) => path).sort()).toEqual([
        "roadmap-areas.json[1].slug",
        "roadmap-resources.json[0].finishedAt",
        "roadmap-resources.json[1].status",
      ]);
      await expectEmpty();
    });

    it("rejects roadmap references that neither the seed nor the database has", async () => {
      const files = fixture();
      const [prompting, retrieval] = files["roadmap-modules.json"] as Record<string, unknown>[];
      files["roadmap-modules.json"] = [
        prompting,
        retrieval,
        { ...retrieval, slug: "x", area: "ghost-area" },
      ];
      const [guide, drills] = files["roadmap-resources.json"] as Record<string, unknown>[];
      files["roadmap-resources.json"] = [
        { ...guide, topics: ["agents", "ghost-topic"] },
        { ...drills, module: "ghost-module" },
      ];
      // The talk is no longer in the seed, so only the session on the guide stays.
      files["roadmap-time-entries.json"] = (
        files["roadmap-time-entries.json"] as Record<string, unknown>[]
      ).filter((session) => session["resource"] === "prompting-guide");

      const error = await refusal(load(files));

      expect(error.code).toBe("validation_failed");
      expect(error.fields?.map(({ path }) => path).sort()).toEqual([
        "roadmap-modules.json[2].area",
        "roadmap-resources.json[0].topics[1]",
        "roadmap-resources.json[1].module",
      ]);
      await expectEmpty();
    });

    it("rejects malformed diary days and sessions before any write", async () => {
      const files = fixture();
      files["roadmap-diary.json"] = [
        { date: "2025-02-30", notes: "No such day." },
        { date: "2025-02-03", notes: "  " },
        { date: "2025-02-06", notes: "Fine." },
        { date: "2025-02-06", notes: "The same day again." },
      ];
      const [session] = files["roadmap-time-entries.json"] as Record<string, unknown>[];
      files["roadmap-time-entries.json"] = [
        session,
        { ...session, startedAt: "2025-02-03T22:30:00Z", endedAt: "2025-02-03T23:30:00Z" },
        { ...session, startedAt: "2025-02-10T10:00:00", endedAt: "2025-02-10T11:00:00+01:00" },
        { ...session, endedAt: "2025-02-03T22:00:00Z" },
        { ...session, minutes: 60 },
      ];

      const error = await refusal(load(files));

      expect(error.code).toBe("validation_failed");
      expect(error.fields?.map(({ path }) => path).sort()).toEqual(
        [
          "roadmap-diary.json[0].date",
          "roadmap-diary.json[1].notes",
          "roadmap-diary.json[3].date",
          "roadmap-time-entries.json[1]",
          "roadmap-time-entries.json[2].startedAt",
          "roadmap-time-entries.json[3].endedAt",
          "roadmap-time-entries.json[4]",
        ].sort(),
      );
      await expectEmpty();
    });

    it("rejects a session on a resource that neither the seed nor the database has", async () => {
      const files = fixture();
      const [session, other] = files["roadmap-time-entries.json"] as Record<string, unknown>[];
      files["roadmap-time-entries.json"] = [{ ...session, resource: "ghost-talk" }, other];

      const error = await refusal(load(files));

      expect(error.code).toBe("validation_failed");
      expect(error.fields?.map(({ path }) => path)).toEqual([
        "roadmap-time-entries.json[0].resource",
      ]);
      await expectEmpty();
    });

    it("refuses sessions of the seed that overlap each other and writes nothing", async () => {
      const files = fixture();
      const [session, other] = files["roadmap-time-entries.json"] as Record<string, unknown>[];
      files["roadmap-time-entries.json"] = [
        session,
        other,
        { ...other, resource: "prompting-drills", startedAt: "2025-02-03T09:00:00Z" },
      ];

      const error = await refusal(load(files));

      expect(error.code).toBe("conflict");
      expect(error.fields?.map(({ path }) => path)).toEqual(["roadmap-time-entries.json[2]"]);
      await expectEmpty();
    });

    it("refuses a missing seed folder without naming it", async () => {
      const missing = join(seedFolder, "does-not-exist");
      const error = await refusal(seed().loadSeed(missing));
      expect(error.code).toBe("validation_failed");
      expect(JSON.stringify([error.message, error.fields])).not.toContain(missing);
    });

    it("refuses a file whose symbolic link leads out of the seed folder", async () => {
      const outside = join(seedFolder, "outside.jpg");
      await writeFile(outside, portrait);
      const folder = await writeSeed(await mkdtemp(join(seedFolder, "symlink-")), fixture());
      await rm(join(folder, "files/portrait.jpg"));
      await symlink(outside, join(folder, "files/portrait.jpg"));

      const error = await refusal(seed().loadSeed(folder));
      expect(error.code).toBe("validation_failed");
      expect(error.fields?.map(({ path }) => path)).toEqual(["person.json.photo.file"]);
      expect(JSON.stringify([error.message, error.fields])).not.toContain(seedFolder);
      await expectEmpty();
    });

    it.each([
      ["an unreadable attached file", "files/portrait.jpg"],
      ["an unreadable folder of attached files", "files"],
      ["an unreadable seed folder", "."],
    ])("refuses %s without naming any path", async (_case, target) => {
      const folder = await writeSeed(await mkdtemp(join(seedFolder, "unreadable-")), fixture());
      await chmod(join(folder, target), 0o000);
      try {
        const error = await refusal(seed().loadSeed(folder));
        expect(error.code).toBe("validation_failed");
        expect(JSON.stringify([error.message, error.fields])).not.toContain(seedFolder);
      } finally {
        await chmod(join(folder, target), 0o700);
      }
      await expectEmpty();
    });
  });

  describe("a failure while writing", () => {
    it("rolls every write back, the roadmap last, and removes the files it stored", async () => {
      const failing: Pick<Persistence, "profile" | "roadmap" | "transaction"> = {
        profile: persistence.profile,
        roadmap: persistence.roadmap,
        transaction: (work) =>
          persistence.transaction((profileInTransaction, roadmapInTransaction) =>
            work(profileInTransaction, {
              ...roadmapInTransaction,
              createRoadmapResource: () => Promise.reject(new Error("A fictional failure.")),
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
      const failing: Pick<Persistence, "profile" | "roadmap" | "transaction"> = {
        profile: persistence.profile,
        roadmap: persistence.roadmap,
        transaction: (work) =>
          persistence.transaction((profileInTransaction, roadmapInTransaction) =>
            work(profileInTransaction, {
              ...roadmapInTransaction,
              updateRoadmapResource: () => Promise.reject(new Error("A fictional failure.")),
            }),
          ),
      };
      const folder = await writeSeed(await mkdtemp(join(seedFolder, "failing-")), changed);

      await expect(seed(failing).loadSeed(folder)).rejects.toThrow("A fictional failure.");

      expect(await snapshot()).toEqual(before);
      expect(await filesBelow(storageFolder)).toHaveLength(5);
    });
  });
});
