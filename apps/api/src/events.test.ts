import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  DiaryDaySchema,
  DiarySchema,
  RoadmapEventListSchema,
  RoadmapEventSchema,
  RoadmapSchema,
  TimeEntryWriteSchema,
  type Diary,
  type DiaryDay,
  type RoadmapEvent,
} from "@sebela/contracts";

import { bearer, connection, json, openTestBackend, type TestBackend } from "./test-support.js";

/** A small fictional roadmap with one resource, and one shared topic. */
const area = { slug: "basics", name: "Basics", weight: 100, position: 0 };
const module = { slug: "agents", area: "basics", name: "Agents", position: 0 };
const guide = {
  slug: "agents-guide",
  module: "agents",
  name: "A fictional agents guide",
  type: "link",
  position: 0,
  topics: ["fictional-agents"],
};
const topic = { slug: "fictional-agents", name: "Fictional agents", position: 0 };

/** A fictional three-day conference across the turn of the year. */
const summit = {
  slug: "fictional-summit",
  name: "Fictional Summit",
  kind: "conference",
  organizer: "Example Community",
  startsOn: "2025-12-31",
  endsOn: "2026-01-02",
  place: "Example Hall",
  link: "https://example.com/summit",
  takeaways: "A **fictional** note.",
  topics: ["fictional-agents"],
};

/** A fictional single-day online meetup; only the required fields. */
const meetup = {
  slug: "fictional-meetup",
  name: "Fictional Meetup",
  kind: "meetup",
  startsOn: "2026-03-10",
  endsOn: "2026-03-10",
};

/** Attendance on a winter day between two Prague wall-clock times. */
const attending = (date: string, from: string, to: string, event = summit.slug) => ({
  event,
  startedAt: `${date}T${from}:00+01:00`,
  endedAt: `${date}T${to}:00+01:00`,
});

interface FieldError {
  path: string;
  message: string;
}

describe("the roadmap events API", () => {
  let backend: TestBackend;
  let auth: Record<string, string>;

  beforeAll(async () => {
    backend = await openTestBackend();
    auth = bearer((await backend.services.apiKeys.createKey("event routes")).key);
    for (const [path, body] of [
      ["/v1/topics", topic],
      ["/v1/roadmap/areas", area],
      ["/v1/roadmap/modules", module],
      ["/v1/roadmap/resources", guide],
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
    for (const { slug } of await roadmap.listEvents()) await roadmap.deleteEvent(slug);
  });

  const request = (path: string, method = "GET", init: RequestInit = {}) =>
    backend.api().app.request(path, { method, ...init }, connection());
  const post = (path: string, body: object) => request(path, "POST", json(body, auth));
  const patch = (path: string, body: object) => request(path, "PATCH", json(body, auth));
  const remove = (path: string) => request(path, "DELETE", { headers: auth });
  const errorOf = async (response: Response) =>
    ((await response.json()) as { error: { code: string; fields?: FieldError[] } }).error;
  const events = async (): Promise<RoadmapEvent[]> => {
    const response = await request("/v1/roadmap/events");
    expect(response.status).toBe(200);
    return RoadmapEventListSchema.parse(await response.json());
  };
  const event = async (slug: string): Promise<RoadmapEvent> => {
    const response = await request(`/v1/roadmap/events/${slug}`);
    expect(response.status).toBe(200);
    return RoadmapEventSchema.parse(await response.json());
  };
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
  const expectRefusal = async (response: Response, status: number, code: string, path?: string) => {
    expect(response.status).toBe(status);
    const error = await errorOf(response);
    expect(error.code).toBe(code);
    if (path !== undefined) expect(error.fields?.map((field) => field.path)).toContain(path);
    return error;
  };

  it("reads no events as an empty list and a missing event as not found", async () => {
    expect(await events()).toEqual([]);
    await expectRefusal(await request("/v1/roadmap/events/no-such-event"), 404, "not_found");
  });

  it("creates events with defaults and reads them publicly, newest start first", async () => {
    const created = await post("/v1/roadmap/events", summit);
    expect(created.status).toBe(201);
    expect(created.headers.get("location")).toBe("/v1/roadmap/events/fictional-summit");
    const body = RoadmapEventSchema.parse(await created.json());
    expect(body).toMatchObject({ ...summit, online: false, topics: [], attendanceSeconds: 0 });
    expect(body.topics).toEqual([]);

    const minimal = await post("/v1/roadmap/events", meetup);
    expect(minimal.status).toBe(201);
    expect(RoadmapEventSchema.parse(await minimal.json())).toMatchObject({
      ...meetup,
      organizer: null,
      place: null,
      online: false,
      link: null,
      takeaways: null,
      topics: [],
    });

    expect((await events()).map(({ slug }) => slug)).toEqual([
      "fictional-meetup",
      "fictional-summit",
    ]);
    expect((await event("fictional-summit")).topics.map(({ slug }) => slug)).toEqual([
      "fictional-agents",
    ]);
  });

  it("refuses every event write without a valid API key and changes nothing", async () => {
    const anonymous = (path: string, method: string, body?: object) =>
      request(path, method, body ? json(body) : {});
    expect((await anonymous("/v1/roadmap/events", "POST", meetup)).status).toBe(401);
    expect((await post("/v1/roadmap/events", meetup)).status).toBe(201);
    const path = "/v1/roadmap/events/fictional-meetup";
    expect((await anonymous(path, "PATCH", { name: "Changed" })).status).toBe(401);
    expect((await anonymous(path, "DELETE")).status).toBe(401);
    const wrongKey = { authorization: "Bearer not-a-key" };
    expect((await request(path, "DELETE", { headers: wrongKey })).status).toBe(401);
    expect((await event("fictional-meetup")).name).toBe("Fictional Meetup");
  });

  it("refuses reversed dates, unknown or repeated topics and a taken slug with the common error", async () => {
    await expectRefusal(
      await post("/v1/roadmap/events", { ...meetup, endsOn: "2026-03-09" }),
      400,
      "validation_failed",
      "endsOn",
    );
    await expectRefusal(
      await post("/v1/roadmap/events", { ...meetup, topics: ["no-such-topic"] }),
      400,
      "validation_failed",
      "topics",
    );
    await expectRefusal(
      await post("/v1/roadmap/events", {
        ...meetup,
        topics: ["fictional-agents", "fictional-agents"],
      }),
      400,
      "validation_failed",
      "topics",
    );
    await expectRefusal(
      await post("/v1/roadmap/events", { ...meetup, kind: "party" }),
      400,
      "validation_failed",
      "kind",
    );
    expect(await events()).toEqual([]);

    expect((await post("/v1/roadmap/events", meetup)).status).toBe(201);
    await expectRefusal(await post("/v1/roadmap/events", meetup), 409, "conflict");
    // Judged with the stored start: the new end alone would be before it.
    await expectRefusal(
      await patch("/v1/roadmap/events/fictional-meetup", { endsOn: "2026-03-09" }),
      400,
      "validation_failed",
      "endsOn",
    );
    await expectRefusal(
      await patch("/v1/roadmap/events/no-such-event", { name: "Missing" }),
      404,
      "not_found",
    );
    expect(await event("fictional-meetup")).toMatchObject({ endsOn: "2026-03-10" });
  });

  it("updates only the fields sent, clears with null and replaces topics", async () => {
    expect((await post("/v1/roadmap/events", summit)).status).toBe(201);
    const updated = await patch("/v1/roadmap/events/fictional-summit", {
      organizer: null,
      online: true,
      topics: [],
    });
    expect(updated.status).toBe(200);
    expect(RoadmapEventSchema.parse(await updated.json())).toMatchObject({
      name: summit.name,
      organizer: null,
      online: true,
      place: summit.place,
      topics: [],
    });
  });

  it("shows an event on every Prague day of its range without notes, time or attendance", async () => {
    expect((await post("/v1/roadmap/events", summit)).status).toBe(201);
    const shown = { slug: summit.slug, name: summit.name, kind: summit.kind, link: summit.link };

    expect((await diary()).days.map(({ date }) => date)).toEqual([
      "2026-01-02",
      "2026-01-01",
      "2025-12-31",
    ]);
    expect(await day("2026-01-01")).toEqual({
      date: "2026-01-01",
      notes: null,
      entries: [],
      totalSeconds: 0,
      events: [{ ...shown, startsOn: "2025-12-31", endsOn: "2026-01-02" }],
    });

    // Moving the event moves its days: the old ones are gone, the new ones reachable.
    const moved = await patch("/v1/roadmap/events/fictional-summit", {
      startsOn: "2026-02-01",
      endsOn: "2026-02-01",
    });
    expect(moved.status).toBe(200);
    expect((await diary()).days.map(({ date }) => date)).toEqual(["2026-02-01"]);
    expect((await request("/v1/roadmap/diary/2026-01-01")).status).toBe(404);
    expect((await day("2026-02-01")).events.map(({ slug }) => slug)).toEqual([summit.slug]);

    expect((await remove("/v1/roadmap/events/fictional-summit")).status).toBe(204);
    expect(await diary()).toEqual({ days: [] });
    expect((await request("/v1/roadmap/events/fictional-summit")).status).toBe(404);
  });

  it("logs attendance on an event, split at Prague midnight, and derives its time", async () => {
    expect((await post("/v1/roadmap/events", summit)).status).toBe(201);
    const created = await post("/v1/roadmap/time-entries", {
      event: summit.slug,
      startedAt: "2025-12-31T23:00:00+01:00",
      endedAt: "2026-01-01T01:00:00+01:00",
    });
    expect(created.status).toBe(201);
    const write = TimeEntryWriteSchema.parse(await created.json());
    expect(write.dates).toEqual(["2025-12-31", "2026-01-01"]);
    expect(write.entries.map(({ date, durationSeconds }) => [date, durationSeconds])).toEqual([
      ["2025-12-31", 3600],
      ["2026-01-01", 3600],
    ]);
    expect(write.entries[0]).toMatchObject({
      resource: null,
      event: { slug: summit.slug, name: summit.name },
    });

    expect((await day("2025-12-31")).totalSeconds).toBe(3600);
    expect((await day("2026-01-02")).totalSeconds).toBe(0);
    expect((await event(summit.slug)).attendanceSeconds).toBe(7200);
  });

  it("refuses attendance outside the event, both or no targets and an unknown event, naming the field", async () => {
    expect((await post("/v1/roadmap/events", summit)).status).toBe(201);
    for (const [body, path] of [
      [attending("2025-12-30", "09:00", "10:00"), "startedAt"],
      [
        {
          event: summit.slug,
          startedAt: "2026-01-02T23:00:00+01:00",
          endedAt: "2026-01-03T00:30:00+01:00",
        },
        "endedAt",
      ],
      [{ ...attending("2026-01-01", "09:00", "10:00"), resource: guide.slug }, "event"],
      [
        { startedAt: "2026-01-01T09:00:00+01:00", endedAt: "2026-01-01T10:00:00+01:00" },
        "resource",
      ],
      [attending("2026-01-01", "09:00", "10:00", "no-such-event"), "event"],
    ] as const) {
      await expectRefusal(
        await post("/v1/roadmap/time-entries", body),
        400,
        "validation_failed",
        path,
      );
    }
    expect((await diary()).days.every((d) => d.entries.length === 0)).toBe(true);
  });

  it("rejects attendance overlapping time on a resource, also when written concurrently", async () => {
    expect((await post("/v1/roadmap/events", summit)).status).toBe(201);
    const study = {
      resource: guide.slug,
      startedAt: "2026-01-01T09:00:00+01:00",
      endedAt: "2026-01-01T10:00:00+01:00",
    };
    expect((await post("/v1/roadmap/time-entries", study)).status).toBe(201);
    await expectRefusal(
      await post("/v1/roadmap/time-entries", attending("2026-01-01", "09:30", "10:30")),
      409,
      "conflict",
    );
    expect(
      (await post("/v1/roadmap/time-entries", attending("2026-01-01", "10:00", "11:00"))).status,
    ).toBe(201);

    const racing = [
      attending("2026-01-02", "09:00", "10:00"),
      { ...study, startedAt: "2026-01-02T09:30:00+01:00", endedAt: "2026-01-02T10:30:00+01:00" },
    ];
    const statuses = (
      await Promise.all(racing.map(async (body) => post("/v1/roadmap/time-entries", body)))
    ).map((response) => response.status);
    expect(statuses.sort()).toEqual([201, 409]);
    expect((await day("2026-01-02")).entries).toHaveLength(1);
  });

  it("moves an entry between a resource and an event through the same update", async () => {
    expect((await post("/v1/roadmap/events", summit)).status).toBe(201);
    const created = await post("/v1/roadmap/time-entries", {
      resource: guide.slug,
      startedAt: "2026-01-01T09:00:00+01:00",
      endedAt: "2026-01-01T10:00:00+01:00",
    });
    const [entry] = TimeEntryWriteSchema.parse(await created.json()).entries;
    const updated = await patch(`/v1/roadmap/time-entries/${entry?.id ?? ""}`, {
      event: summit.slug,
    });
    expect(updated.status).toBe(200);
    expect(TimeEntryWriteSchema.parse(await updated.json()).entries[0]).toMatchObject({
      resource: null,
      event: { slug: summit.slug },
    });
    expect((await event(summit.slug)).attendanceSeconds).toBe(3600);
  });

  it("refuses a date edit that strands attendance and a delete that would erase it", async () => {
    expect((await post("/v1/roadmap/events", summit)).status).toBe(201);
    expect(
      (await post("/v1/roadmap/time-entries", attending("2026-01-02", "09:00", "10:00"))).status,
    ).toBe(201);

    const error = await expectRefusal(
      await patch("/v1/roadmap/events/fictional-summit", { endsOn: "2026-01-01", name: "Renamed" }),
      409,
      "conflict",
    );
    expect(JSON.stringify(error)).toContain("2026-01-02");
    await expectRefusal(await remove("/v1/roadmap/events/fictional-summit"), 409, "conflict");

    expect(await event("fictional-summit")).toMatchObject({
      name: summit.name,
      endsOn: "2026-01-02",
      attendanceSeconds: 3600,
    });
    expect((await day("2026-01-02")).entries).toHaveLength(1);
  });

  it("keeps events out of the roadmap tree and its resources", async () => {
    expect((await post("/v1/roadmap/events", summit)).status).toBe(201);
    const response = await request("/v1/roadmap");
    const tree = RoadmapSchema.parse(await response.json());
    const slugs = tree.areas
      .flatMap((a) => a.modules)
      .flatMap((m) => m.resources.map((r) => r.slug));
    expect(slugs).toEqual([guide.slug]);
  });
});
