import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { readDatabaseConfig } from "../../config.js";
import { openConnection, type Connection } from "../../connection.js";
import { createTemporaryDatabase, type TemporaryDatabase } from "../../testing.js";
import { createProfilePersistence } from "../profile/index.js";
import {
  createRoadmapPersistence,
  type LearningTimeSplitRecord,
  type RoadmapEventFields,
  type RoadmapEventRelations,
  type RoadmapPersistence,
  type RoadmapResourceFields,
  type RoadmapResourceRelations,
  type TimeEntryPiece,
  type TimeEntryTarget,
} from "./index.js";

type ResourceInput = RoadmapResourceFields & RoadmapResourceRelations & { slug: string };
type EventInput = RoadmapEventFields & RoadmapEventRelations & { slug: string };

/** A piece of a diary day; the instants are UTC, the expected seconds worked out by hand. */
const piece = (date: string, startedAt: string, endedAt: string): TimeEntryPiece => ({
  date,
  startedAt: new Date(startedAt),
  endedAt: new Date(endedAt),
});

const split = (resource: number, book: number, event: number): LearningTimeSplitRecord => ({
  totalSeconds: resource + book + event,
  resourceSeconds: resource,
  bookSeconds: book,
  eventSeconds: event,
});

/** A fictional resource without optional fields. */
const resource = (
  slug: string,
  module: string,
  type: RoadmapResourceFields["type"],
  topics: string[],
  book: string | null = null,
): ResourceInput => ({
  slug,
  module,
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
  topics,
});

/** A fictional event with two topics, so a topic join would double its time. */
const event = (slug: string, startsOn: string, endsOn: string): EventInput => ({
  slug,
  name: `Event ${slug}`,
  kind: "conference",
  organizer: null,
  startsOn,
  endsOn,
  place: null,
  online: true,
  link: null,
  takeaways: null,
  topics: ["agents", "evals"],
});

const promptGuide = { slug: "prompt-guide", name: "Resource prompt-guide" };
const prompting = { slug: "prompting", name: "Prompting" };
const practice = { slug: "agents-in-practice", name: "Agents in practice" };
const foundations = { slug: "foundations", name: "Foundations" };
const engineering = { slug: "engineering", name: "Engineering" };

describe("learning statistics persistence", () => {
  let database: TemporaryDatabase;
  let connection: Connection;
  let roadmap: RoadmapPersistence;

  /** Logs the pieces and returns the ids of the stored entries. */
  async function log(target: TimeEntryTarget, pieces: TimeEntryPiece[]) {
    const result = await roadmap.createTimeEntries(target, pieces);
    if (!result.ok) throw new Error(`The fixture was refused: ${result.reason}`);
    return result.entries.map((entry) => entry.id);
  }

  /** The time of each diary day as the diary itself reports it, oldest first. */
  async function diaryDayTotals() {
    const days = await roadmap.loadDiary();
    return days
      .filter((day) => day.entries.length > 0)
      .map((day) => ({
        date: day.date,
        totalSeconds: day.entries.reduce(
          (sum, entry) => sum + (entry.endedAt.getTime() - entry.startedAt.getTime()) / 1000,
          0,
        ),
      }))
      .reverse();
  }

  beforeAll(async () => {
    database = await createTemporaryDatabase(readDatabaseConfig(process.env));
    connection = openConnection(database.config);
    roadmap = createRoadmapPersistence(connection.db);
    const profile = createProfilePersistence(connection.db);
    for (const [position, slug] of ["agents", "rag", "evals"].entries()) {
      await profile.createTopic({ slug, name: `Topic ${slug}`, position });
    }
    for (const [position, area] of [foundations, engineering].entries()) {
      await roadmap.createRoadmapArea({ ...area, description: null, weight: 50, position });
    }
    const modules = [
      { ...prompting, area: foundations.slug },
      { slug: "retrieval", name: "Retrieval", area: foundations.slug },
      { ...practice, area: engineering.slug },
    ];
    for (const [position, module] of modules.entries()) {
      await roadmap.createRoadmapModule({
        ...module,
        description: null,
        position,
      });
    }
  });

  afterAll(async () => {
    await connection.close();
    await database.drop();
  });

  beforeEach(async () => {
    const table = (name: string) => sql`${sql.identifier("ai_roadmap")}.${sql.identifier(name)}`;
    await connection.db.execute(
      sql`TRUNCATE ${table("time_entries")}, ${table("diary_entries")}, ${table("resource_topics")}, ${table("resources")}, ${table("books")}, ${table("event_topics")}, ${table("events")}`,
    );
    await roadmap.createRoadmapBook({
      slug: "fictional-book",
      title: "A Fictional Book",
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
    for (const input of [
      resource("prompt-guide", "prompting", "text", ["agents", "rag"]),
      resource("reading-book", "prompting", "book", ["rag", "evals"], "fictional-book"),
      resource("agent-video", "agents-in-practice", "video", ["agents"]),
    ]) {
      const created = await roadmap.createRoadmapResource(input);
      if (!created.ok) throw new Error(`The fixture was refused: ${created.reason}`);
    }
  });

  it("gives zero totals and empty lists for an empty diary", async () => {
    await roadmap.createRoadmapEvent(event("fictional-summit", "2026-03-02", "2026-03-04"));
    await roadmap.writeDiaryNotes("2026-03-02", "A day with notes but no logged time.");

    await expect(roadmap.loadLearningStatistics()).resolves.toEqual({
      totals: { ...split(0, 0, 0), activeDays: 0 },
      days: [],
      weeks: [],
      months: [],
      areas: [],
      resources: [],
      events: [],
    });
  });

  it("counts every entry once in its category, period and breakdown", async () => {
    await roadmap.createRoadmapEvent(event("fictional-summit", "2026-03-02", "2026-03-04"));
    // Sunday 1 March 23:30 to Monday 00:30 Prague (UTC+1), split at midnight into two weeks.
    await log({ resource: "prompt-guide" }, [
      piece("2026-03-01", "2026-03-01T22:30:00Z", "2026-03-01T23:00:00Z"),
      piece("2026-03-02", "2026-03-01T23:00:00Z", "2026-03-01T23:30:00Z"),
    ]);
    await log({ resource: "reading-book" }, [
      piece("2026-03-02", "2026-03-02T08:00:00Z", "2026-03-02T09:00:00Z"),
    ]);
    await log({ event: "fictional-summit" }, [
      piece("2026-03-03", "2026-03-03T08:00:00Z", "2026-03-03T10:00:00Z"),
    ]);
    await log({ resource: "agent-video" }, [
      piece("2026-03-04", "2026-03-04T17:00:00Z", "2026-03-04T17:45:00Z"),
    ]);

    const statistics = await roadmap.loadLearningStatistics();

    expect(statistics).toEqual({
      totals: { ...split(6300, 3600, 7200), activeDays: 4 },
      days: [
        { date: "2026-03-01", ...split(1800, 0, 0) },
        { date: "2026-03-02", ...split(1800, 3600, 0) },
        { date: "2026-03-03", ...split(0, 0, 7200) },
        { date: "2026-03-04", ...split(2700, 0, 0) },
      ],
      weeks: [
        { startsOn: "2026-02-23", ...split(1800, 0, 0) },
        { startsOn: "2026-03-02", ...split(4500, 3600, 7200) },
      ],
      months: [{ month: "2026-03", ...split(6300, 3600, 7200) }],
      areas: [
        {
          ...foundations,
          totalSeconds: 7200,
          resourceSeconds: 3600,
          bookSeconds: 3600,
          modules: [{ ...prompting, totalSeconds: 7200, resourceSeconds: 3600, bookSeconds: 3600 }],
        },
        {
          ...engineering,
          totalSeconds: 2700,
          resourceSeconds: 2700,
          bookSeconds: 0,
          modules: [{ ...practice, totalSeconds: 2700, resourceSeconds: 2700, bookSeconds: 0 }],
        },
      ],
      resources: [
        {
          ...promptGuide,
          type: "text",
          module: prompting,
          area: foundations,
          book: null,
          totalSeconds: 3600,
        },
        {
          slug: "reading-book",
          name: "Resource reading-book",
          type: "book",
          module: prompting,
          area: foundations,
          book: { slug: "fictional-book", title: "A Fictional Book" },
          totalSeconds: 3600,
        },
        {
          slug: "agent-video",
          name: "Resource agent-video",
          type: "video",
          module: practice,
          area: engineering,
          book: null,
          totalSeconds: 2700,
        },
      ],
      events: [
        {
          slug: "fictional-summit",
          name: "Event fictional-summit",
          kind: "conference",
          startsOn: "2026-03-02",
          endsOn: "2026-03-04",
          totalSeconds: 7200,
        },
      ],
    });
    expect(statistics.days.map(({ date, totalSeconds }) => ({ date, totalSeconds }))).toEqual(
      await diaryDayTotals(),
    );
  });

  it("keeps the actual length of daylight-saving days and zero-fills the weeks and months between", async () => {
    await roadmap.createRoadmapEvent(event("autumn-retreat", "2026-10-24", "2026-10-26"));
    // Prague 00:00 to 04:00 on 29 March: the clocks skip 02:00 to 03:00, so three hours.
    await log({ resource: "reading-book" }, [
      piece("2026-03-29", "2026-03-28T23:00:00Z", "2026-03-29T02:00:00Z"),
    ]);
    // The whole of 25 October: the clocks repeat 02:00 to 03:00, so twenty-five hours.
    await log({ event: "autumn-retreat" }, [
      piece("2026-10-25", "2026-10-24T22:00:00Z", "2026-10-25T23:00:00Z"),
    ]);

    const statistics = await roadmap.loadLearningStatistics();

    expect(statistics.totals).toEqual({ ...split(0, 10800, 90000), activeDays: 2 });
    expect(statistics.days).toEqual([
      { date: "2026-03-29", ...split(0, 10800, 0) },
      { date: "2026-10-25", ...split(0, 0, 90000) },
    ]);
    // Monday 23 March to Monday 19 October is 210 days: thirty weeks between, thirty-one in all.
    expect(statistics.weeks).toHaveLength(31);
    expect(statistics.weeks[0]).toEqual({ startsOn: "2026-03-23", ...split(0, 10800, 0) });
    expect(statistics.weeks[1]).toEqual({ startsOn: "2026-03-30", ...split(0, 0, 0) });
    expect(statistics.weeks[30]).toEqual({ startsOn: "2026-10-19", ...split(0, 0, 90000) });
    expect(statistics.weeks.slice(1, 30).every((week) => week.totalSeconds === 0)).toBe(true);
    expect(statistics.months).toEqual([
      { month: "2026-03", ...split(0, 10800, 0) },
      ...["04", "05", "06", "07", "08", "09"].map((month) => ({
        month: `2026-${month}`,
        ...split(0, 0, 0),
      })),
      { month: "2026-10", ...split(0, 0, 90000) },
    ]);
    expect(statistics.areas).toEqual([
      {
        ...foundations,
        totalSeconds: 10800,
        resourceSeconds: 0,
        bookSeconds: 10800,
        modules: [{ ...prompting, totalSeconds: 10800, resourceSeconds: 0, bookSeconds: 10800 }],
      },
    ]);
    expect(statistics.days.map(({ date, totalSeconds }) => ({ date, totalSeconds }))).toEqual(
      await diaryDayTotals(),
    );
  });

  it("puts a session across the new year into both years and the week that spans them", async () => {
    // Thursday 31 December 23:00 to Friday 1 January 01:00 Prague (UTC+1).
    await log({ resource: "prompt-guide" }, [
      piece("2026-12-31", "2026-12-31T22:00:00Z", "2026-12-31T23:00:00Z"),
      piece("2027-01-01", "2026-12-31T23:00:00Z", "2027-01-01T00:00:00Z"),
    ]);

    const statistics = await roadmap.loadLearningStatistics();

    expect(statistics.days).toEqual([
      { date: "2026-12-31", ...split(3600, 0, 0) },
      { date: "2027-01-01", ...split(3600, 0, 0) },
    ]);
    expect(statistics.weeks).toEqual([{ startsOn: "2026-12-28", ...split(7200, 0, 0) }]);
    expect(statistics.months).toEqual([
      { month: "2026-12", ...split(3600, 0, 0) },
      { month: "2027-01", ...split(3600, 0, 0) },
    ]);
  });

  it("follows a resource into its new module and a changed type into its new category", async () => {
    await log({ resource: "prompt-guide" }, [
      piece("2026-03-02", "2026-03-02T08:00:00Z", "2026-03-02T09:00:00Z"),
    ]);
    await log({ resource: "agent-video" }, [
      piece("2026-03-02", "2026-03-02T10:00:00Z", "2026-03-02T10:45:00Z"),
    ]);

    await roadmap.updateRoadmapResource("prompt-guide", { module: "agents-in-practice" });
    await roadmap.updateRoadmapResource("agent-video", { type: "book" });

    const statistics = await roadmap.loadLearningStatistics();

    expect(statistics.totals).toEqual({ ...split(3600, 2700, 0), activeDays: 1 });
    expect(statistics.areas).toEqual([
      {
        ...engineering,
        totalSeconds: 6300,
        resourceSeconds: 3600,
        bookSeconds: 2700,
        modules: [{ ...practice, totalSeconds: 6300, resourceSeconds: 3600, bookSeconds: 2700 }],
      },
    ]);
    expect(statistics.resources).toEqual([
      {
        ...promptGuide,
        type: "text",
        module: practice,
        area: engineering,
        book: null,
        totalSeconds: 3600,
      },
      {
        slug: "agent-video",
        name: "Resource agent-video",
        type: "book",
        module: practice,
        area: engineering,
        book: null,
        totalSeconds: 2700,
      },
    ]);
  });

  it("reflects edited and deleted entries, dropping a day left without time", async () => {
    const [edited] = await log({ resource: "prompt-guide" }, [
      piece("2026-03-02", "2026-03-02T08:00:00Z", "2026-03-02T09:00:00Z"),
    ]);
    const [deleted] = await log({ resource: "agent-video" }, [
      piece("2026-03-03", "2026-03-03T08:00:00Z", "2026-03-03T09:00:00Z"),
    ]);
    await roadmap.writeDiaryNotes("2026-03-03", "Notes outlive the deleted time.");

    const replaced = await roadmap.replaceTimeEntry(String(edited), () => ({
      target: { resource: "reading-book" },
      pieces: [piece("2026-03-05", "2026-03-05T08:00:00Z", "2026-03-05T08:20:00Z")],
    }));
    expect(replaced.ok).toBe(true);
    await expect(roadmap.deleteTimeEntry(String(deleted))).resolves.toEqual({
      ok: true,
      date: "2026-03-03",
    });

    const statistics = await roadmap.loadLearningStatistics();

    expect(statistics.totals).toEqual({ ...split(0, 1200, 0), activeDays: 1 });
    expect(statistics.days).toEqual([{ date: "2026-03-05", ...split(0, 1200, 0) }]);
    expect(statistics.weeks).toEqual([{ startsOn: "2026-03-02", ...split(0, 1200, 0) }]);
    expect(statistics.resources.map((record) => [record.slug, record.totalSeconds])).toEqual([
      ["reading-book", 1200],
    ]);
    expect(statistics.areas).toEqual([
      {
        ...foundations,
        totalSeconds: 1200,
        resourceSeconds: 0,
        bookSeconds: 1200,
        modules: [{ ...prompting, totalSeconds: 1200, resourceSeconds: 0, bookSeconds: 1200 }],
      },
    ]);
    expect(statistics.days.map(({ date, totalSeconds }) => ({ date, totalSeconds }))).toEqual(
      await diaryDayTotals(),
    );
  });

  it("sums the three categories to the total in every period", async () => {
    await roadmap.createRoadmapEvent(event("fictional-summit", "2026-03-02", "2026-03-04"));
    await log({ resource: "prompt-guide" }, [
      piece("2026-03-02", "2026-03-02T07:00:00Z", "2026-03-02T07:10:00Z"),
    ]);
    await log({ resource: "reading-book" }, [
      piece("2026-03-02", "2026-03-02T07:10:00Z", "2026-03-02T07:35:00Z"),
    ]);
    await log({ event: "fictional-summit" }, [
      piece("2026-03-02", "2026-03-02T07:35:00Z", "2026-03-02T08:00:00Z"),
    ]);

    const statistics = await roadmap.loadLearningStatistics();

    for (const period of [
      statistics.totals,
      ...statistics.days,
      ...statistics.weeks,
      ...statistics.months,
    ]) {
      expect(period.resourceSeconds + period.bookSeconds + period.eventSeconds).toBe(
        period.totalSeconds,
      );
    }
    expect(statistics.totals).toEqual({ ...split(600, 1500, 1500), activeDays: 1 });
  });
});
