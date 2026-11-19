import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  RoadmapBookCreateSchema,
  RoadmapStatisticsSchema,
  type RoadmapResourceCreate,
} from "@sebela/contracts";
import { createPersistence, readDatabaseConfig, type Persistence } from "@sebela/db";
import { createTemporaryDatabase, type TemporaryDatabase } from "@sebela/db/testing";

import { createRoadmapService, type RoadmapService } from "./index.js";

/** A fictional resource in the one module, without optional fields or topics. */
const resource = (
  slug: string,
  type: RoadmapResourceCreate["type"],
  book: string | null = null,
): RoadmapResourceCreate => ({
  slug,
  module: "prompting",
  name: `Resource ${slug}`,
  description: null,
  type,
  status: "in-progress",
  estimatedMinutes: null,
  startedAt: null,
  finishedAt: null,
  link: null,
  position: 0,
  book,
  topics: [],
});

const split = (resource: number, book: number, event: number) => ({
  totalSeconds: resource + book + event,
  resourceSeconds: resource,
  bookSeconds: book,
  eventSeconds: event,
});

describe("learning statistics", () => {
  let database: TemporaryDatabase;
  let persistence: Persistence;
  let roadmap: RoadmapService;

  beforeAll(async () => {
    database = await createTemporaryDatabase(readDatabaseConfig(process.env));
    persistence = createPersistence(database.config);
    roadmap = createRoadmapService(persistence.roadmap);
    await roadmap.createArea({
      slug: "foundations",
      name: "Foundations",
      description: null,
      weight: 40,
      position: 0,
    });
    await roadmap.createModule({
      slug: "prompting",
      area: "foundations",
      name: "Prompting",
      description: null,
      position: 0,
    });
    await roadmap.createBook(
      RoadmapBookCreateSchema.parse({ slug: "fictional-book", title: "A Fictional Book" }),
    );
    await roadmap.createResource(resource("prompt-guide", "text"));
    await roadmap.createResource(resource("reading-book", "book", "fictional-book"));
    await roadmap.createEvent({
      slug: "fictional-summit",
      name: "Fictional Summit",
      kind: "conference",
      organizer: null,
      startsOn: "2026-03-02",
      endsOn: "2026-03-03",
      place: null,
      online: true,
      link: null,
      takeaways: null,
      topics: [],
    });
  });

  afterAll(async () => {
    await persistence.close();
    await database.drop();
  });

  beforeEach(async () => {
    for (const day of await persistence.roadmap.loadDiary()) {
      for (const entry of day.entries) await persistence.roadmap.deleteTimeEntry(entry.id);
    }
  });

  it("returns zero totals and empty lists as a contract record for an empty diary", async () => {
    const statistics = await roadmap.getStatistics();
    expect(RoadmapStatisticsSchema.parse(statistics)).toEqual(statistics);
    expect(statistics).toEqual({
      totals: { ...split(0, 0, 0), activeDays: 0 },
      days: [],
      weeks: [],
      months: [],
      areas: [],
      resources: [],
      events: [],
    });
  });

  it("splits a session across Prague midnight and reconciles with the diary days", async () => {
    // Sunday 1 March 23:30 to Monday 2 March 00:30 Prague: half an hour in each day and week.
    await roadmap.createTimeEntry({
      resource: "prompt-guide",
      startedAt: "2026-03-01T23:30:00+01:00",
      endedAt: "2026-03-02T00:30:00+01:00",
    });
    await roadmap.createTimeEntry({
      resource: "reading-book",
      startedAt: "2026-03-02T09:00:00+01:00",
      endedAt: "2026-03-02T09:40:00+01:00",
    });
    await roadmap.createTimeEntry({
      event: "fictional-summit",
      startedAt: "2026-03-02T10:00:00+01:00",
      endedAt: "2026-03-02T12:00:00+01:00",
    });

    const statistics = await roadmap.getStatistics();

    expect(RoadmapStatisticsSchema.parse(statistics)).toEqual(statistics);
    expect(statistics.totals).toEqual({ ...split(3600, 2400, 7200), activeDays: 2 });
    expect(statistics.weeks).toEqual([
      { startsOn: "2026-02-23", ...split(1800, 0, 0) },
      { startsOn: "2026-03-02", ...split(1800, 2400, 7200) },
    ]);
    expect(statistics.resources).toEqual([
      expect.objectContaining({ slug: "prompt-guide", category: "resource", totalSeconds: 3600 }),
      expect.objectContaining({
        slug: "reading-book",
        category: "book",
        book: { slug: "fictional-book", title: "A Fictional Book" },
        totalSeconds: 2400,
      }),
    ]);
    expect(statistics.events).toEqual([
      {
        slug: "fictional-summit",
        name: "Fictional Summit",
        kind: "conference",
        startsOn: "2026-03-02",
        endsOn: "2026-03-03",
        totalSeconds: 7200,
      },
    ]);

    const diary = await roadmap.getDiary();
    const diaryDays = diary.days
      .filter((day) => day.entries.length > 0)
      .map(({ date, totalSeconds }) => ({ date, totalSeconds }))
      .reverse();
    expect(statistics.days.map(({ date, totalSeconds }) => ({ date, totalSeconds }))).toEqual(
      diaryDays,
    );
  });
});
