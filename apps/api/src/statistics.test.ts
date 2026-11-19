import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { DiarySchema, RoadmapStatisticsSchema, type RoadmapStatistics } from "@sebela/contracts";

import { bearer, connection, json, openTestBackend, type TestBackend } from "./test-support.js";

/** A small fictional roadmap: one area, two modules, a text resource and a book resource. */
const area = { slug: "basics", name: "Basics", weight: 100, position: 0 };
const agents = { slug: "agents", area: "basics", name: "Agents", position: 0 };
const retrieval = { slug: "retrieval", area: "basics", name: "Retrieval", position: 1 };
const agentsTopic = { slug: "fictional-agents", name: "Fictional agents", position: 0 };
const evalsTopic = { slug: "fictional-evals", name: "Fictional evals", position: 1 };
const book = { slug: "fictional-book", title: "A Fictional Book" };
const guide = {
  slug: "agents-guide",
  module: "agents",
  name: "A fictional agents guide",
  type: "link",
  position: 0,
  topics: ["fictional-agents", "fictional-evals"],
};
const reading = {
  slug: "reading-the-book",
  module: "agents",
  name: "Reading the fictional book",
  type: "book",
  position: 1,
  book: "fictional-book",
  topics: ["fictional-agents"],
};
const summit = {
  slug: "fictional-summit",
  name: "Fictional Summit",
  kind: "conference",
  startsOn: "2026-03-02",
  endsOn: "2026-03-03",
  topics: ["fictional-agents", "fictional-evals"],
};

const split = (resource: number, book: number, event: number) => ({
  totalSeconds: resource + book + event,
  resourceSeconds: resource,
  bookSeconds: book,
  eventSeconds: event,
});

describe("the learning statistics API", () => {
  let backend: TestBackend;
  let auth: Record<string, string>;

  const request = (path: string, method = "GET", init: RequestInit = {}) =>
    backend.api().app.request(path, { method, ...init }, connection());
  const post = (path: string, body: object) => request(path, "POST", json(body, auth));

  const statistics = async (): Promise<RoadmapStatistics> => {
    const response = await request("/v1/roadmap/statistics");
    expect(response.status).toBe(200);
    return RoadmapStatisticsSchema.parse(await response.json());
  };

  beforeAll(async () => {
    backend = await openTestBackend();
    auth = bearer((await backend.services.apiKeys.createKey("statistics routes")).key);
    for (const [path, body] of [
      ["/v1/topics", agentsTopic],
      ["/v1/topics", evalsTopic],
      ["/v1/roadmap/areas", area],
      ["/v1/roadmap/modules", agents],
      ["/v1/roadmap/modules", retrieval],
      ["/v1/roadmap/books", book],
      ["/v1/roadmap/resources", guide],
      ["/v1/roadmap/resources", reading],
      ["/v1/roadmap/events", summit],
    ] as const) {
      expect((await post(path, body)).status, `${path} ${body.slug}`).toBe(201);
    }
  });

  afterAll(async () => {
    await backend.close();
  });

  beforeEach(async () => {
    const { roadmap } = backend.services;
    for (const day of (await roadmap.getDiary()).days) {
      for (const entry of day.entries) await roadmap.deleteTimeEntry(entry.id);
    }
    await roadmap.updateResource(guide.slug, { module: "agents" });
  });

  it("reads empty statistics publicly as zero totals and empty lists", async () => {
    expect(await statistics()).toEqual({
      totals: { ...split(0, 0, 0), activeDays: 0 },
      days: [],
      weeks: [],
      months: [],
      areas: [],
      resources: [],
      events: [],
    });
  });

  it("counts each logged session once by category, Prague day, week and module", async () => {
    // Sunday 1 March 23:30 to Monday 00:30 Prague: split at midnight into two days and weeks.
    for (const body of [
      {
        resource: guide.slug,
        startedAt: "2026-03-01T23:30:00+01:00",
        endedAt: "2026-03-02T00:30:00+01:00",
      },
      {
        resource: reading.slug,
        startedAt: "2026-03-02T09:00:00+01:00",
        endedAt: "2026-03-02T09:45:00+01:00",
      },
      {
        event: summit.slug,
        startedAt: "2026-03-03T10:00:00+01:00",
        endedAt: "2026-03-03T12:30:00+01:00",
      },
    ]) {
      expect((await post("/v1/roadmap/time-entries", body)).status).toBe(201);
    }

    const read = await statistics();

    expect(read.totals).toEqual({ ...split(3600, 2700, 9000), activeDays: 3 });
    expect(read.days).toEqual([
      { date: "2026-03-01", ...split(1800, 0, 0) },
      { date: "2026-03-02", ...split(1800, 2700, 0) },
      { date: "2026-03-03", ...split(0, 0, 9000) },
    ]);
    expect(read.weeks).toEqual([
      { startsOn: "2026-02-23", ...split(1800, 0, 0) },
      { startsOn: "2026-03-02", ...split(1800, 2700, 9000) },
    ]);
    expect(read.months).toEqual([{ month: "2026-03", ...split(3600, 2700, 9000) }]);
    expect(read.areas).toEqual([
      {
        slug: "basics",
        name: "Basics",
        totalSeconds: 6300,
        resourceSeconds: 3600,
        bookSeconds: 2700,
        modules: [
          {
            slug: "agents",
            name: "Agents",
            totalSeconds: 6300,
            resourceSeconds: 3600,
            bookSeconds: 2700,
          },
        ],
      },
    ]);
    expect(
      read.resources.map(({ slug, category, totalSeconds }) => [slug, category, totalSeconds]),
    ).toEqual([
      ["agents-guide", "resource", 3600],
      ["reading-the-book", "book", 2700],
    ]);
    expect(read.events.map(({ slug, totalSeconds }) => [slug, totalSeconds])).toEqual([
      ["fictional-summit", 9000],
    ]);

    const diaryResponse = await request("/v1/roadmap/diary");
    const diary = DiarySchema.parse(await diaryResponse.json());
    expect(read.days.map(({ date, totalSeconds }) => ({ date, totalSeconds }))).toEqual(
      diary.days
        .filter((day) => day.entries.length > 0)
        .map(({ date, totalSeconds }) => ({ date, totalSeconds }))
        .reverse(),
    );
  });

  it("moves a resource's time with it to its new module, losing and repeating nothing", async () => {
    expect(
      (
        await post("/v1/roadmap/time-entries", {
          resource: guide.slug,
          startedAt: "2026-03-02T09:00:00+01:00",
          endedAt: "2026-03-02T10:00:00+01:00",
        })
      ).status,
    ).toBe(201);
    const moved = await request(
      `/v1/roadmap/resources/${guide.slug}`,
      "PATCH",
      json({ module: "retrieval" }, auth),
    );
    expect(moved.status).toBe(200);

    const [basics] = (await statistics()).areas;
    expect(basics?.totalSeconds).toBe(3600);
    expect(basics?.modules.map(({ slug, totalSeconds }) => [slug, totalSeconds])).toEqual([
      ["retrieval", 3600],
    ]);
  });

  it("offers no write to the statistics", async () => {
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      const response = await request("/v1/roadmap/statistics", method, json({}, auth));
      expect(response.status, method).toBe(404);
    }
  });
});
