import { describe, expect, it } from "vitest";

import type { RoadmapEvent } from "@sebela/api-client";

import { EVENTS_PATH, toEventsPage } from "./events";

const STAMP = "2026-01-01T00:00:00.000Z";

function event(slug: string, fields: Partial<RoadmapEvent> = {}): RoadmapEvent {
  return {
    id: "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f",
    slug,
    name: `Fictional ${slug}`,
    kind: "conference",
    organizer: null,
    startsOn: "2026-03-02",
    endsOn: "2026-03-02",
    place: null,
    online: false,
    link: null,
    takeaways: null,
    topics: [],
    attendanceSeconds: 0,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...fields,
  };
}

function topic(slug: string, name: string) {
  return { id: "3d4e5f6a-7b8c-4d9e-8f0a-1b2c3d4e5f6a", slug, name, position: 0, ...stamps };
}

const stamps = { createdAt: STAMP, updatedAt: STAMP };

describe("EVENTS_PATH", () => {
  it("is the events section of the roadmap", () => {
    expect(EVENTS_PATH).toBe("/ai-roadmap/events");
  });
});

describe("toEventsPage", () => {
  it("groups events by the year they start in, keeping the API's newest-first order", () => {
    const page = toEventsPage([
      event("spring", { startsOn: "2026-03-02", endsOn: "2026-03-02" }),
      event("new-year", { startsOn: "2025-12-30", endsOn: "2026-01-02" }),
      event("autumn", { startsOn: "2025-10-01", endsOn: "2025-10-01" }),
      event("old", { startsOn: "2023-05-05", endsOn: "2023-05-05" }),
    ]);

    expect(page.years.map((year) => [year.year, year.events.map((row) => row.slug)])).toEqual([
      ["2026", ["spring"]],
      ["2025", ["new-year", "autumn"]],
      ["2023", ["old"]],
    ]);
  });

  it("is empty with no events", () => {
    expect(toEventsPage([])).toEqual({ years: [] });
  });

  it("gives a row its kind, period, details, topics, attendance and diary day", () => {
    const [year] = toEventsPage([
      event("summit", {
        name: "Fictional Summit",
        kind: "conference",
        organizer: "Fictional Society",
        place: "Brno",
        online: false,
        startsOn: "2025-12-30",
        endsOn: "2026-01-02",
        link: "https://example.test/summit",
        takeaways: "Learnt **much**.",
        topics: [topic("rag", "RAG"), topic("agents", "Agents")],
        attendanceSeconds: 5400,
      }),
    ]).years;

    expect(year?.events[0]).toEqual({
      slug: "summit",
      name: "Fictional Summit",
      kindLabel: "Conference",
      period: "December 30, 2025 – January 2, 2026",
      startsOn: "2025-12-30",
      endsOn: "2026-01-02",
      details: "Fictional Society · Brno",
      href: "https://example.test/summit",
      takeaways: "Learnt **much**.",
      topics: ["RAG", "Agents"],
      attendance: "1h 30m",
      diaryHref: "/ai-roadmap/diary/2025-12-30",
    });
  });

  it("says an event was online and leaves out what is unknown", () => {
    const [year] = toEventsPage([
      event("call", { kind: "meetup", online: true }),
      event("bare", { kind: "lecture" }),
    ]).years;

    expect(
      year?.events.map(({ kindLabel, details, attendance, takeaways, topics }) => ({
        kindLabel,
        details,
        attendance,
        takeaways,
        topics,
      })),
    ).toEqual([
      { kindLabel: "Meetup", details: "Online", attendance: null, takeaways: null, topics: [] },
      { kindLabel: "Lecture", details: null, attendance: null, takeaways: null, topics: [] },
    ]);
  });

  it("keeps an event's link only when it is safe", () => {
    const [year] = toEventsPage([
      event("script", { link: "javascript:alert(1)" }),
      event("data", { link: "data:text/html,<b>x</b>" }),
      event("relative", { link: "/somewhere" }),
      event("plain", { link: "http://example.test/plain" }),
    ]).years;

    expect(year?.events.map((row) => row.href)).toEqual([
      null,
      null,
      null,
      "http://example.test/plain",
    ]);
  });
});
