import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  DiaryDaySchema,
  DiarySchema,
  TimeEntryWriteSchema,
  type TimeEntryCreate,
} from "@sebela/contracts";
import { createPersistence, readDatabaseConfig, type Persistence } from "@sebela/db";
import { createTemporaryDatabase, type TemporaryDatabase } from "@sebela/db/testing";

import { createRoadmapService, type RoadmapService } from "./index.js";

/** 23:30 to 00:30 Prague time on a fictional winter evening (UTC+01:00). */
const lateSession: TimeEntryCreate = {
  resource: "prompt-guide",
  startedAt: "2026-03-02T23:30:00+01:00",
  endedAt: "2026-03-03T00:30:00+01:00",
};

const morning = (resource: string, from: string, to: string): TimeEntryCreate => ({
  resource,
  startedAt: `2026-03-04T${from}:00+01:00`,
  endedAt: `2026-03-04T${to}:00+01:00`,
});

describe("the learning diary", () => {
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
    for (const [position, slug] of ["prompt-guide", "agents-video"].entries()) {
      await roadmap.createResource({
        slug,
        module: "prompting",
        name: `Fictional ${slug}`,
        description: null,
        type: "text",
        status: "in-progress",
        estimatedMinutes: null,
        startedAt: null,
        finishedAt: null,
        link: position === 0 ? "https://example.com/prompt-guide" : null,
        position,
        book: null,
        topics: [],
      });
    }
  });

  afterAll(async () => {
    await persistence.close();
    await database.drop();
  });

  beforeEach(async () => {
    for (const day of await persistence.roadmap.loadDiary()) {
      for (const entry of day.entries) await persistence.roadmap.deleteTimeEntry(entry.id);
      if (day.notes !== null) await persistence.roadmap.clearDiaryNotes(day.date);
    }
  });

  describe("reads", () => {
    it("is empty without notes or time entries", async () => {
      await expect(roadmap.getDiary()).resolves.toEqual({ days: [] });
      await expect(roadmap.getDiaryDay("2026-03-02")).rejects.toMatchObject({ code: "not_found" });
    });

    it("returns days newest first with entries, resources and derived totals", async () => {
      await roadmap.writeDiaryNotes("2026-03-02", { notes: "Read about **prompts**." });
      await roadmap.createTimeEntry(lateSession);
      await roadmap.createTimeEntry(morning("agents-video", "09:00", "09:20"));
      await roadmap.createTimeEntry(morning("prompt-guide", "08:00", "08:40"));

      const diary = await roadmap.getDiary();

      expect(DiarySchema.parse(diary)).toEqual(diary);
      expect(diary.days.map((day) => [day.date, day.totalSeconds])).toEqual([
        ["2026-03-04", 3600],
        ["2026-03-03", 1800],
        ["2026-03-02", 1800],
      ]);
      const [latest] = diary.days;
      expect(latest?.notes).toBeNull();
      expect(latest?.entries.map((entry) => [entry.resource?.slug, entry.durationSeconds])).toEqual(
        [
          ["prompt-guide", 2400],
          ["agents-video", 1200],
        ],
      );
      expect(latest?.entries[0]).toMatchObject({
        date: "2026-03-04",
        startedAt: "2026-03-04T07:00:00.000Z",
        endedAt: "2026-03-04T07:40:00.000Z",
        resource: {
          slug: "prompt-guide",
          name: "Fictional prompt-guide",
          type: "text",
          link: "https://example.com/prompt-guide",
          module: "prompting",
          area: "foundations",
        },
      });
      for (const day of diary.days) {
        expect(day.totalSeconds).toBe(
          day.entries.reduce((sum, entry) => sum + entry.durationSeconds, 0),
        );
      }
      expect(diary.days[2]?.notes).toBe("Read about **prompts**.");
    });

    it("returns one day, also a notes-only day", async () => {
      const written = await roadmap.writeDiaryNotes("2026-03-01", { notes: "Planning." });

      const day = await roadmap.getDiaryDay("2026-03-01");

      expect(DiaryDaySchema.parse(day)).toEqual(day);
      expect(day).toEqual({
        date: "2026-03-01",
        notes: "Planning.",
        entries: [],
        events: [],
        totalSeconds: 0,
      });
      expect(written).toEqual(day);
    });

    it("returns one time entry as the diary shows it, and refuses a missing one", async () => {
      const { entries } = await roadmap.createTimeEntry(lateSession);
      const [first] = entries;
      if (first === undefined) throw new Error("Expected a written entry.");

      await expect(roadmap.getTimeEntry(first.id)).resolves.toEqual(first);
      await expect(
        roadmap.getTimeEntry("00000000-0000-4000-8000-000000000000"),
      ).rejects.toMatchObject({ code: "not_found" });
    });
  });

  describe("notes", () => {
    it("replaces the notes and keeps the day's time entries", async () => {
      await roadmap.createTimeEntry(lateSession);
      await roadmap.writeDiaryNotes("2026-03-02", { notes: "First." });

      const day = await roadmap.writeDiaryNotes("2026-03-02", { notes: "Second." });

      expect(day.notes).toBe("Second.");
      expect(day.entries).toHaveLength(1);
    });

    it("deletes the notes, keeps the entries and refuses a day without notes", async () => {
      await roadmap.createTimeEntry(lateSession);
      await roadmap.writeDiaryNotes("2026-03-02", { notes: "Gone soon." });

      await roadmap.deleteDiaryNotes("2026-03-02");

      await expect(roadmap.getDiaryDay("2026-03-02")).resolves.toMatchObject({
        notes: null,
        totalSeconds: 1800,
      });
      await expect(roadmap.deleteDiaryNotes("2026-03-02")).rejects.toMatchObject({
        code: "not_found",
      });
    });
  });

  describe("creating a time entry", () => {
    it("splits a session at Prague midnight and returns every affected day", async () => {
      const write = await roadmap.createTimeEntry(lateSession);

      expect(TimeEntryWriteSchema.parse(write)).toEqual(write);
      expect(write.dates).toEqual(["2026-03-02", "2026-03-03"]);
      expect(write.entries.map((entry) => [entry.date, entry.durationSeconds])).toEqual([
        ["2026-03-02", 1800],
        ["2026-03-03", 1800],
      ]);
    });

    it("uses actual elapsed time on the fall daylight-saving night", async () => {
      const write = await roadmap.createTimeEntry({
        resource: "prompt-guide",
        startedAt: "2026-10-25T01:00:00+02:00",
        endedAt: "2026-10-25T04:00:00+01:00",
      });

      expect(write.entries.map((entry) => entry.durationSeconds)).toEqual([4 * 3600]);
      await expect(roadmap.getDiaryDay("2026-10-25")).resolves.toMatchObject({
        totalSeconds: 4 * 3600,
      });
    });

    it("refuses an unknown resource on its field", async () => {
      await expect(
        roadmap.createTimeEntry({ ...lateSession, resource: "missing" }),
      ).rejects.toMatchObject({
        code: "validation_failed",
        fields: [{ path: "resource" }],
      });
      await expect(roadmap.getDiary()).resolves.toEqual({ days: [] });
    });

    it("refuses an end that is not after the start", async () => {
      await expect(
        roadmap.createTimeEntry({ ...lateSession, endedAt: lateSession.startedAt }),
      ).rejects.toMatchObject({ code: "validation_failed", fields: [{ path: "endedAt" }] });
    });

    it("refuses fractions of a second, so every duration is whole seconds", async () => {
      await expect(
        roadmap.createTimeEntry({ ...lateSession, endedAt: "2026-03-03T00:30:00.500+01:00" }),
      ).rejects.toMatchObject({ code: "validation_failed", fields: [{ path: "endedAt" }] });
      await expect(
        roadmap.createTimeEntry({ ...lateSession, startedAt: "2026-03-02T23:30:00.000+01:00" }),
      ).resolves.toMatchObject({ dates: ["2026-03-02", "2026-03-03"] });
    });

    it("refuses an overlap with any resource's interval and writes nothing", async () => {
      await roadmap.createTimeEntry(morning("prompt-guide", "08:00", "09:00"));

      await expect(
        roadmap.createTimeEntry({
          resource: "agents-video",
          startedAt: "2026-03-03T23:00:00+01:00",
          endedAt: "2026-03-04T08:30:00+01:00",
        }),
      ).rejects.toMatchObject({ code: "conflict" });
      await expect(roadmap.getDiary()).resolves.toMatchObject({
        days: [{ date: "2026-03-04", totalSeconds: 3600 }],
      });
    });

    it("allows adjacent intervals", async () => {
      await roadmap.createTimeEntry(morning("prompt-guide", "08:00", "09:00"));

      await roadmap.createTimeEntry(morning("agents-video", "09:00", "10:00"));

      await expect(roadmap.getDiaryDay("2026-03-04")).resolves.toMatchObject({
        totalSeconds: 7200,
      });
    });

    it("accepts exactly one of competing overlapping writes", async () => {
      const results = await Promise.allSettled(
        ["08:00", "08:10", "08:20", "08:30"].map((from, index) =>
          roadmap.createTimeEntry(
            morning(index % 2 === 0 ? "prompt-guide" : "agents-video", from, "09:00"),
          ),
        ),
      );

      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      for (const result of results) {
        if (result.status === "rejected") expect(result.reason).toMatchObject({ code: "conflict" });
      }
    });

    it("creates a new day once under competing non-overlapping writes", async () => {
      await Promise.all(
        ["08:00", "09:00", "10:00", "11:00"].map((from, index) =>
          roadmap.createTimeEntry(
            morning("prompt-guide", from, `${String(9 + index).padStart(2, "0")}:00`),
          ),
        ),
      );

      await expect(roadmap.getDiaryDay("2026-03-04")).resolves.toMatchObject({
        totalSeconds: 4 * 3600,
      });
    });
  });

  describe("changing a time entry", () => {
    it("moves it to another day, keeps both days' notes and returns old and new days", async () => {
      const created = await roadmap.createTimeEntry(morning("prompt-guide", "08:00", "09:00"));
      await roadmap.writeDiaryNotes("2026-03-04", { notes: "Old day." });
      await roadmap.writeDiaryNotes("2026-03-02", { notes: "New day." });
      const id = created.entries[0]?.id ?? "";

      const write = await roadmap.updateTimeEntry(id, {
        startedAt: lateSession.startedAt,
        endedAt: lateSession.endedAt,
      });

      expect(write.dates).toEqual(["2026-03-02", "2026-03-03", "2026-03-04"]);
      expect(write.entries.map((entry) => entry.date)).toEqual(["2026-03-02", "2026-03-03"]);
      expect(write.entries[0]?.id).toBe(id);
      await expect(roadmap.getDiaryDay("2026-03-04")).resolves.toEqual({
        date: "2026-03-04",
        notes: "Old day.",
        entries: [],
        events: [],
        totalSeconds: 0,
      });
      await expect(roadmap.getDiaryDay("2026-03-02")).resolves.toMatchObject({
        notes: "New day.",
        totalSeconds: 1800,
      });
    });

    it("changes only the given fields", async () => {
      const created = await roadmap.createTimeEntry(morning("prompt-guide", "08:00", "09:00"));
      const id = created.entries[0]?.id ?? "";

      const write = await roadmap.updateTimeEntry(id, { resource: "agents-video" });

      expect(write.dates).toEqual(["2026-03-04"]);
      expect(write.entries).toMatchObject([
        { id, resource: { slug: "agents-video" }, durationSeconds: 3600 },
      ]);
    });

    it("may overlap its own previous interval", async () => {
      const created = await roadmap.createTimeEntry(morning("prompt-guide", "08:00", "09:00"));
      const id = created.entries[0]?.id ?? "";

      const write = await roadmap.updateTimeEntry(id, { endedAt: "2026-03-04T09:30:00+01:00" });

      expect(write.entries[0]?.durationSeconds).toBe(5400);
    });

    it("refuses an end before the merged start, an unknown resource and an overlap unchanged", async () => {
      const created = await roadmap.createTimeEntry(morning("prompt-guide", "08:00", "09:00"));
      await roadmap.createTimeEntry(morning("agents-video", "10:00", "11:00"));
      const id = created.entries[0]?.id ?? "";

      await expect(
        roadmap.updateTimeEntry(id, { endedAt: "2026-03-04T07:00:00+01:00" }),
      ).rejects.toMatchObject({ code: "validation_failed", fields: [{ path: "endedAt" }] });
      await expect(roadmap.updateTimeEntry(id, { resource: "missing" })).rejects.toMatchObject({
        code: "validation_failed",
        fields: [{ path: "resource" }],
      });
      await expect(
        roadmap.updateTimeEntry(id, { endedAt: "2026-03-04T10:30:00+01:00" }),
      ).rejects.toMatchObject({ code: "conflict" });
      await expect(roadmap.getDiaryDay("2026-03-04")).resolves.toMatchObject({
        totalSeconds: 7200,
        entries: [
          { id, resource: { slug: "prompt-guide" } },
          { resource: { slug: "agents-video" } },
        ],
      });
    });

    it("refuses a missing entry", async () => {
      await expect(
        roadmap.updateTimeEntry("0b7a9a51-3c2e-4f1a-8d6b-2e4c6a8b0d1f", {
          resource: "prompt-guide",
        }),
      ).rejects.toMatchObject({ code: "not_found" });
    });
  });

  describe("deleting a time entry", () => {
    it("returns its day, keeps the notes and refuses a missing entry", async () => {
      const created = await roadmap.createTimeEntry(lateSession);
      await roadmap.writeDiaryNotes("2026-03-03", { notes: "Kept." });
      const id = created.entries[1]?.id ?? "";

      await expect(roadmap.deleteTimeEntry(id)).resolves.toEqual({ dates: ["2026-03-03"] });

      await expect(roadmap.getDiaryDay("2026-03-03")).resolves.toEqual({
        date: "2026-03-03",
        notes: "Kept.",
        entries: [],
        events: [],
        totalSeconds: 0,
      });
      await expect(roadmap.getDiaryDay("2026-03-02")).resolves.toMatchObject({
        totalSeconds: 1800,
      });
      await expect(roadmap.deleteTimeEntry(id)).rejects.toMatchObject({ code: "not_found" });
    });

    it("leaves a day without notes or entries out of the diary", async () => {
      const created = await roadmap.createTimeEntry(morning("prompt-guide", "08:00", "09:00"));

      await roadmap.deleteTimeEntry(created.entries[0]?.id ?? "");

      await expect(roadmap.getDiary()).resolves.toEqual({ days: [] });
      await expect(roadmap.getDiaryDay("2026-03-04")).rejects.toMatchObject({ code: "not_found" });
    });
  });

  it("refuses to delete a resource that has time entries", async () => {
    await roadmap.createTimeEntry(lateSession);

    await expect(roadmap.deleteResource("prompt-guide")).rejects.toMatchObject({
      code: "conflict",
    });
  });
});
