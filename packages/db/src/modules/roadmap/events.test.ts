import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { readDatabaseConfig } from "../../config.js";
import { openConnection, type Connection } from "../../connection.js";
import { createTemporaryDatabase, type TemporaryDatabase } from "../../testing.js";
import { createProfilePersistence } from "../profile/index.js";
import {
  createRoadmapPersistence,
  type RoadmapEventFields,
  type RoadmapPersistence,
  type TimeEntryPiece,
} from "./index.js";

/** A piece in a fictional diary day; dates before 2026-03-29 are UTC+01:00 in Prague. */
const piece = (date: string, startedAt: string, endedAt: string): TimeEntryPiece => ({
  date,
  startedAt: new Date(startedAt),
  endedAt: new Date(endedAt),
});

/** A fictional three-day conference. */
const summit: RoadmapEventFields & { slug: string; topics: string[] } = {
  slug: "fictional-ai-summit",
  name: "Fictional AI Summit",
  kind: "conference",
  organizer: "Example Community",
  startsOn: "2026-03-02",
  endsOn: "2026-03-04",
  place: "Example Hall",
  online: false,
  link: "https://example.com/summit",
  takeaways: "A **fictional** note.",
  topics: ["agents", "evals"],
};

/** A fictional single-day online meetup. */
const meetup = {
  ...summit,
  slug: "fictional-meetup",
  name: "Fictional Meetup",
  kind: "meetup" as const,
  organizer: null,
  startsOn: "2026-03-10",
  endsOn: "2026-03-10",
  place: null,
  online: true,
  link: null,
  takeaways: null,
  topics: [],
};

/** One hour of the summit's first morning, 09:00 to 10:00 Prague time. */
const firstMorning = [piece("2026-03-02", "2026-03-02T08:00:00Z", "2026-03-02T09:00:00Z")];

describe("roadmap event persistence", () => {
  let database: TemporaryDatabase;
  let connection: Connection;
  let roadmap: RoadmapPersistence;

  /** Counts every stored row of a roadmap table. */
  async function count(table: "events" | "event_topics" | "time_entries" | "diary_entries") {
    const result = await connection.db.execute<{ count: string }>(
      sql`SELECT count(*) AS count FROM ${sql.identifier("ai_roadmap")}.${sql.identifier(table)}`,
    );
    return Number(result.rows[0]?.count);
  }

  beforeAll(async () => {
    database = await createTemporaryDatabase(readDatabaseConfig(process.env));
    connection = openConnection(database.config);
    roadmap = createRoadmapPersistence(connection.db);
    const profile = createProfilePersistence(connection.db);
    for (const [position, slug] of ["agents", "evals"].entries()) {
      await profile.createTopic({ slug, name: slug, position });
    }
    await roadmap.createRoadmapArea({
      slug: "foundations",
      name: "Foundations",
      description: null,
      weight: 50,
      position: 0,
    });
    await roadmap.createRoadmapModule({
      slug: "prompting-basics",
      area: "foundations",
      name: "Prompting basics",
      description: null,
      position: 0,
    });
    await roadmap.createRoadmapResource({
      slug: "prompting-notes",
      module: "prompting-basics",
      name: "Prompting notes",
      description: null,
      type: "text",
      status: "in-progress",
      estimatedMinutes: null,
      startedAt: null,
      finishedAt: null,
      link: null,
      position: 0,
      book: null,
      topics: [],
    });
  });

  afterAll(async () => {
    await connection.close();
    await database.drop();
  });

  beforeEach(async () => {
    const table = (name: string) => sql`${sql.identifier("ai_roadmap")}.${sql.identifier(name)}`;
    await connection.db.execute(
      sql`TRUNCATE ${table("time_entries")}, ${table("diary_entries")}, ${table("event_topics")}, ${table("events")}`,
    );
  });

  describe("events", () => {
    it("creates, reads and lists events newest first with their topics", async () => {
      const created = await roadmap.createRoadmapEvent(summit);
      expect(created).toMatchObject({
        ok: true,
        event: {
          slug: "fictional-ai-summit",
          kind: "conference",
          startsOn: "2026-03-02",
          endsOn: "2026-03-04",
          attendanceSeconds: 0,
          topics: [{ slug: "agents" }, { slug: "evals" }],
        },
      });
      await roadmap.createRoadmapEvent(meetup);
      await roadmap.createRoadmapEvent({
        ...meetup,
        slug: "fictional-workshop",
        kind: "workshop",
        endsOn: "2026-03-11",
      });

      const listed = await roadmap.listRoadmapEvents();
      expect(listed.map((event) => event.slug)).toEqual([
        "fictional-workshop",
        "fictional-meetup",
        "fictional-ai-summit",
      ]);
      await expect(roadmap.findRoadmapEvent("fictional-meetup")).resolves.toMatchObject({
        online: true,
        place: null,
        topics: [],
      });
      await expect(roadmap.findRoadmapEvent("missing")).resolves.toBeNull();
    });

    it("refuses a taken slug, a reversed period and unknown or repeated topics", async () => {
      await roadmap.createRoadmapEvent(summit);
      await expect(roadmap.createRoadmapEvent(summit)).resolves.toEqual({
        ok: false,
        reason: "conflict",
      });
      await expect(
        roadmap.createRoadmapEvent({ ...meetup, endsOn: "2026-03-09" }),
      ).resolves.toEqual({ ok: false, reason: "invalid_period" });
      await expect(
        roadmap.createRoadmapEvent({ ...meetup, topics: ["agents", "missing"] }),
      ).resolves.toEqual({ ok: false, reason: "unknown_topics", slugs: ["missing"] });
      await expect(
        roadmap.createRoadmapEvent({ ...meetup, topics: ["agents", "agents"] }),
      ).resolves.toEqual({ ok: false, reason: "repeated_topics" });
      expect(await count("events")).toBe(1);
    });

    it("updates the given fields, replaces topics and refuses a reversed period", async () => {
      await roadmap.createRoadmapEvent(summit);
      const updated = await roadmap.updateRoadmapEvent(summit.slug, {
        takeaways: null,
        endsOn: "2026-03-05",
        topics: ["evals"],
      });
      expect(updated).toMatchObject({
        ok: true,
        event: {
          takeaways: null,
          endsOn: "2026-03-05",
          name: summit.name,
          topics: [{ slug: "evals" }],
        },
      });
      await expect(
        roadmap.updateRoadmapEvent(summit.slug, { startsOn: "2026-03-06" }),
      ).resolves.toEqual({ ok: false, reason: "invalid_period" });
      await expect(roadmap.updateRoadmapEvent("missing", { name: "x" })).resolves.toEqual({
        ok: false,
        reason: "not_found",
      });
      expect(await count("event_topics")).toBe(1);
    });

    it("deletes an event without attendance and its topic links", async () => {
      await roadmap.createRoadmapEvent(summit);
      await expect(roadmap.deleteRoadmapEvent(summit.slug)).resolves.toEqual({ ok: true });
      await expect(roadmap.deleteRoadmapEvent(summit.slug)).resolves.toEqual({
        ok: false,
        reason: "not_found",
      });
      expect(await count("event_topics")).toBe(0);
    });
  });

  describe("attendance", () => {
    beforeEach(async () => {
      await roadmap.createRoadmapEvent(summit);
    });

    it("logs attendance on the event's days and derives its time", async () => {
      const result = await roadmap.createTimeEntries({ event: summit.slug }, [
        ...firstMorning,
        piece("2026-03-04", "2026-03-04T12:00:00Z", "2026-03-04T12:30:00Z"),
      ]);
      expect(result).toMatchObject({
        ok: true,
        entries: [
          {
            date: "2026-03-02",
            resource: null,
            event: {
              slug: summit.slug,
              name: summit.name,
              kind: "conference",
              startsOn: "2026-03-02",
              endsOn: "2026-03-04",
              link: summit.link,
            },
          },
          { date: "2026-03-04" },
        ],
      });
      await expect(roadmap.findRoadmapEvent(summit.slug)).resolves.toMatchObject({
        attendanceSeconds: 5400,
      });
    });

    it("refuses an unknown event and a day outside the event", async () => {
      await expect(roadmap.createTimeEntries({ event: "missing" }, firstMorning)).resolves.toEqual({
        ok: false,
        reason: "unknown_event",
      });
      await expect(
        roadmap.createTimeEntries({ event: summit.slug }, [
          piece("2026-03-04", "2026-03-04T22:30:00Z", "2026-03-04T23:00:00Z"),
          piece("2026-03-05", "2026-03-04T23:00:00Z", "2026-03-04T23:30:00Z"),
        ]),
      ).resolves.toEqual({
        ok: false,
        reason: "outside_event",
        startsOn: "2026-03-02",
        endsOn: "2026-03-04",
      });
      expect(await count("time_entries")).toBe(0);
    });

    it("refuses attendance overlapping study time and the reverse", async () => {
      await roadmap.createTimeEntries({ event: summit.slug }, firstMorning);
      const overlapping = [piece("2026-03-02", "2026-03-02T08:30:00Z", "2026-03-02T09:30:00Z")];
      await expect(
        roadmap.createTimeEntries({ resource: "prompting-notes" }, overlapping),
      ).resolves.toEqual({ ok: false, reason: "overlap" });

      const adjacent = [piece("2026-03-02", "2026-03-02T09:00:00Z", "2026-03-02T10:00:00Z")];
      await roadmap.createTimeEntries({ resource: "prompting-notes" }, adjacent);
      await expect(
        roadmap.createTimeEntries({ event: summit.slug }, [
          piece("2026-03-02", "2026-03-02T09:30:00Z", "2026-03-02T10:30:00Z"),
        ]),
      ).resolves.toEqual({ ok: false, reason: "overlap" });
    });

    it("lets exactly one of concurrent overlapping event and resource writes succeed", async () => {
      const results = await Promise.all([
        roadmap.createTimeEntries({ event: summit.slug }, firstMorning),
        roadmap.createTimeEntries({ resource: "prompting-notes" }, firstMorning),
      ]);
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, reason: "overlap" }]);
      expect(await count("time_entries")).toBe(1);
    });

    it("moves an entry between a resource and an event", async () => {
      const created = await roadmap.createTimeEntries(
        { resource: "prompting-notes" },
        firstMorning,
      );
      if (!created.ok) throw new Error("The fixture entry was refused.");
      const id = created.entries[0]?.id ?? "";

      const moved = await roadmap.replaceTimeEntry(id, () => ({
        target: { event: summit.slug },
        pieces: firstMorning,
      }));
      expect(moved).toMatchObject({
        ok: true,
        entries: [{ id, resource: null, event: { slug: summit.slug } }],
      });
      await expect(
        roadmap.replaceTimeEntry(id, () => ({
          target: { event: summit.slug },
          pieces: [piece("2026-03-01", "2026-03-01T08:00:00Z", "2026-03-01T09:00:00Z")],
        })),
      ).resolves.toMatchObject({ ok: false, reason: "outside_event" });
      await expect(roadmap.findTimeEntry(id)).resolves.toMatchObject({
        date: "2026-03-02",
        event: { slug: summit.slug },
      });
    });

    it("refuses a date edit that strands attendance and changes nothing", async () => {
      await roadmap.createTimeEntries({ event: summit.slug }, [
        piece("2026-03-04", "2026-03-04T08:00:00Z", "2026-03-04T09:00:00Z"),
      ]);
      await roadmap.createTimeEntries({ event: summit.slug }, firstMorning);
      await expect(
        roadmap.updateRoadmapEvent(summit.slug, {
          name: "Renamed",
          startsOn: "2026-03-03",
          endsOn: "2026-03-03",
          topics: [],
        }),
      ).resolves.toEqual({
        ok: false,
        reason: "strands_attendance",
        dates: ["2026-03-02", "2026-03-04"],
      });
      await expect(roadmap.findRoadmapEvent(summit.slug)).resolves.toMatchObject({
        name: summit.name,
        startsOn: "2026-03-02",
        endsOn: "2026-03-04",
        topics: [{ slug: "agents" }, { slug: "evals" }],
      });

      await expect(
        roadmap.updateRoadmapEvent(summit.slug, { startsOn: "2026-03-01", endsOn: "2026-03-06" }),
      ).resolves.toMatchObject({ ok: true });
    });

    it("refuses to delete an event with attendance until the attendance is gone", async () => {
      const created = await roadmap.createTimeEntries({ event: summit.slug }, firstMorning);
      await expect(roadmap.deleteRoadmapEvent(summit.slug)).resolves.toEqual({
        ok: false,
        reason: "referenced",
      });
      expect(await count("events")).toBe(1);
      if (!created.ok) throw new Error("The fixture entry was refused.");
      await roadmap.deleteTimeEntry(created.entries[0]?.id ?? "");
      await expect(roadmap.deleteRoadmapEvent(summit.slug)).resolves.toEqual({ ok: true });
    });
  });

  describe("event days in the diary", () => {
    it("shows an event on every day of its range without storing diary days", async () => {
      await roadmap.createRoadmapEvent(summit);
      const shown = {
        slug: summit.slug,
        name: summit.name,
        kind: "conference",
        startsOn: "2026-03-02",
        endsOn: "2026-03-04",
        link: summit.link,
      };

      const diary = await roadmap.loadDiary();
      expect(diary).toEqual(
        ["2026-03-04", "2026-03-03", "2026-03-02"].map((date) => ({
          date,
          notes: null,
          entries: [],
          events: [shown],
        })),
      );
      await expect(roadmap.findDiaryDay("2026-03-03")).resolves.toEqual({
        date: "2026-03-03",
        notes: null,
        entries: [],
        events: [shown],
      });
      await expect(roadmap.findDiaryDay("2026-03-05")).resolves.toBeNull();
      expect(await count("diary_entries")).toBe(0);
    });

    it("merges event days with notes and time entries and orders events per day", async () => {
      await roadmap.createRoadmapEvent(summit);
      await roadmap.createRoadmapEvent({
        ...meetup,
        slug: "a-fictional-lecture",
        kind: "lecture",
        startsOn: "2026-03-03",
        endsOn: "2026-03-03",
      });
      await roadmap.writeDiaryNotes("2026-03-03", "Notes.");
      await roadmap.createTimeEntries({ resource: "prompting-notes" }, [
        piece("2026-03-06", "2026-03-06T08:00:00Z", "2026-03-06T09:00:00Z"),
      ]);

      const diary = await roadmap.loadDiary();
      expect(diary.map((day) => day.date)).toEqual([
        "2026-03-06",
        "2026-03-04",
        "2026-03-03",
        "2026-03-02",
      ]);
      expect(diary[2]).toMatchObject({
        notes: "Notes.",
        events: [{ slug: summit.slug }, { slug: "a-fictional-lecture" }],
      });
      expect(diary[0]?.events).toEqual([]);
    });

    it("spans a year boundary", async () => {
      await roadmap.createRoadmapEvent({
        ...meetup,
        slug: "fictional-new-year-hackathon",
        startsOn: "2026-12-31",
        endsOn: "2027-01-01",
      });
      const diary = await roadmap.loadDiary();
      expect(diary.map((day) => day.date)).toEqual(["2027-01-01", "2026-12-31"]);
    });

    it("updates the days when an event moves or is deleted", async () => {
      await roadmap.createRoadmapEvent(meetup);
      await roadmap.updateRoadmapEvent(meetup.slug, {
        startsOn: "2026-03-12",
        endsOn: "2026-03-13",
      });
      expect((await roadmap.loadDiary()).map((day) => day.date)).toEqual([
        "2026-03-13",
        "2026-03-12",
      ]);
      await expect(roadmap.findDiaryDay("2026-03-10")).resolves.toBeNull();

      await roadmap.deleteRoadmapEvent(meetup.slug);
      await expect(roadmap.loadDiary()).resolves.toEqual([]);
    });
  });
});
