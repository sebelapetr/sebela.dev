import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { z } from "zod";

import {
  CaseStudySchema,
  CurrentFocusListSchema,
  CvSchema,
  DiaryDaySchema,
  DiarySchema,
  EducationListSchema,
  ExperienceListSchema,
  ExplorationListSchema,
  MediaListSchema,
  OrganizationListSchema,
  PersonSchema,
  ProjectListSchema,
  RoadmapBookListSchema,
  RoadmapCurrentSchema,
  RoadmapEventListSchema,
  RoadmapFollowedSourceListSchema,
  RoadmapGlossaryTermListSchema,
  RoadmapProjectIdeaListSchema,
  RoadmapSchema,
  RoadmapStatisticsSchema,
  ServiceListSchema,
  TechnologyListSchema,
  TestimonialListSchema,
  TopicListSchema,
} from "@sebela/contracts";

import {
  connection,
  MEDIA_LIMITS,
  MEDIA_PUBLIC_BASE,
  openTestBackend,
  type TestBackend,
} from "../test-support.js";
import { runSeedCommand } from "./seed.js";

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    output: { out: (text: string) => out.push(text), err: (text: string) => err.push(text) },
    out: () => out.join(""),
    err: () => err.join(""),
  };
}

/** A tiny fictional seed folder of its own, so the external-folder tests do not need the demo. */
async function writeSmallSeed(folder: string) {
  await mkdir(folder, { recursive: true });
  await writeFile(
    join(folder, "topics.json"),
    JSON.stringify([{ slug: "fictional-topic", name: "Fictional topic", position: 0 }]),
  );
}

/** One session of a fictional old-application report: its target and absolute endpoints. */
interface SourceSession {
  resource?: string;
  event?: string;
  startedAt: string;
  endedAt: string;
}

/**
 * The fictional source of the launch-import acceptance check: what a mapper would have converted
 * from an old application's report. Its sessions cross Prague midnight, fall on a different UTC
 * and Prague date, and span the spring daylight-saving night.
 */
const launchSource = {
  topics: [{ slug: "fictional-topic", name: "Fictional topic", position: 0 }],
  areas: [{ slug: "fictional-area", name: "Fictional area", weight: 100, position: 0 }],
  modules: [
    { slug: "fictional-module", area: "fictional-area", name: "Fictional module", position: 0 },
  ],
  books: [
    { slug: "fictional-book", title: "A Fictional Book", priority: 0, startedOn: "2025-03-01" },
  ],
  resources: [
    {
      slug: "fictional-course",
      module: "fictional-module",
      name: "A fictional course",
      type: "youtube-video",
      status: "in-progress",
      topics: ["fictional-topic"],
      position: 0,
    },
    {
      slug: "fictional-reading",
      module: "fictional-module",
      name: "Reading the fictional book",
      type: "book",
      status: "in-progress",
      book: "fictional-book",
      position: 1,
    },
  ],
  events: [
    {
      slug: "fictional-meetup",
      name: "A fictional meetup",
      kind: "meetup",
      startsOn: "2025-03-05",
      endsOn: "2025-03-05",
      topics: ["fictional-topic"],
    },
  ],
  diary: [{ date: "2025-02-10", notes: "A fictional first evening." }],
  sessions: [
    // Across Prague midnight: one session, two diary days (1800 s and 2700 s).
    {
      resource: "fictional-course",
      startedAt: "2025-02-10T23:30:00+01:00",
      endedAt: "2025-02-11T00:45:00+01:00",
    },
    // 2025-02-12 in UTC, but 2025-02-13 in Prague.
    {
      resource: "fictional-course",
      startedAt: "2025-02-12T23:15:00Z",
      endedAt: "2025-02-12T23:45:00Z",
    },
    {
      resource: "fictional-reading",
      startedAt: "2025-03-01T18:00:00+01:00",
      endedAt: "2025-03-01T19:00:00+01:00",
    },
    {
      event: "fictional-meetup",
      startedAt: "2025-03-05T18:00:00+01:00",
      endedAt: "2025-03-05T20:00:00+01:00",
    },
    // The spring daylight-saving night: 01:30 to 03:30 on the clock is one hour.
    {
      resource: "fictional-course",
      startedAt: "2025-03-30T01:30:00+01:00",
      endedAt: "2025-03-30T03:30:00+02:00",
    },
  ] satisfies SourceSession[],
};

/** Writes the launch source as a seed folder, as the external mapper would. */
async function writeLaunchSeed(folder: string) {
  await mkdir(folder, { recursive: true });
  const files: Record<string, unknown> = {
    "topics.json": launchSource.topics,
    "roadmap-areas.json": launchSource.areas,
    "roadmap-modules.json": launchSource.modules,
    "roadmap-books.json": launchSource.books,
    "roadmap-resources.json": launchSource.resources,
    "roadmap-events.json": launchSource.events,
    "roadmap-diary.json": launchSource.diary,
    "roadmap-time-entries.json": launchSource.sessions,
  };
  for (const [name, records] of Object.entries(files)) {
    await writeFile(join(folder, name), JSON.stringify(records));
  }
}

/** The elapsed seconds of a source session, from its absolute endpoints. */
const elapsed = ({ startedAt, endedAt }: SourceSession) =>
  (Date.parse(endedAt) - Date.parse(startedAt)) / 1000;

/** The Europe/Prague calendar date of an instant. */
const pragueDate = (instant: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague" }).format(instant);

/** The number of Prague diary days a source session touches, so its expected time-entry pieces. */
const pieces = ({ startedAt, endedAt }: SourceSession) =>
  new Set(
    Array.from(
      { length: Math.ceil((Date.parse(endedAt) - Date.parse(startedAt)) / 60_000) },
      (_, minute) => pragueDate(Date.parse(startedAt) + minute * 60_000),
    ),
  ).size;

describe("the seed CLI", () => {
  let backend: TestBackend;
  let scratch: string;

  beforeEach(async () => {
    backend = await openTestBackend();
    scratch = await mkdtemp(join(tmpdir(), "sebela-seed-cli-"));
  });

  afterEach(async () => {
    await backend.close();
    await rm(scratch, { recursive: true, force: true });
  });

  const run = async (args: string[], cwd?: string) => {
    const io = capture();
    const code = await runSeedCommand(args, backend.services, io.output, cwd);
    return { code, out: io.out(), err: io.err() };
  };

  const read = async <T>(path: string, schema: z.ZodType<T>): Promise<T> => {
    const response = await backend.api().app.request(path, {}, connection());
    expect(response.status, path).toBe(200);
    return schema.parse(await response.json());
  };

  /** The roadmap tree by slug, status and estimate, without timestamps or derived dates. */
  const roadmapShape = async () =>
    (await read("/v1/roadmap", RoadmapSchema)).areas.map((area) => ({
      slug: area.slug,
      modules: area.modules.map((module) => ({
        slug: module.slug,
        resources: module.resources.map(({ slug, status, estimatedMinutes, topics }) => ({
          slug,
          status,
          estimatedMinutes,
          topics: topics.map((topic) => topic.slug),
        })),
      })),
    }));

  /** The number of records of every kind, through the public API. */
  const counts = async () => ({
    technologies: (await read("/v1/technologies", TechnologyListSchema)).length,
    topics: (await read("/v1/topics", TopicListSchema)).length,
    organizations: (await read("/v1/organizations", OrganizationListSchema)).length,
    experiences: (await read("/v1/experiences", ExperienceListSchema)).length,
    projects: (await read("/v1/projects", ProjectListSchema)).length,
    explorations: (await read("/v1/explorations", ExplorationListSchema)).length,
    services: (await read("/v1/services", ServiceListSchema)).length,
    education: (await read("/v1/education", EducationListSchema)).length,
    testimonials: (await read("/v1/testimonials", TestimonialListSchema)).length,
    currentFocus: (await read("/v1/current-focus", CurrentFocusListSchema)).length,
    media: (await read("/v1/media", MediaListSchema)).length,
    roadmap: await roadmapShape(),
    diary: (await read("/v1/roadmap/diary", DiarySchema)).days.map((day) => ({
      date: day.date,
      notes: day.notes,
      entries: day.entries.map(({ resource, event, startedAt, endedAt }) => [
        resource?.slug ?? event?.slug,
        startedAt,
        endedAt,
      ]),
      totalSeconds: day.totalSeconds,
    })),
    books: (await read("/v1/roadmap/books", RoadmapBookListSchema)).map((book) => ({
      slug: book.slug,
      status: book.status,
      cover: book.cover?.key ?? null,
      resource: book.resource?.slug ?? null,
      readingSeconds: book.readingSeconds,
    })),
    events: (await read("/v1/roadmap/events", RoadmapEventListSchema)).map((event) => ({
      slug: event.slug,
      topics: event.topics.map((topic) => topic.slug),
      attendanceSeconds: event.attendanceSeconds,
    })),
    statistics: (await read("/v1/roadmap/statistics", RoadmapStatisticsSchema)).totals,
    projectIdeas: (await read("/v1/roadmap/project-ideas", RoadmapProjectIdeaListSchema)).map(
      (idea) => [idea.slug, idea.topics.map((topic) => topic.slug)],
    ),
    followedSources: (
      await read("/v1/roadmap/followed-sources", RoadmapFollowedSourceListSchema)
    ).map((source) => source.slug),
    glossaryTerms: (await read("/v1/roadmap/glossary-terms", RoadmapGlossaryTermListSchema)).map(
      (term) => term.slug,
    ),
  });

  describe("with the demo seed", () => {
    it("loads a complete fictional profile into an empty database", async () => {
      const result = await run([]);

      expect(result.code, result.err).toBe(0);
      expect(result.out).toMatch(/experiences: \d+ created, 0 updated/);

      const loaded = await counts();
      expect(loaded.technologies).toBeGreaterThanOrEqual(15);
      expect(loaded.topics).toBeGreaterThanOrEqual(4);
      expect(loaded.organizations).toBeGreaterThanOrEqual(4);
      expect(loaded.experiences).toBeGreaterThanOrEqual(5);
      expect(loaded.projects).toBeGreaterThanOrEqual(8);
      expect(loaded.explorations).toBeGreaterThanOrEqual(3);
      expect(loaded.services).toBeGreaterThanOrEqual(3);
      expect(loaded.education).toBeGreaterThanOrEqual(2);
      expect(loaded.testimonials).toBeGreaterThanOrEqual(3);
      expect(loaded.currentFocus).toBeGreaterThanOrEqual(2);

      // A fictional roadmap: an empty area, empty modules, mixed statuses and missing estimates.
      const roadmap = await read("/v1/roadmap", RoadmapSchema);
      expect(roadmap.summary.areaCount).toBeGreaterThanOrEqual(4);
      expect(roadmap.areas.some(({ modules }) => modules.length === 0)).toBe(true);
      const modules = roadmap.areas.flatMap((area) => area.modules);
      expect(modules.some(({ resources }) => resources.length === 0)).toBe(true);
      expect(modules.every(({ resources }) => resources.length <= 5)).toBe(true);
      const resources = modules.flatMap((module) => module.resources);
      expect(new Set(resources.map(({ status }) => status))).toEqual(
        new Set(["planned", "in-progress", "completed", "paused", "skipped"]),
      );
      expect(resources.some(({ estimatedMinutes }) => estimatedMinutes === null)).toBe(true);
      expect(resources.some(({ topics }) => topics.length > 0)).toBe(true);
      expect(result.out).toMatch(/roadmap resources: \d+ created, 0 updated/);
      // Detail pages have Markdown to render, and the homepage has current learning to show.
      expect(modules.some(({ description }) => description !== null)).toBe(true);
      expect(resources.some(({ description }) => description !== null)).toBe(true);
      const current = await read("/v1/roadmap/current", RoadmapCurrentSchema);
      expect(current.areas.length).toBeGreaterThanOrEqual(2);
      expect(current.areas.every(({ modules: inProgress }) => inProgress.length > 0)).toBe(true);

      // A few weeks of diary: notes-only days, logged days and a session split at Prague midnight.
      const diary = await read("/v1/roadmap/diary", DiarySchema);
      expect(diary.days.length).toBeGreaterThanOrEqual(8);
      expect(diary.days.some(({ entries, notes }) => entries.length === 0 && notes)).toBe(true);
      expect(diary.days.some(({ entries }) => entries.length > 0)).toBe(true);
      for (const day of diary.days) {
        expect(day.totalSeconds).toBe(
          day.entries.reduce((sum, { durationSeconds }) => sum + durationSeconds, 0),
        );
      }
      expect(result.out).toMatch(/diary days: \d+ created, 0 updated/);
      expect(result.out).toMatch(/time entry sessions: \d+ created, 0 updated/);
      const firstDay = diary.days.at(-1)?.date ?? "";
      expect((await read(`/v1/roadmap/diary/${firstDay}`, DiaryDaySchema)).date).toBe(firstDay);

      // A bookshelf in every status, with a cover and a book read through a resource with time.
      const books = await read("/v1/roadmap/books", RoadmapBookListSchema);
      expect(new Set(books.map(({ status }) => status))).toEqual(
        new Set(["to-read", "reading", "completed"]),
      );
      expect(books.some(({ cover }) => cover?.url?.startsWith(MEDIA_PUBLIC_BASE))).toBe(true);
      expect(books.some(({ cover }) => cover === null)).toBe(true);
      expect(books.some(({ resource, readingSeconds }) => resource && readingSeconds > 0)).toBe(
        true,
      );
      expect(books.some(({ summary }) => summary !== null)).toBe(true);
      expect(result.out).toMatch(/roadmap books: \d+ created, 0 updated/);
      const linking = resources.filter(({ book }) => book !== null);
      expect(linking.length).toBeGreaterThanOrEqual(1);
      expect(linking.every(({ type }) => type === "book")).toBe(true);

      // Attended events: a single day, a multi-day one across a year boundary, attendance on them.
      const events = await read("/v1/roadmap/events", RoadmapEventListSchema);
      expect(events.some(({ startsOn, endsOn }) => startsOn === endsOn)).toBe(true);
      expect(
        events.some(({ startsOn, endsOn }) => startsOn.slice(0, 4) !== endsOn.slice(0, 4)),
      ).toBe(true);
      expect(events.some(({ attendanceSeconds }) => attendanceSeconds > 0)).toBe(true);
      expect(
        diary.days.some(({ events: on, entries }) => on.length > 0 && entries.length === 0),
      ).toBe(true);
      expect(result.out).toMatch(/roadmap events: \d+ created, 0 updated/);

      // Statistics in all three categories, with a quiet week and a daylight-saving day whose
      // session from 01:30 to 03:30 on the clock lasted one hour.
      const statistics = await read("/v1/roadmap/statistics", RoadmapStatisticsSchema);
      expect(statistics.totals.resourceSeconds).toBeGreaterThan(0);
      expect(statistics.totals.bookSeconds).toBeGreaterThan(0);
      expect(statistics.totals.eventSeconds).toBeGreaterThan(0);
      expect(statistics.weeks.some(({ totalSeconds }) => totalSeconds === 0)).toBe(true);
      expect(statistics.days.find(({ date }) => date === "2025-03-30")?.totalSeconds).toBe(3600);
      expect(statistics.days.map(({ date, totalSeconds }) => [date, totalSeconds])).toEqual(
        diary.days
          .filter(({ entries }) => entries.length > 0)
          .map(({ date, totalSeconds }) => [date, totalSeconds])
          .reverse(),
      );

      // Supporting content beside the roadmap: ideas with and without topics or a way to start,
      // followed sources with and without a link, and glossary terms.
      const ideas = await read("/v1/roadmap/project-ideas", RoadmapProjectIdeaListSchema);
      expect(ideas.length).toBeGreaterThanOrEqual(2);
      expect(ideas.some(({ topics }) => topics.length > 0)).toBe(true);
      expect(ideas.some(({ howToStart }) => howToStart === null)).toBe(true);
      const sources = await read("/v1/roadmap/followed-sources", RoadmapFollowedSourceListSchema);
      expect(sources.length).toBeGreaterThanOrEqual(2);
      expect(sources.some(({ link }) => link === null)).toBe(true);
      expect(sources.some(({ link }) => link !== null)).toBe(true);
      const terms = await read("/v1/roadmap/glossary-terms", RoadmapGlossaryTermListSchema);
      expect(terms.length).toBeGreaterThanOrEqual(2);
      expect(result.out).toMatch(/project ideas: \d+ created, 0 updated/);
      expect(result.out).toMatch(/followed sources: \d+ created, 0 updated/);
      expect(result.out).toMatch(/glossary terms: \d+ created, 0 updated/);

      const person = await read("/v1/person", PersonSchema);
      expect(person.photoId).not.toBeNull();
      expect(person.cvPdfId).not.toBeNull();
      expect(result.out).not.toContain(person.name);

      const explorations = await read("/v1/explorations", ExplorationListSchema);
      expect(new Set(explorations.map(({ status }) => status))).toEqual(
        new Set(["built", "tested", "designed"]),
      );

      const services = await read("/v1/services", ServiceListSchema);
      expect(new Set(services.flatMap(({ evidence }) => evidence.map(({ kind }) => kind)))).toEqual(
        new Set(["project", "exploration", "link"]),
      );

      const projects = await read("/v1/projects", ProjectListSchema);
      expect(projects.some(({ coverId }) => coverId !== null)).toBe(true);

      const testimonials = await read("/v1/testimonials", TestimonialListSchema);
      const photographed = testimonials.filter(({ authorPhotoId }) => authorPhotoId !== null);
      expect(photographed.length).toBeGreaterThanOrEqual(1);
      expect(photographed.length).toBeLessThan(testimonials.length);
      const caseStudies = await Promise.all(
        projects.map(async ({ slug }) =>
          backend.api().app.request(`/v1/projects/${slug}/case-study`, {}, connection()),
        ),
      );
      const studied = caseStudies.filter(({ status }) => status === 200);
      expect(studied.length).toBeGreaterThanOrEqual(1);
      CaseStudySchema.parse(await studied[0]?.json());

      const media = await read("/v1/media", MediaListSchema);
      expect(new Set(media.map(({ mediaType }) => mediaType))).toEqual(
        new Set(["image/png", "image/jpeg", "image/webp", "application/pdf"]),
      );
      for (const file of media) expect(file.byteSize).toBeLessThanOrEqual(MEDIA_LIMITS.maxBytes);

      const cv = await read("/v1/cv", CvSchema);
      expect(cv.person.id).toBe(person.id);
      expect(cv.experiences.length).toBeGreaterThanOrEqual(3);
      expect(cv.technologies.primary.core.length).toBeGreaterThanOrEqual(1);
      expect(cv.technologies.primary.aiEngineeringFocus.length).toBeGreaterThanOrEqual(1);
      expect(cv.technologies.secondary.length).toBeGreaterThanOrEqual(1);
      expect(cv.education.length).toBeGreaterThanOrEqual(2);
      expect(cv.explorations.length).toBeGreaterThanOrEqual(1);
      expect(cv.cvPdf?.url?.startsWith(MEDIA_PUBLIC_BASE)).toBe(true);
    });

    it("changes nothing when it runs again", async () => {
      await run([]);
      const before = await counts();
      const files = await backend.storedFiles();

      const again = await run([]);

      expect(again.code, again.err).toBe(0);
      expect(again.out).not.toMatch(/[1-9]\d* created/);
      expect(await counts()).toEqual(before);
      expect(await backend.storedFiles()).toEqual(files);
    });
  });

  describe("as the launch import's acceptance check", () => {
    // The checklist of packages/db/seed/README.md ("Launch import"), run against a fictional
    // source: counts, relationships and elapsed totals, with midnight splits and Prague regrouping.
    it("matches the source counts, relationships and elapsed totals, and again on a rerun", async () => {
      const folder = join(scratch, "launch");
      await writeLaunchSeed(folder);
      const { sessions } = launchSource;
      const sum = (selected: SourceSession[]) =>
        selected.reduce((total, s) => total + elapsed(s), 0);
      const bookResources = new Set(
        launchSource.resources.filter(({ type }) => type === "book").map(({ slug }) => slug),
      );

      const check = async () => {
        // 1. Counts per kind.
        const roadmap = await read("/v1/roadmap", RoadmapSchema);
        const modules = roadmap.areas.flatMap((area) => area.modules);
        const resources = modules.flatMap((module) => module.resources);
        expect(roadmap.areas).toHaveLength(launchSource.areas.length);
        expect(modules).toHaveLength(launchSource.modules.length);
        expect(resources).toHaveLength(launchSource.resources.length);
        const books = await read("/v1/roadmap/books", RoadmapBookListSchema);
        expect(books).toHaveLength(launchSource.books.length);
        const events = await read("/v1/roadmap/events", RoadmapEventListSchema);
        expect(events).toHaveLength(launchSource.events.length);

        // 2. Relationships: resource -> module -> area, book <-> resource, topics.
        for (const source of launchSource.resources) {
          const module = modules.find(({ resources: own }) =>
            own.some(({ slug }) => slug === source.slug),
          );
          expect(module?.slug, source.slug).toBe(source.module);
        }
        expect(books.map(({ slug, resource }) => [slug, resource?.slug])).toEqual([
          ["fictional-book", "fictional-reading"],
        ]);
        expect(events.map(({ slug, topics }) => [slug, topics.map((topic) => topic.slug)])).toEqual(
          [["fictional-meetup", ["fictional-topic"]]],
        );

        // 3. Elapsed totals: the sum of the source sessions, by category.
        const statistics = await read("/v1/roadmap/statistics", RoadmapStatisticsSchema);
        const onEvents = sessions.filter(({ event }) => event !== undefined);
        const onBooks = sessions.filter(({ resource }) => resource && bookResources.has(resource));
        expect(statistics.totals).toMatchObject({
          totalSeconds: sum(sessions),
          bookSeconds: sum(onBooks),
          eventSeconds: sum(onEvents),
          resourceSeconds: sum(sessions) - sum(onBooks) - sum(onEvents),
        });
        expect(statistics.days.find(({ date }) => date === "2025-03-30")?.totalSeconds).toBe(3600);
        expect(books[0]?.readingSeconds).toBe(sum(onBooks));
        expect(events[0]?.attendanceSeconds).toBe(sum(onEvents));

        // 4. Midnight splits: one time entry per Prague day a session touches.
        const diary = await read("/v1/roadmap/diary", DiarySchema);
        const entries = diary.days.flatMap((day) => day.entries);
        const expectedPieces = sessions.reduce((total, s) => total + pieces(s), 0);
        expect(expectedPieces).toBe(sessions.length + 1);
        expect(entries).toHaveLength(expectedPieces);
        expect(entries.reduce((total, { durationSeconds }) => total + durationSeconds, 0)).toBe(
          sum(sessions),
        );

        // 5. Prague regrouping: days are Prague dates, so a UTC date may hold nothing.
        const logged = diary.days.filter((day) => day.entries.length > 0);
        expect(logged.map(({ date, totalSeconds }) => [date, totalSeconds]).reverse()).toEqual([
          ["2025-02-10", 1800],
          ["2025-02-11", 2700],
          ["2025-02-13", 1800],
          ["2025-03-01", 3600],
          ["2025-03-05", 7200],
          ["2025-03-30", 3600],
        ]);
        expect(statistics.totals.activeDays).toBe(logged.length);
        expect(diary.days.find(({ date }) => date === "2025-02-10")?.notes).toBe(
          launchSource.diary[0]?.notes,
        );
      };

      const first = await run([folder]);
      expect(first.code, first.err).toBe(0);
      expect(first.out).toMatch(/time entry sessions: 5 created, 0 updated/);
      await check();
      const before = await counts();

      const again = await run([folder]);
      expect(again.code, again.err).toBe(0);
      expect(again.out).toMatch(/time entry sessions: 0 created, 5 updated/);
      await check();
      expect(await counts()).toEqual(before);
    });
  });

  describe("with an external folder", () => {
    it("loads a folder given as an absolute path", async () => {
      const folder = join(scratch, "private");
      await writeSmallSeed(folder);

      const result = await run([folder]);

      expect(result.code, result.err).toBe(0);
      expect(result.out).toMatch(/topics: 1 created, 0 updated/);
      expect(result.out).not.toContain(folder);
      expect((await read("/v1/topics", TopicListSchema)).map(({ slug }) => slug)).toEqual([
        "fictional-topic",
      ]);
    });

    it("resolves a relative path against the directory it was started from", async () => {
      await writeSmallSeed(join(scratch, "private"));

      const result = await run(["private"], scratch);

      expect(result.code, result.err).toBe(0);
      expect(result.out).toMatch(/topics: 1 created/);
    });

    it("reports an invalid seed by file and field, without its path or a stack trace", async () => {
      const folder = join(scratch, "invalid");
      await mkdir(folder);
      await writeFile(join(folder, "topics.json"), "[{ not json");

      const result = await run([folder]);

      expect(result.code).toBe(1);
      expect(result.err).toContain("topics.json");
      expect(result.err).not.toContain(scratch);
      expect(result.err).not.toMatch(/\n\s+at /);
      expect((await counts()).topics).toBe(0);
    });

    it("reports a missing folder without its path", async () => {
      const result = await run([join(scratch, "nowhere")]);

      expect(result.code).toBe(1);
      expect(result.err).not.toContain(scratch);
    });

    it("reports a file-system failure by its code, without the path it names", async () => {
      const path = join(scratch, "private", "person.json");
      const failing = {
        seed: {
          loadSeed: () =>
            Promise.reject(
              Object.assign(new Error(`EIO: i/o error, read '${path}'`), {
                code: "EIO",
                syscall: "read",
                path,
              }),
            ),
          loadSeedIntoEmpty: () => Promise.reject(new Error("Not used by this test.")),
          clearContent: () => Promise.reject(new Error("Not used by this test.")),
        },
      };
      const io = capture();

      const code = await runSeedCommand([path], failing, io.output);

      expect(code).toBe(1);
      expect(io.err()).toContain("EIO");
      expect(io.err()).not.toContain(scratch);
    });
  });

  describe("with --if-empty", () => {
    it("loads the seed into an empty profile", async () => {
      const folder = join(scratch, "private");
      await writeSmallSeed(folder);

      const result = await run(["--if-empty", folder]);

      expect(result.code, result.err).toBe(0);
      expect(result.out).toMatch(/topics: 1 created, 0 updated/);
    });

    it("skips a profile that already holds content, keeping its edits", async () => {
      const folder = join(scratch, "private");
      await writeSmallSeed(folder);
      await run([folder]);
      await backend.services.profile.updateTopic("fictional-topic", { name: "Edited by hand" });

      const result = await run(["--if-empty", folder]);

      expect(result.code, result.err).toBe(0);
      expect(result.out).toMatch(/skipped/i);
      expect(result.out).not.toMatch(/created/);
      expect((await read("/v1/topics", TopicListSchema)).map(({ name }) => name)).toContain(
        "Edited by hand",
      );
    });

    it("still refuses an invalid seed", async () => {
      const folder = join(scratch, "invalid");
      await mkdir(folder);
      await writeFile(join(folder, "topics.json"), "[{ not json");

      const result = await run(["--if-empty", folder]);

      expect(result.code).toBe(1);
      expect(result.err).toContain("topics.json");
    });
  });

  it("explains its usage on extra arguments and options", async () => {
    for (const args of [["one", "two"], ["--help"], ["-x"]]) {
      const result = await run(args);

      expect(result.code, args.join(" ")).toBe(2);
      expect(result.err).toMatch(/usage/i);
    }
  });

  it("runs as its own process against a migrated database, without an HTTP server", async () => {
    const folder = join(scratch, "private");
    await writeSmallSeed(folder);
    const entry = fileURLToPath(new URL("./seed.ts", import.meta.url));
    const { config } = backend.database;
    const env = {
      ...process.env,
      POSTGRES_HOST: config.host,
      POSTGRES_PORT: String(config.port),
      DATABASE_NAME: config.name,
      DATABASE_USER: config.user,
      DATABASE_PASSWORD: config.password,
      STORAGE_DRIVER: "local",
      STORAGE_LOCAL_ROOT: backend.storageRoot,
      STORAGE_ENVIRONMENT: "test",
      STORAGE_WORKTREE: "",
      STORAGE_PUBLIC_BASE_URL: MEDIA_PUBLIC_BASE,
      MEDIA_MAX_BYTES: String(MEDIA_LIMITS.maxBytes),
      MEDIA_MAX_IMAGE_DIMENSION: String(MEDIA_LIMITS.maxImageDimension),
      INIT_CWD: dirname(folder),
    };

    const { stdout } = await promisify(execFile)(
      process.execPath,
      ["--import", "tsx", entry, basename(folder)],
      { env },
    );

    expect(stdout).toMatch(/topics: 1 created/);
    expect((await read("/v1/topics", TopicListSchema)).map(({ slug }) => slug)).toEqual([
      "fictional-topic",
    ]);
  });
});
