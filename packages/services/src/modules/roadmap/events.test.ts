import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  DiaryDaySchema,
  RoadmapEventListSchema,
  RoadmapEventSchema,
  type RoadmapEventCreate,
  type TimeEntryCreate,
} from "@sebela/contracts";
import { createPersistence, readDatabaseConfig, type Persistence } from "@sebela/db";
import { createTemporaryDatabase, type TemporaryDatabase } from "@sebela/db/testing";

import { createProfileService } from "../profile/index.js";
import { createRoadmapService, type RoadmapService } from "./index.js";

/** A fictional three-day conference in early March (UTC+01:00 in Prague). */
const summit: RoadmapEventCreate = {
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
  topics: ["agents"],
};

/** A fictional single-day online meetup a week later. */
const meetup: RoadmapEventCreate = {
  ...summit,
  slug: "fictional-meetup",
  name: "Fictional Meetup",
  kind: "meetup",
  organizer: null,
  startsOn: "2026-03-10",
  endsOn: "2026-03-10",
  place: null,
  online: true,
  link: null,
  takeaways: null,
  topics: [],
};

/** Attendance on a day of March 2026 between two Prague wall-clock times. */
const attending = (date: string, from: string, to: string): TimeEntryCreate => ({
  event: summit.slug,
  startedAt: `${date}T${from}:00+01:00`,
  endedAt: `${date}T${to}:00+01:00`,
});

describe("roadmap events", () => {
  let database: TemporaryDatabase;
  let persistence: Persistence;
  let roadmap: RoadmapService;

  beforeAll(async () => {
    database = await createTemporaryDatabase(readDatabaseConfig(process.env));
    persistence = createPersistence(database.config);
    roadmap = createRoadmapService(persistence.roadmap);
    await createProfileService(persistence.profile).createTopic({
      slug: "agents",
      name: "Agents",
      position: 0,
    });
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
    await roadmap.createResource({
      slug: "prompt-guide",
      module: "prompting",
      name: "Fictional prompt guide",
      description: null,
      type: "text",
      status: "in-progress",
      estimatedMinutes: null,
      startedAt: null,
      finishedAt: null,
      link: null,
      position: 0,
      book: null,
      topics: ["agents"],
    });
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
    for (const event of await persistence.roadmap.listRoadmapEvents()) {
      await persistence.roadmap.deleteRoadmapEvent(event.slug);
    }
  });

  describe("managing events", () => {
    it("creates, reads and lists events newest first as contract records", async () => {
      const created = await roadmap.createEvent(summit);
      expect(RoadmapEventSchema.parse(created)).toEqual(created);
      expect(created).toMatchObject({
        slug: summit.slug,
        startsOn: "2026-03-02",
        endsOn: "2026-03-04",
        attendanceSeconds: 0,
        topics: [{ slug: "agents" }],
      });
      await roadmap.createEvent(meetup);

      const listed = await roadmap.listEvents();
      expect(RoadmapEventListSchema.parse(listed)).toEqual(listed);
      expect(listed.map((event) => event.slug)).toEqual([meetup.slug, summit.slug]);
      await expect(roadmap.getEvent(meetup.slug)).resolves.toMatchObject({ online: true });
      await expect(roadmap.getEvent("missing")).rejects.toMatchObject({ code: "not_found" });
    });

    it("refuses a taken slug, a reversed period and unknown topics", async () => {
      await roadmap.createEvent(summit);
      await expect(roadmap.createEvent(summit)).rejects.toMatchObject({ code: "conflict" });
      await expect(roadmap.createEvent({ ...meetup, topics: ["missing"] })).rejects.toMatchObject({
        code: "validation_failed",
        fields: [{ path: "topics" }],
      });
      await expect(
        roadmap.updateEvent(summit.slug, { endsOn: "2026-03-01" }),
      ).rejects.toMatchObject({ code: "validation_failed", fields: [{ path: "endsOn" }] });
      await expect(roadmap.updateEvent("missing", { name: "x" })).rejects.toMatchObject({
        code: "not_found",
      });
    });

    it("changes only the given fields and clears with null", async () => {
      await roadmap.createEvent(summit);
      const updated = await roadmap.updateEvent(summit.slug, {
        takeaways: null,
        endsOn: "2026-03-05",
        topics: [],
      });
      expect(updated).toMatchObject({
        name: summit.name,
        takeaways: null,
        endsOn: "2026-03-05",
        topics: [],
      });
    });

    it("deletes an event and refuses a missing one", async () => {
      await roadmap.createEvent(meetup);
      await roadmap.deleteEvent(meetup.slug);
      await expect(roadmap.deleteEvent(meetup.slug)).rejects.toMatchObject({ code: "not_found" });
    });

    it("keeps events out of the roadmap tree", async () => {
      await roadmap.createEvent(summit);
      const tree = await roadmap.getRoadmap();
      const slugs = tree.areas.flatMap((area) =>
        area.modules.flatMap((module) => module.resources.map((resource) => resource.slug)),
      );
      expect(slugs).toEqual(["prompt-guide"]);
      expect(tree.summary).toMatchObject({ resourceCount: 1 });
    });
  });

  describe("attendance", () => {
    beforeEach(async () => {
      await roadmap.createEvent(summit);
    });

    it("logs attendance across midnight inside the event and derives its time", async () => {
      const written = await roadmap.createTimeEntry({
        event: summit.slug,
        startedAt: "2026-03-02T23:30:00+01:00",
        endedAt: "2026-03-03T01:00:00+01:00",
      });
      expect(written.dates).toEqual(["2026-03-02", "2026-03-03"]);
      expect(written.entries.map((entry) => [entry.date, entry.durationSeconds])).toEqual([
        ["2026-03-02", 1800],
        ["2026-03-03", 3600],
      ]);
      expect(written.entries[0]).toMatchObject({
        resource: null,
        event: { slug: summit.slug, kind: "conference", startsOn: "2026-03-02" },
      });
      await expect(roadmap.getEvent(summit.slug)).resolves.toMatchObject({
        attendanceSeconds: 5400,
      });
    });

    it("refuses an unknown event and a time outside the event's days on their fields", async () => {
      await expect(
        roadmap.createTimeEntry({ ...attending("2026-03-02", "09:00", "10:00"), event: "missing" }),
      ).rejects.toMatchObject({ code: "validation_failed", fields: [{ path: "event" }] });
      await expect(
        roadmap.createTimeEntry(attending("2026-03-01", "09:00", "10:00")),
      ).rejects.toMatchObject({ code: "validation_failed", fields: [{ path: "startedAt" }] });
      await expect(
        roadmap.createTimeEntry({
          event: summit.slug,
          startedAt: "2026-03-04T23:30:00+01:00",
          endedAt: "2026-03-05T00:30:00+01:00",
        }),
      ).rejects.toMatchObject({ code: "validation_failed", fields: [{ path: "endedAt" }] });
    });

    it("refuses attendance that overlaps study time, also concurrently", async () => {
      await roadmap.createTimeEntry({
        resource: "prompt-guide",
        startedAt: "2026-03-02T09:00:00+01:00",
        endedAt: "2026-03-02T10:00:00+01:00",
      });
      await expect(
        roadmap.createTimeEntry(attending("2026-03-02", "09:30", "11:00")),
      ).rejects.toMatchObject({ code: "conflict" });

      const results = await Promise.allSettled([
        roadmap.createTimeEntry(attending("2026-03-03", "09:00", "10:00")),
        roadmap.createTimeEntry({
          resource: "prompt-guide",
          startedAt: "2026-03-03T09:30:00+01:00",
          endedAt: "2026-03-03T10:30:00+01:00",
        }),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    });

    it("moves an entry from a resource to the event and keeps its target on a time change", async () => {
      const created = await roadmap.createTimeEntry({
        resource: "prompt-guide",
        startedAt: "2026-03-02T09:00:00+01:00",
        endedAt: "2026-03-02T10:00:00+01:00",
      });
      const id = created.entries[0]?.id ?? "";

      const moved = await roadmap.updateTimeEntry(id, { event: summit.slug });
      expect(moved.entries[0]).toMatchObject({ id, resource: null, event: { slug: summit.slug } });
      const later = await roadmap.updateTimeEntry(id, {
        startedAt: "2026-03-03T09:00:00+01:00",
        endedAt: "2026-03-03T10:00:00+01:00",
      });
      expect(later).toMatchObject({
        dates: ["2026-03-02", "2026-03-03"],
        entries: [{ id, event: { slug: summit.slug } }],
      });
      await expect(
        roadmap.updateTimeEntry(id, {
          startedAt: "2026-03-05T09:00:00+01:00",
          endedAt: "2026-03-05T10:00:00+01:00",
        }),
      ).rejects.toMatchObject({ code: "validation_failed", fields: [{ path: "startedAt" }] });
      const back = await roadmap.updateTimeEntry(id, { resource: "prompt-guide" });
      expect(back.entries[0]).toMatchObject({ resource: { slug: "prompt-guide" }, event: null });
    });

    it("refuses a date edit that strands attendance and leaves the event unchanged", async () => {
      await roadmap.createTimeEntry(attending("2026-03-04", "09:00", "10:00"));
      await expect(
        roadmap.updateEvent(summit.slug, { name: "Renamed", endsOn: "2026-03-03" }),
      ).rejects.toMatchObject({
        code: "conflict",
        message: expect.stringContaining("2026-03-04") as unknown,
      });
      await expect(roadmap.getEvent(summit.slug)).resolves.toMatchObject({
        name: summit.name,
        endsOn: "2026-03-04",
      });
    });

    it("refuses to delete an event with attendance", async () => {
      await roadmap.createTimeEntry(attending("2026-03-02", "09:00", "10:00"));
      await expect(roadmap.deleteEvent(summit.slug)).rejects.toMatchObject({ code: "conflict" });
      await expect(roadmap.getEvent(summit.slug)).resolves.toMatchObject({
        attendanceSeconds: 3600,
      });
    });
  });

  describe("event days in the diary", () => {
    it("shows an event on each of its days without time or notes", async () => {
      await roadmap.createEvent(summit);
      const diary = await roadmap.getDiary();
      expect(diary.days.map((day) => [day.date, day.totalSeconds, day.events.length])).toEqual([
        ["2026-03-04", 0, 1],
        ["2026-03-03", 0, 1],
        ["2026-03-02", 0, 1],
      ]);
      const day = await roadmap.getDiaryDay("2026-03-03");
      expect(DiaryDaySchema.parse(day)).toEqual(day);
      expect(day).toEqual({
        date: "2026-03-03",
        notes: null,
        entries: [],
        events: [
          {
            slug: summit.slug,
            name: summit.name,
            kind: "conference",
            startsOn: "2026-03-02",
            endsOn: "2026-03-04",
            link: summit.link,
          },
        ],
        totalSeconds: 0,
      });
    });

    it("moves the shown days with the event and drops them with it", async () => {
      await roadmap.createEvent(meetup);
      await roadmap.updateEvent(meetup.slug, { startsOn: "2026-03-11", endsOn: "2026-03-11" });
      await expect(roadmap.getDiaryDay("2026-03-10")).rejects.toMatchObject({ code: "not_found" });
      await expect(roadmap.getDiaryDay("2026-03-11")).resolves.toMatchObject({
        events: [{ slug: meetup.slug }],
      });
      await roadmap.deleteEvent(meetup.slug);
      await expect(roadmap.getDiary()).resolves.toEqual({ days: [] });
    });
  });
});
