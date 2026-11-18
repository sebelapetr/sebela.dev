import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { readDatabaseConfig } from "../../config.js";
import { openConnection, type Connection } from "../../connection.js";
import { createTemporaryDatabase, type TemporaryDatabase } from "../../testing.js";
import { createRoadmapPersistence, type RoadmapPersistence, type TimeEntryPiece } from "./index.js";

/** A piece in a fictional diary day; 2026-03 dates before the 29th are UTC+01:00 in Prague. */
const piece = (date: string, startedAt: string, endedAt: string): TimeEntryPiece => ({
  date,
  startedAt: new Date(startedAt),
  endedAt: new Date(endedAt),
});

/** 23:30 to 00:30 Prague time, split at local midnight. */
const acrossMidnight = [
  piece("2026-03-02", "2026-03-02T22:30:00Z", "2026-03-02T23:00:00Z"),
  piece("2026-03-03", "2026-03-02T23:00:00Z", "2026-03-02T23:30:00Z"),
];

describe("learning diary persistence", () => {
  let database: TemporaryDatabase;
  let connection: Connection;
  let roadmap: RoadmapPersistence;

  /** Counts every stored row of a diary table. */
  async function count(table: "diary_entries" | "time_entries") {
    const result = await connection.db.execute<{ count: string }>(
      sql`SELECT count(*) AS count FROM ${sql.identifier("ai_roadmap")}.${sql.identifier(table)}`,
    );
    return Number(result.rows[0]?.count);
  }

  beforeAll(async () => {
    database = await createTemporaryDatabase(readDatabaseConfig(process.env));
    connection = openConnection(database.config);
    roadmap = createRoadmapPersistence(connection.db);
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
    for (const [position, slug] of ["prompting-notes", "intro-video"].entries()) {
      await roadmap.createRoadmapResource({
        slug,
        module: "prompting-basics",
        name: `Resource ${slug}`,
        description: null,
        type: "text",
        status: "in-progress",
        estimatedMinutes: null,
        startedAt: null,
        finishedAt: null,
        link: `https://example.com/${slug}`,
        position,
        book: null,
        topics: [],
      });
    }
  });

  afterAll(async () => {
    await connection.close();
    await database.drop();
  });

  beforeEach(async () => {
    await connection.db.execute(
      sql`TRUNCATE ${sql.identifier("ai_roadmap")}.${sql.identifier("time_entries")}, ${sql.identifier("ai_roadmap")}.${sql.identifier("diary_entries")}`,
    );
  });

  describe("notes", () => {
    it("reads an empty diary and no unknown day", async () => {
      await expect(roadmap.loadDiary()).resolves.toEqual([]);
      await expect(roadmap.findDiaryDay("2026-03-02")).resolves.toBeNull();
    });

    it("creates a notes-only day, replaces its notes and clears them", async () => {
      await expect(roadmap.writeDiaryNotes("2026-03-02", "First.")).resolves.toEqual({
        date: "2026-03-02",
        notes: "First.",
        entries: [],
      });
      await roadmap.writeDiaryNotes("2026-03-02", "Second.");
      await expect(roadmap.findDiaryDay("2026-03-02")).resolves.toMatchObject({
        notes: "Second.",
      });

      await expect(roadmap.clearDiaryNotes("2026-03-02")).resolves.toEqual({ ok: true });
      await expect(roadmap.clearDiaryNotes("2026-03-02")).resolves.toEqual({
        ok: false,
        reason: "not_found",
      });
      await expect(roadmap.findDiaryDay("2026-03-02")).resolves.toBeNull();
      await expect(roadmap.loadDiary()).resolves.toEqual([]);
    });

    it("keeps the time entries when the notes change or are cleared", async () => {
      await roadmap.createTimeEntries("prompting-notes", acrossMidnight);
      await roadmap.writeDiaryNotes("2026-03-02", "Notes.");
      await roadmap.clearDiaryNotes("2026-03-02");

      const day = await roadmap.findDiaryDay("2026-03-02");
      expect(day?.notes).toBeNull();
      expect(day?.entries).toHaveLength(1);
    });

    it("creates one day for concurrent notes writes", async () => {
      await Promise.all([
        roadmap.writeDiaryNotes("2026-03-05", "One."),
        roadmap.writeDiaryNotes("2026-03-05", "Two."),
      ]);
      expect(await count("diary_entries")).toBe(1);
    });
  });

  describe("time entries", () => {
    it("stores a session split at midnight in both days, with its resource", async () => {
      const result = await roadmap.createTimeEntries("prompting-notes", acrossMidnight);
      expect(result.ok).toBe(true);

      const diary = await roadmap.loadDiary();
      expect(diary.map((day) => day.date)).toEqual(["2026-03-03", "2026-03-02"]);
      expect(diary[1]).toMatchObject({
        notes: null,
        entries: [
          {
            date: "2026-03-02",
            resource: {
              slug: "prompting-notes",
              name: "Resource prompting-notes",
              type: "text",
              link: "https://example.com/prompting-notes",
              module: "prompting-basics",
              area: "foundations",
            },
            startedAt: new Date("2026-03-02T22:30:00Z"),
            endedAt: new Date("2026-03-02T23:00:00Z"),
          },
        ],
      });
      const id = diary[0]?.entries[0]?.id ?? "";
      await expect(roadmap.findTimeEntry(id)).resolves.toMatchObject({ date: "2026-03-03" });
    });

    it("orders a day's entries by start", async () => {
      await roadmap.createTimeEntries("intro-video", [
        piece("2026-03-04", "2026-03-04T10:00:00Z", "2026-03-04T11:00:00Z"),
      ]);
      await roadmap.createTimeEntries("prompting-notes", [
        piece("2026-03-04", "2026-03-04T08:00:00Z", "2026-03-04T09:00:00Z"),
      ]);
      const day = await roadmap.findDiaryDay("2026-03-04");
      expect(day?.entries.map((entry) => entry.resource.slug)).toEqual([
        "prompting-notes",
        "intro-video",
      ]);
    });

    it("refuses an unknown resource and stores nothing", async () => {
      await expect(roadmap.createTimeEntries("missing", acrossMidnight)).resolves.toEqual({
        ok: false,
        reason: "unknown_resource",
      });
      expect(await count("diary_entries")).toBe(0);
      expect(await count("time_entries")).toBe(0);
    });

    it("refuses an overlap across resources and keeps none of the refused pieces", async () => {
      await roadmap.createTimeEntries("intro-video", [
        piece("2026-03-03", "2026-03-02T23:15:00Z", "2026-03-02T23:45:00Z"),
      ]);
      await expect(roadmap.createTimeEntries("prompting-notes", acrossMidnight)).resolves.toEqual({
        ok: false,
        reason: "overlap",
      });
      expect(await count("time_entries")).toBe(1);
      await expect(roadmap.findDiaryDay("2026-03-02")).resolves.toBeNull();
    });

    it("allows adjacent intervals", async () => {
      await roadmap.createTimeEntries("prompting-notes", acrossMidnight);
      const result = await roadmap.createTimeEntries("intro-video", [
        piece("2026-03-03", "2026-03-02T23:30:00Z", "2026-03-03T00:00:00Z"),
        piece("2026-03-02", "2026-03-02T22:00:00Z", "2026-03-02T22:30:00Z"),
      ]);
      expect(result.ok).toBe(true);
      expect(await count("time_entries")).toBe(4);
    });

    it("lets exactly one of two concurrent overlapping writes succeed", async () => {
      const results = await Promise.all([
        roadmap.createTimeEntries("prompting-notes", [
          piece("2026-03-06", "2026-03-06T08:00:00Z", "2026-03-06T09:00:00Z"),
        ]),
        roadmap.createTimeEntries("intro-video", [
          piece("2026-03-06", "2026-03-06T08:30:00Z", "2026-03-06T09:30:00Z"),
        ]),
      ]);
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, reason: "overlap" }]);
      expect(await count("time_entries")).toBe(1);
    });

    it("creates one day for concurrent writes into the same new day", async () => {
      const results = await Promise.all([
        roadmap.createTimeEntries("prompting-notes", [
          piece("2026-03-07", "2026-03-07T08:00:00Z", "2026-03-07T09:00:00Z"),
        ]),
        roadmap.createTimeEntries("intro-video", [
          piece("2026-03-07", "2026-03-07T10:00:00Z", "2026-03-07T11:00:00Z"),
        ]),
      ]);
      expect(results.every((result) => result.ok)).toBe(true);
      expect(await count("diary_entries")).toBe(1);
      expect(await count("time_entries")).toBe(2);
    });

    it("refuses a piece outside its diary day or ending before it starts", async () => {
      await expect(
        roadmap.createTimeEntries("prompting-notes", [
          piece("2026-03-03", "2026-03-02T22:30:00Z", "2026-03-02T23:00:00Z"),
        ]),
      ).rejects.toThrow();
      await expect(
        roadmap.createTimeEntries("prompting-notes", [
          piece("2026-03-02", "2026-03-02T22:30:00Z", "2026-03-02T23:30:00Z"),
        ]),
      ).rejects.toThrow();
      await expect(
        roadmap.createTimeEntries("prompting-notes", [
          piece("2026-03-02", "2026-03-02T10:00:00Z", "2026-03-02T10:00:00Z"),
        ]),
      ).rejects.toThrow();
      expect(await count("time_entries")).toBe(0);
      expect(await count("diary_entries")).toBe(0);
    });

    it("keeps a resource with time entries from being deleted", async () => {
      await roadmap.createTimeEntries("intro-video", acrossMidnight);
      await expect(roadmap.deleteRoadmapResource("intro-video")).resolves.toEqual({
        ok: false,
        reason: "referenced",
      });
    });
  });

  describe("replacing and deleting a time entry", () => {
    async function firstEntryId() {
      const [day] = await roadmap.loadDiary();
      return day?.entries[0]?.id ?? "";
    }

    it("moves an entry to other days, keeps its id and the old day's notes", async () => {
      await roadmap.createTimeEntries("prompting-notes", [
        piece("2026-03-10", "2026-03-10T08:00:00Z", "2026-03-10T09:00:00Z"),
      ]);
      await roadmap.writeDiaryNotes("2026-03-10", "Kept.");
      const id = await firstEntryId();

      const result = await roadmap.replaceTimeEntry(id, (current) => {
        expect(current.resource.slug).toBe("prompting-notes");
        return { resource: "intro-video", pieces: acrossMidnight };
      });

      expect(result).toMatchObject({ ok: true, previousDate: "2026-03-10" });
      if (!result.ok) return;
      expect(result.entries.map((entry) => entry.date)).toEqual(["2026-03-02", "2026-03-03"]);
      expect(result.entries[0]?.id).toBe(id);
      expect(result.entries[1]?.resource.slug).toBe("intro-video");
      await expect(roadmap.findDiaryDay("2026-03-10")).resolves.toEqual({
        date: "2026-03-10",
        notes: "Kept.",
        entries: [],
      });
    });

    it("writes nothing when the plan or the database refuses the replacement", async () => {
      await roadmap.createTimeEntries("prompting-notes", acrossMidnight);
      await roadmap.createTimeEntries("intro-video", [
        piece("2026-03-11", "2026-03-11T08:00:00Z", "2026-03-11T09:00:00Z"),
      ]);
      const id = await firstEntryId();
      const before = await roadmap.loadDiary();

      await expect(
        roadmap.replaceTimeEntry(id, () => ({ ok: false, reason: "invalid_period" }) as const),
      ).resolves.toEqual({ ok: false, reason: "invalid_period" });
      await expect(
        roadmap.replaceTimeEntry(id, () => ({ resource: "intro-video", pieces: acrossMidnight })),
      ).resolves.toEqual({ ok: false, reason: "overlap" });
      await expect(
        roadmap.replaceTimeEntry(id, () => ({
          resource: "missing",
          pieces: [piece("2026-03-12", "2026-03-12T08:00:00Z", "2026-03-12T09:00:00Z")],
        })),
      ).resolves.toEqual({ ok: false, reason: "unknown_resource" });

      await expect(roadmap.loadDiary()).resolves.toEqual(before);
    });

    it("reports an unknown entry", async () => {
      const unknown = "0b7a9a51-3c2e-4f1a-8d6b-2e4c6a8b0d1f";
      await expect(
        roadmap.replaceTimeEntry(unknown, () => ({ resource: "intro-video", pieces: [] })),
      ).resolves.toEqual({ ok: false, reason: "not_found" });
      await expect(roadmap.deleteTimeEntry(unknown)).resolves.toEqual({
        ok: false,
        reason: "not_found",
      });
      await expect(roadmap.findTimeEntry(unknown)).resolves.toBeNull();
    });

    it("deletes an entry and returns its day", async () => {
      await roadmap.createTimeEntries("prompting-notes", acrossMidnight);
      const id = await firstEntryId();
      await expect(roadmap.deleteTimeEntry(id)).resolves.toEqual({ ok: true, date: "2026-03-03" });
      expect(await count("time_entries")).toBe(1);
      await expect(roadmap.findDiaryDay("2026-03-03")).resolves.toBeNull();
    });
  });
});
