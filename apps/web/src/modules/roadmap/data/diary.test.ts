import { describe, expect, it } from "vitest";

import type { Diary, DiaryDay, TimeEntry } from "@sebela/api-client";

import {
  diaryDayHref,
  formatDiaryDate,
  formatStudyTime,
  toDiaryDayPage,
  toDiaryList,
} from "./diary";

function entry(
  id: string,
  startedAt: string,
  endedAt: string,
  durationSeconds: number,
  resource: Partial<TimeEntry["resource"]> = {},
): TimeEntry {
  return {
    id,
    date: "2026-03-02",
    resource: {
      slug: `resource-${id}`,
      name: `Fictional resource ${id}`,
      type: "link",
      link: null,
      module: "first-module",
      area: "first-area",
      ...resource,
    },
    startedAt,
    endedAt,
    durationSeconds,
  };
}

const areas = [
  {
    slug: "first-area",
    name: "First area",
    modules: [
      { slug: "first-module", name: "First module" },
      { slug: "second-module", name: "Second module" },
    ],
  },
  { slug: "second-area", name: "Second area", modules: [{ slug: "third-module", name: "Third" }] },
];

describe("formatDiaryDate", () => {
  it("names the calendar day itself, never shifted by a time zone", () => {
    expect(formatDiaryDate("2026-03-02")).toBe("Monday, March 2, 2026");
    expect(formatDiaryDate("2025-12-31")).toBe("Wednesday, December 31, 2025");
    expect(formatDiaryDate("2026-01-01")).toBe("Thursday, January 1, 2026");
  });
});

describe("formatStudyTime", () => {
  it.each([
    [0, "0 min"],
    [1, "<1 min"],
    [29, "<1 min"],
    [30, "1 min"],
    [45 * 60, "45 min"],
    [59 * 60 + 29, "59 min"],
    [59 * 60 + 30, "1h"],
    [3600, "1h"],
    [5400, "1h 30m"],
    [2 * 3600 + 5 * 60 + 10, "2h 5m"],
    [26 * 3600, "26h"],
  ])("shows %i seconds as %s, rounded only for display", (seconds, label) => {
    expect(formatStudyTime(seconds)).toBe(label);
  });
});

describe("diaryDayHref", () => {
  it("keeps the date inside its own path segment under the diary", () => {
    expect(diaryDayHref("2026-03-02")).toBe("/ai-roadmap/diary/2026-03-02");
    expect(diaryDayHref("../x")).toBe("/ai-roadmap/diary/..%2Fx");
  });
});

describe("toDiaryList", () => {
  it("lists every day in the API's order with its total, sessions and notes", () => {
    const diary: Diary = {
      days: [
        {
          date: "2026-03-02",
          notes: "Worked on **signals**.",
          entries: [
            entry("a", "2026-03-02T08:00:00Z", "2026-03-02T09:00:00Z", 3600),
            entry("b", "2026-03-02T10:00:00Z", "2026-03-02T10:30:00Z", 1800),
          ],
          totalSeconds: 5400,
        },
        { date: "2026-03-01", notes: "Only notes today.", entries: [], totalSeconds: 0 },
        {
          date: "2026-02-27",
          notes: null,
          entries: [entry("c", "2026-02-27T08:00:00Z", "2026-02-27T08:20:00Z", 1200)],
          totalSeconds: 1200,
        },
      ],
    };

    expect(toDiaryList(diary)).toEqual({
      days: [
        {
          date: "2026-03-02",
          title: "Monday, March 2, 2026",
          href: "/ai-roadmap/diary/2026-03-02",
          total: "1h 30m",
          sessions: "2 sessions",
          notes: "Worked on **signals**.",
        },
        {
          date: "2026-03-01",
          title: "Sunday, March 1, 2026",
          href: "/ai-roadmap/diary/2026-03-01",
          total: null,
          sessions: null,
          notes: "Only notes today.",
        },
        {
          date: "2026-02-27",
          title: "Friday, February 27, 2026",
          href: "/ai-roadmap/diary/2026-02-27",
          total: "20 min",
          sessions: "1 session",
          notes: null,
        },
      ],
    });
  });

  it("is empty for an empty diary", () => {
    expect(toDiaryList({ days: [] })).toEqual({ days: [] });
  });
});

describe("toDiaryDayPage", () => {
  it("shows a day's sessions at their Prague wall-clock times, whatever the process's zone", () => {
    const day: DiaryDay = {
      date: "2026-03-02",
      notes: null,
      entries: [
        // 23:30 Prague (UTC+1) on the evening before is split by the API at Prague midnight.
        entry("late", "2026-03-02T22:30:00.000Z", "2026-03-02T23:00:00.000Z", 1800),
        entry("morning", "2026-03-02T07:05:00.000Z", "2026-03-02T08:35:00.000Z", 5400),
      ],
      totalSeconds: 7200,
    };

    const page = toDiaryDayPage(day, areas);

    expect(page.areas[0]?.modules[0]?.entries.map((e) => [e.start, e.end])).toEqual([
      ["08:05", "09:35"],
      ["23:30", "00:00"],
    ]);
  });

  it("follows Prague's summer time and the night the clocks go back", () => {
    const day: DiaryDay = {
      date: "2025-10-26",
      notes: null,
      entries: [
        // 01:30 summer time to 02:30 winter time: two actual hours.
        entry("dst", "2025-10-25T23:30:00.000Z", "2025-10-26T01:30:00.000Z", 7200),
      ],
      totalSeconds: 7200,
    };

    const [only] = toDiaryDayPage(day, areas).areas[0]?.modules[0]?.entries ?? [];

    expect(only).toMatchObject({ start: "01:30", end: "02:30", duration: "2h" });
  });

  it("groups sessions by area, then module, in the roadmap's order, each by its start", () => {
    const day: DiaryDay = {
      date: "2026-03-02",
      notes: "Notes.",
      entries: [
        entry("x", "2026-03-02T07:00:00Z", "2026-03-02T07:30:00Z", 1800, {
          area: "second-area",
          module: "third-module",
        }),
        entry("y", "2026-03-02T08:00:00Z", "2026-03-02T08:45:00Z", 2700, {
          module: "second-module",
        }),
        entry("z", "2026-03-02T09:00:00Z", "2026-03-02T09:10:00Z", 600),
        entry("w", "2026-03-02T06:00:00Z", "2026-03-02T06:10:00Z", 600),
      ],
      totalSeconds: 5700,
    };

    const page = toDiaryDayPage(day, areas);

    expect(
      page.areas.map((area) => [
        area.name,
        area.href,
        area.modules.map((module) => [module.name, module.href, module.entries.map((e) => e.id)]),
      ]),
    ).toEqual([
      [
        "First area",
        "/ai-roadmap/first-area",
        [
          ["First module", "/ai-roadmap/first-area/first-module", ["w", "z"]],
          ["Second module", "/ai-roadmap/first-area/second-module", ["y"]],
        ],
      ],
      [
        "Second area",
        "/ai-roadmap/second-area",
        [["Third", "/ai-roadmap/second-area/third-module", ["x"]]],
      ],
    ]);
  });

  it("keeps a session whose area or module the roadmap no longer names, by slug and unlinked", () => {
    const day: DiaryDay = {
      date: "2026-03-02",
      notes: null,
      entries: [
        entry("u", "2026-03-02T07:00:00Z", "2026-03-02T07:30:00Z", 1800, {
          area: "unknown-area",
          module: "unknown-module",
        }),
        entry("v", "2026-03-02T08:00:00Z", "2026-03-02T08:30:00Z", 1800, {
          module: "unknown-module",
        }),
        entry("k", "2026-03-02T09:00:00Z", "2026-03-02T09:30:00Z", 1800),
      ],
      totalSeconds: 5400,
    };

    const page = toDiaryDayPage(day, areas);

    expect(
      page.areas.map((area) => [
        area.name,
        area.href,
        area.modules.map((module) => [module.name, module.href]),
      ]),
    ).toEqual([
      [
        "First area",
        "/ai-roadmap/first-area",
        [
          ["First module", "/ai-roadmap/first-area/first-module"],
          ["unknown-module", null],
        ],
      ],
      ["unknown-area", null, [["unknown-module", null]]],
    ]);
  });

  it("gives each session its duration, its resource and a link only when it is safe", () => {
    const day: DiaryDay = {
      date: "2026-03-02",
      notes: null,
      entries: [
        entry("safe", "2026-03-02T07:00:00Z", "2026-03-02T07:45:00Z", 2700, {
          name: "Safe guide",
          type: "book",
          link: "https://example.test/guide",
        }),
        entry("unsafe", "2026-03-02T08:00:00Z", "2026-03-02T08:00:20Z", 20, {
          name: "Unsafe guide",
          link: "javascript:alert(1)",
        }),
      ],
      totalSeconds: 2720,
    };

    const entries = toDiaryDayPage(day, areas).areas[0]?.modules[0]?.entries;

    expect(entries).toEqual([
      {
        id: "safe",
        start: "08:00",
        end: "08:45",
        startedAt: "2026-03-02T07:00:00Z",
        endedAt: "2026-03-02T07:45:00Z",
        duration: "45 min",
        resource: {
          name: "Safe guide",
          typeLabel: "Book",
          href: "https://example.test/guide",
          bookHref: null,
        },
      },
      {
        id: "unsafe",
        start: "09:00",
        end: "09:00",
        startedAt: "2026-03-02T08:00:00Z",
        endedAt: "2026-03-02T08:00:20Z",
        duration: "<1 min",
        resource: { name: "Unsafe guide", typeLabel: "Link", href: null, bookHref: null },
      },
    ]);
  });

  it("leads a session on a book's resource to the book's page on the bookshelf", () => {
    const day: DiaryDay = {
      date: "2026-03-02",
      notes: null,
      entries: [
        entry("reading", "2026-03-02T07:00:00Z", "2026-03-02T08:00:00Z", 3600, {
          slug: "orbit-reading",
          type: "book",
        }),
        entry("other", "2026-03-02T09:00:00Z", "2026-03-02T10:00:00Z", 3600),
      ],
      totalSeconds: 7200,
    };

    const entries = toDiaryDayPage(day, areas, [{ resource: "orbit-reading", book: "quiet/orbit" }])
      .areas[0]?.modules[0]?.entries;

    expect(entries?.map((session) => session.resource.bookHref)).toEqual([
      "/ai-roadmap/bookshelf/quiet%2Forbit",
      null,
    ]);
  });

  it("gives the day's title, total, sessions, notes and the way from the overview", () => {
    const day: DiaryDay = {
      date: "2026-03-02",
      notes: "Learnt *much*.",
      entries: [entry("a", "2026-03-02T07:00:00Z", "2026-03-02T08:00:00Z", 3600)],
      totalSeconds: 3600,
    };

    expect(toDiaryDayPage(day, areas)).toMatchObject({
      date: "2026-03-02",
      title: "Monday, March 2, 2026",
      total: "1h",
      sessions: "1 session",
      notes: "Learnt *much*.",
      breadcrumbs: [
        { name: "AI Engineering Roadmap", href: "/ai-roadmap" },
        { name: "Learning Diary", href: "/ai-roadmap/diary" },
        { name: "Monday, March 2, 2026", href: "/ai-roadmap/diary/2026-03-02" },
      ],
    });
  });

  it("has no total, sessions or groups on a day with notes only", () => {
    const day: DiaryDay = {
      date: "2026-03-01",
      notes: "Just notes.",
      entries: [],
      totalSeconds: 0,
    };

    expect(toDiaryDayPage(day, areas)).toMatchObject({
      total: null,
      sessions: null,
      notes: "Just notes.",
      areas: [],
    });
  });
});
