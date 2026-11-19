import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  DiaryDaySchema,
  DiarySchema,
  TimeEntryWriteSchema,
  type Diary,
  type DiaryDay,
} from "@sebela/contracts";

import { bearer, connection, json, openTestBackend, type TestBackend } from "./test-support.js";

/** A small fictional roadmap with two resources to log time on. */
const area = { slug: "basics", name: "Basics", weight: 100, position: 0 };
const module = { slug: "prompting", area: "basics", name: "Prompting", position: 0 };
const guide = {
  slug: "prompting-guide",
  module: "prompting",
  name: "A fictional prompting guide",
  type: "link",
  link: "https://learn.example.test/prompting-guide",
  position: 0,
};
const drills = {
  slug: "prompting-drills",
  module: "prompting",
  name: "Prompting drills",
  type: "project",
  position: 1,
};

/** 23:30 to 00:30 in Prague in winter: thirty minutes on each day. */
const acrossMidnight = {
  resource: "prompting-guide",
  startedAt: "2026-03-02T23:30:00+01:00",
  endedAt: "2026-03-03T00:30:00+01:00",
};

interface FieldError {
  path: string;
  message: string;
}

describe("the learning diary API", () => {
  let backend: TestBackend;
  let auth: Record<string, string>;

  beforeAll(async () => {
    backend = await openTestBackend();
    auth = bearer((await backend.services.apiKeys.createKey("diary routes")).key);
    for (const [path, body] of [
      ["/v1/roadmap/areas", area],
      ["/v1/roadmap/modules", module],
      ["/v1/roadmap/resources", guide],
      ["/v1/roadmap/resources", drills],
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
      if (day.notes !== null) await roadmap.deleteDiaryNotes(day.date);
    }
  });

  const request = (path: string, method = "GET", init: RequestInit = {}) =>
    backend.api().app.request(path, { method, ...init }, connection());
  const post = (path: string, body: object) => request(path, "POST", json(body, auth));
  const patch = (path: string, body: object) => request(path, "PATCH", json(body, auth));
  const remove = (path: string) => request(path, "DELETE", { headers: auth });
  const errorOf = async (response: Response) =>
    ((await response.json()) as { error: { code: string; fields?: FieldError[] } }).error;
  const diary = async (): Promise<Diary> => {
    const response = await request("/v1/roadmap/diary");
    expect(response.status).toBe(200);
    return DiarySchema.parse(await response.json());
  };
  const day = async (date: string): Promise<DiaryDay> => {
    const response = await request(`/v1/roadmap/diary/${date}`);
    expect(response.status).toBe(200);
    return DiaryDaySchema.parse(await response.json());
  };

  it("reads an empty diary as an empty list and a day without anything as not found", async () => {
    expect(await diary()).toEqual({ days: [] });
    const missing = await request("/v1/roadmap/diary/2026-03-02");
    expect(missing.status).toBe(404);
    expect((await errorOf(missing)).code).toBe("not_found");
  });

  it("writes, replaces and clears a day's notes, and reads a notes-only day publicly", async () => {
    const written = await patch("/v1/roadmap/diary/2026-03-02", { notes: "Read **chapter 1**." });
    expect(written.status).toBe(200);
    expect(DiaryDaySchema.parse(await written.json())).toEqual({
      date: "2026-03-02",
      notes: "Read **chapter 1**.",
      entries: [],
      totalSeconds: 0,
      events: [],
    });

    const replaced = await patch("/v1/roadmap/diary/2026-03-02", { notes: "Read chapter 2." });
    expect(replaced.status).toBe(200);
    expect((await day("2026-03-02")).notes).toBe("Read chapter 2.");
    expect((await diary()).days.map(({ date }) => date)).toEqual(["2026-03-02"]);

    expect((await remove("/v1/roadmap/diary/2026-03-02")).status).toBe(204);
    expect((await request("/v1/roadmap/diary/2026-03-02")).status).toBe(404);
    expect((await remove("/v1/roadmap/diary/2026-03-02")).status).toBe(404);
  });

  it("logs a session split at Prague midnight into both days, with derived totals", async () => {
    await patch("/v1/roadmap/diary/2026-03-02", { notes: "Late reading." });

    const created = await post("/v1/roadmap/time-entries", acrossMidnight);
    expect(created.status).toBe(201);
    const write = TimeEntryWriteSchema.parse(await created.json());
    expect(write.dates).toEqual(["2026-03-02", "2026-03-03"]);
    expect(write.entries.map(({ date, durationSeconds }) => [date, durationSeconds])).toEqual([
      ["2026-03-02", 1800],
      ["2026-03-03", 1800],
    ]);

    const first = await day("2026-03-02");
    expect(first).toMatchObject({ notes: "Late reading.", totalSeconds: 1800 });
    expect(first.entries[0]).toMatchObject({
      startedAt: "2026-03-02T22:30:00.000Z",
      endedAt: "2026-03-02T23:00:00.000Z",
      resource: {
        slug: "prompting-guide",
        name: "A fictional prompting guide",
        link: "https://learn.example.test/prompting-guide",
        module: "prompting",
        area: "basics",
      },
    });
    expect(await day("2026-03-03")).toMatchObject({ notes: null, totalSeconds: 1800 });
    expect((await diary()).days.map(({ date }) => date)).toEqual(["2026-03-03", "2026-03-02"]);
  });

  it("moves an entry to another day and resource, keeping the old day's notes", async () => {
    await patch("/v1/roadmap/diary/2026-03-02", { notes: "Kept." });
    const created = TimeEntryWriteSchema.parse(
      await (
        await post("/v1/roadmap/time-entries", {
          resource: "prompting-guide",
          startedAt: "2026-03-02T08:00:00+01:00",
          endedAt: "2026-03-02T09:00:00+01:00",
        })
      ).json(),
    );
    const id = created.entries[0]?.id ?? "";

    const updated = await patch(`/v1/roadmap/time-entries/${id}`, {
      resource: "prompting-drills",
      startedAt: "2026-03-05T08:00:00+01:00",
      endedAt: "2026-03-05T08:45:00+01:00",
    });
    expect(updated.status).toBe(200);
    const write = TimeEntryWriteSchema.parse(await updated.json());
    expect(write.dates).toEqual(["2026-03-02", "2026-03-05"]);
    expect(write.entries[0]).toMatchObject({ id, date: "2026-03-05", durationSeconds: 2700 });

    expect(await day("2026-03-02")).toMatchObject({ notes: "Kept.", entries: [], totalSeconds: 0 });
    expect((await day("2026-03-05")).entries[0]?.resource?.slug).toBe("prompting-drills");

    expect((await remove(`/v1/roadmap/time-entries/${id}`)).status).toBe(204);
    expect((await request("/v1/roadmap/diary/2026-03-05")).status).toBe(404);
    expect((await remove(`/v1/roadmap/time-entries/${id}`)).status).toBe(404);
    const missing = await patch(`/v1/roadmap/time-entries/${id}`, {
      endedAt: acrossMidnight.endedAt,
    });
    expect(missing.status).toBe(404);
  });

  it("refuses an overlap across resources with a conflict and writes nothing, but allows adjacency", async () => {
    expect((await post("/v1/roadmap/time-entries", acrossMidnight)).status).toBe(201);

    const overlapping = await post("/v1/roadmap/time-entries", {
      resource: "prompting-drills",
      startedAt: "2026-03-03T00:15:00+01:00",
      endedAt: "2026-03-03T01:00:00+01:00",
    });
    expect(overlapping.status).toBe(409);
    expect((await errorOf(overlapping)).code).toBe("conflict");
    expect((await day("2026-03-03")).totalSeconds).toBe(1800);

    const adjacent = await post("/v1/roadmap/time-entries", {
      resource: "prompting-drills",
      startedAt: "2026-03-03T00:30:00+01:00",
      endedAt: "2026-03-03T01:00:00+01:00",
    });
    expect(adjacent.status).toBe(201);
    expect((await day("2026-03-03")).totalSeconds).toBe(3600);
  });

  it("refuses one of two concurrent overlapping writes and keeps the other whole", async () => {
    const sessions = [acrossMidnight, { ...acrossMidnight, resource: "prompting-drills" }];
    const statuses = (
      await Promise.all(sessions.map(async (session) => post("/v1/roadmap/time-entries", session)))
    ).map((response) => response.status);

    expect(statuses.sort()).toEqual([201, 409]);
    const days = (await diary()).days;
    expect(days.map(({ date, totalSeconds }) => [date, totalSeconds])).toEqual([
      ["2026-03-03", 1800],
      ["2026-03-02", 1800],
    ]);
    expect(new Set(days.flatMap((d) => d.entries.map((e) => e.resource?.slug))).size).toBe(1);
  });

  it("refuses an unknown resource, an end not after the start and a fraction of a second, naming the field", async () => {
    for (const [body, path] of [
      [{ ...acrossMidnight, resource: "no-such-resource" }, "resource"],
      [{ ...acrossMidnight, endedAt: acrossMidnight.startedAt }, "endedAt"],
      [{ ...acrossMidnight, startedAt: "2026-03-02T23:30:00.5+01:00" }, "startedAt"],
    ] as const) {
      const response = await post("/v1/roadmap/time-entries", body);
      expect(response.status, path).toBe(400);
      const error = await errorOf(response);
      expect(error.code).toBe("validation_failed");
      expect(error.fields?.map((field) => field.path)).toContain(path);
    }
    expect(await diary()).toEqual({ days: [] });
  });

  it("logs a session with notes in one write, appending to the start day's notes", async () => {
    await patch("/v1/roadmap/diary/2026-03-02", { notes: "Earlier notes." });

    const logged = await post("/v1/roadmap/sessions", {
      ...acrossMidnight,
      notes: "Late chapter.",
    });
    expect(logged.status).toBe(201);
    const write = TimeEntryWriteSchema.parse(await logged.json());
    expect(write.dates).toEqual(["2026-03-02", "2026-03-03"]);
    expect(write.entries.map((entry) => entry.durationSeconds)).toEqual([1800, 1800]);
    expect(await day("2026-03-02")).toMatchObject({
      notes: "Earlier notes.\n\nLate chapter.",
      totalSeconds: 1800,
    });
    expect(await day("2026-03-03")).toMatchObject({ notes: null, totalSeconds: 1800 });
  });

  it("refuses an overlapping session with a conflict and keeps the notes as they were", async () => {
    await patch("/v1/roadmap/diary/2026-03-02", { notes: "Earlier notes." });
    expect((await post("/v1/roadmap/time-entries", acrossMidnight)).status).toBe(201);

    const refused = await post("/v1/roadmap/sessions", {
      resource: "prompting-drills",
      startedAt: "2026-03-02T23:00:00+01:00",
      endedAt: "2026-03-02T23:45:00+01:00",
      notes: "Must not stay.",
    });
    expect(refused.status).toBe(409);
    expect((await errorOf(refused)).code).toBe("conflict");
    expect(await day("2026-03-02")).toMatchObject({ notes: "Earlier notes.", totalSeconds: 1800 });
  });

  it("refuses a session on an unknown resource and malformed sessions, naming the field", async () => {
    const unknown = await post("/v1/roadmap/sessions", { ...acrossMidnight, resource: "missing" });
    expect(unknown.status).toBe(400);
    expect((await errorOf(unknown)).fields?.map((field) => field.path)).toEqual(["resource"]);
    const statuses = [
      (await post("/v1/roadmap/sessions", { ...acrossMidnight, startedAt: "2026-03-02T23:30:00" }))
        .status,
      (await post("/v1/roadmap/sessions", { ...acrossMidnight, notes: " " })).status,
      (await post("/v1/roadmap/sessions", { ...acrossMidnight, minutes: 60 })).status,
    ];
    expect(statuses).toEqual([400, 400, 400]);
    expect(await diary()).toEqual({ days: [] });
  });

  it("refuses malformed input before the service", async () => {
    const statuses = [
      (await request("/v1/roadmap/diary/2026-02-30")).status,
      (await patch("/v1/roadmap/diary/yesterday", { notes: "Text." })).status,
      (await patch("/v1/roadmap/diary/2026-03-02", { notes: "   " })).status,
      (await patch("/v1/roadmap/diary/2026-03-02", { notes: "Text.", extra: true })).status,
      (
        await post("/v1/roadmap/time-entries", {
          ...acrossMidnight,
          startedAt: "2026-03-02T23:30:00",
        })
      ).status,
      (await post("/v1/roadmap/time-entries", { resource: "prompting-guide" })).status,
      (await patch("/v1/roadmap/time-entries/not-a-uuid", { endedAt: acrossMidnight.endedAt }))
        .status,
      (await remove("/v1/roadmap/time-entries/not-a-uuid")).status,
    ];
    expect(statuses).toEqual(Array<number>(statuses.length).fill(400));
    expect(await diary()).toEqual({ days: [] });
  });

  it("refuses every diary write without a valid key and writes nothing", async () => {
    const id = "00000000-0000-4000-8000-000000000000";
    const statuses = [
      (await request("/v1/roadmap/diary/2026-03-02", "PATCH", json({ notes: "Text." }))).status,
      (await request("/v1/roadmap/diary/2026-03-02", "DELETE")).status,
      (await request("/v1/roadmap/time-entries", "POST", json(acrossMidnight))).status,
      (
        await request(
          "/v1/roadmap/time-entries",
          "POST",
          json(acrossMidnight, bearer("sk_not_a_real_key")),
        )
      ).status,
      (await request(`/v1/roadmap/time-entries/${id}`, "PATCH", json({}))).status,
      (await request(`/v1/roadmap/time-entries/${id}`, "DELETE")).status,
      (await request("/v1/roadmap/sessions", "POST", json(acrossMidnight))).status,
    ];
    expect(statuses).toEqual(Array<number>(statuses.length).fill(401));
    expect(await diary()).toEqual({ days: [] });
  });
});
