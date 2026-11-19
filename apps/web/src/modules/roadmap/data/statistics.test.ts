import { describe, expect, it } from "vitest";

import type { RoadmapStatistics } from "@sebela/api-client";

import { STATISTICS_NAME, STATISTICS_PATH, toStatisticsPage } from "./statistics";

const none = { totalSeconds: 0, resourceSeconds: 0, bookSeconds: 0, eventSeconds: 0 };

function split(resourceSeconds: number, bookSeconds: number, eventSeconds: number) {
  return {
    totalSeconds: resourceSeconds + bookSeconds + eventSeconds,
    resourceSeconds,
    bookSeconds,
    eventSeconds,
  };
}

// Three hours in all: 1h 30m on resources, 1h on a book and 30 min at an event, over two days.
const statistics: RoadmapStatistics = {
  totals: { ...split(5400, 3600, 1800), activeDays: 2 },
  days: [
    { date: "2026-02-23", ...split(1800, 0, 1800) },
    { date: "2026-03-02", ...split(3600, 3600, 0) },
  ],
  weeks: [
    { startsOn: "2026-02-23", ...split(1800, 0, 1800) },
    { startsOn: "2026-03-02", ...split(3600, 3600, 0) },
  ],
  months: [
    { month: "2026-02", ...split(1800, 0, 1800) },
    { month: "2026-03", ...split(3600, 3600, 0) },
  ],
  areas: [
    {
      slug: "orbit-foundations",
      name: "Orbit foundations",
      totalSeconds: 6000,
      resourceSeconds: 2400,
      bookSeconds: 3600,
      modules: [
        {
          slug: "signal-basics",
          name: "Signal basics",
          totalSeconds: 6000,
          resourceSeconds: 2400,
          bookSeconds: 3600,
        },
      ],
    },
    {
      slug: "quiet-systems",
      name: "Quiet systems",
      totalSeconds: 3000,
      resourceSeconds: 3000,
      bookSeconds: 0,
      modules: [
        {
          slug: "calm-queues",
          name: "Calm queues",
          totalSeconds: 2000,
          resourceSeconds: 2000,
          bookSeconds: 0,
        },
        {
          slug: "retry-notes",
          name: "Retry notes",
          totalSeconds: 1000,
          resourceSeconds: 1000,
          bookSeconds: 0,
        },
      ],
    },
  ],
  resources: [
    {
      slug: "signal-book",
      name: "A fictional book on signals",
      type: "book",
      category: "book",
      module: { slug: "signal-basics", name: "Signal basics" },
      area: { slug: "orbit-foundations", name: "Orbit foundations" },
      book: { slug: "quiet-orbit-handbook", title: "The Quiet Orbit Handbook" },
      totalSeconds: 3600,
    },
    {
      slug: "queue-guide",
      name: "A fictional queue guide",
      type: "link",
      category: "resource",
      module: { slug: "calm-queues", name: "Calm queues" },
      area: { slug: "quiet-systems", name: "Quiet systems" },
      book: null,
      totalSeconds: 2000,
    },
  ],
  events: [
    {
      slug: "spring-signals-lecture",
      name: "Spring signals lecture",
      kind: "lecture",
      startsOn: "2026-02-23",
      endsOn: "2026-02-24",
      totalSeconds: 1800,
    },
  ],
};

const empty: RoadmapStatistics = {
  totals: { ...none, activeDays: 0 },
  days: [],
  weeks: [],
  months: [],
  areas: [],
  resources: [],
  events: [],
};

describe("the statistics page's name and address", () => {
  it("is the diary's statistics", () => {
    expect(STATISTICS_NAME).toBe("Learning Statistics");
    expect(STATISTICS_PATH).toBe("/ai-roadmap/diary/stats");
  });
});

describe("toStatisticsPage", () => {
  it("shows the total time, the days with time and the average per day", () => {
    const page = toStatisticsPage(statistics);

    expect(page.empty).toBe(false);
    expect(page.figures).toEqual([
      { label: "Total time", value: "3h" },
      { label: "Study days", value: "2" },
      { label: "Avg per day", value: "1h 30m" },
    ]);
  });

  it("splits the total into resources, books and events, each with its share", () => {
    expect(toStatisticsPage(statistics).categories).toEqual([
      { label: "Resources", value: "1h 30m", share: "50.0%" },
      { label: "Books", value: "1h", share: "33.3%" },
      { label: "Events", value: "30 min", share: "16.7%" },
    ]);
  });

  it("measures areas and modules against study time, never against event attendance", () => {
    const page = toStatisticsPage(statistics);

    // Study time is the resources' and books' 2h 30m; the 30 min at the event is not part of it.
    expect(page.studyTime).toBe("2h 30m");
    expect(
      page.areas.map((area) => ({
        slug: area.slug,
        name: area.name,
        href: area.href,
        value: area.value,
        share: area.share,
        percent: area.percent,
      })),
    ).toEqual([
      {
        slug: "orbit-foundations",
        name: "Orbit foundations",
        href: "/ai-roadmap/orbit-foundations",
        value: "1h 40m",
        share: "66.7%",
        percent: (6000 / 9000) * 100,
      },
      {
        slug: "quiet-systems",
        name: "Quiet systems",
        href: "/ai-roadmap/quiet-systems",
        value: "50 min",
        share: "33.3%",
        percent: (3000 / 9000) * 100,
      },
    ]);
    expect(page.areas[1]?.modules).toEqual([
      {
        slug: "calm-queues",
        name: "Calm queues",
        href: "/ai-roadmap/quiet-systems/calm-queues",
        value: "33 min",
        share: "22.2%",
        percent: (2000 / 9000) * 100,
      },
      {
        slug: "retry-notes",
        name: "Retry notes",
        href: "/ai-roadmap/quiet-systems/retry-notes",
        value: "17 min",
        share: "11.1%",
        percent: (1000 / 9000) * 100,
      },
    ]);
  });

  it("computes shares from seconds, rounding only for display", () => {
    const page = toStatisticsPage({
      ...statistics,
      totals: { ...split(89, 0, 0), activeDays: 1 },
      areas: [
        {
          slug: "a",
          name: "A",
          totalSeconds: 89,
          resourceSeconds: 89,
          bookSeconds: 0,
          modules: [
            { slug: "m", name: "M", totalSeconds: 29, resourceSeconds: 29, bookSeconds: 0 },
            { slug: "n", name: "N", totalSeconds: 60, resourceSeconds: 60, bookSeconds: 0 },
          ],
        },
      ],
    });

    // 29 s rounds to no whole minute for display, yet its share is of the seconds themselves.
    expect(page.areas[0]?.modules.map(({ value, share }) => [value, share])).toEqual([
      ["<1 min", "32.6%"],
      ["1 min", "67.4%"],
    ]);
  });

  it("lists the recent days newest first, each leading to its diary day", () => {
    expect(toStatisticsPage(statistics).recentDays).toEqual([
      {
        key: "2026-03-02",
        label: "Monday, March 2, 2026",
        href: "/ai-roadmap/diary/2026-03-02",
        value: "2h",
        split: "1h resources · 1h books",
      },
      {
        key: "2026-02-23",
        label: "Monday, February 23, 2026",
        href: "/ai-roadmap/diary/2026-02-23",
        value: "1h",
        split: "30 min resources · 30 min events",
      },
    ]);
  });

  it("keeps only the ten most recent days", () => {
    const days = Array.from({ length: 12 }, (_, index) => ({
      date: `2026-01-${String(index + 1).padStart(2, "0")}`,
      ...split(60, 0, 0),
    }));

    const recent = toStatisticsPage({ ...statistics, days }).recentDays;

    expect(recent.map((day) => day.key)).toEqual([
      "2026-01-12",
      "2026-01-11",
      "2026-01-10",
      "2026-01-09",
      "2026-01-08",
      "2026-01-07",
      "2026-01-06",
      "2026-01-05",
      "2026-01-04",
      "2026-01-03",
    ]);
  });

  it("lists weeks by their Monday and months by name, newest first, an empty one as none", () => {
    const page = toStatisticsPage({
      ...statistics,
      weeks: [
        { startsOn: "2026-02-16", ...split(600, 0, 0) },
        { startsOn: "2026-02-23", ...none },
        { startsOn: "2026-03-02", ...split(0, 0, 7200) },
      ],
      months: [
        { month: "2025-12", ...split(0, 1200, 0) },
        { month: "2026-01", ...none },
      ],
    });

    expect(page.weeks).toEqual([
      {
        key: "2026-03-02",
        label: "Week of March 2, 2026",
        href: null,
        value: "2h",
        split: "2h events",
      },
      {
        key: "2026-02-23",
        label: "Week of February 23, 2026",
        href: null,
        value: "0 min",
        split: null,
      },
      {
        key: "2026-02-16",
        label: "Week of February 16, 2026",
        href: null,
        value: "10 min",
        split: "10 min resources",
      },
    ]);
    expect(page.months).toEqual([
      { key: "2026-01", label: "January 2026", href: null, value: "0 min", split: null },
      {
        key: "2025-12",
        label: "December 2025",
        href: null,
        value: "20 min",
        split: "20 min books",
      },
    ]);
  });

  it("keeps only the twelve most recent weeks and every month", () => {
    const weeks = Array.from({ length: 14 }, (_, index) => ({
      startsOn: new Date(Date.UTC(2026, 0, 5 + index * 7)).toISOString().slice(0, 10),
      ...split(60, 0, 0),
    }));
    const months = Array.from({ length: 14 }, (_, index) => ({
      month: new Date(Date.UTC(2025, index, 1)).toISOString().slice(0, 7),
      ...split(60, 0, 0),
    }));

    const page = toStatisticsPage({ ...statistics, weeks, months });

    expect(page.weeks).toHaveLength(12);
    expect(page.weeks[0]?.key).toBe("2026-04-06");
    expect(page.weeks.at(-1)?.key).toBe("2026-01-19");
    expect(page.months).toHaveLength(14);
    expect(page.months[0]?.key).toBe("2026-02");
  });

  it("links each resource to its place on its module's page and a book's resource to the book", () => {
    expect(toStatisticsPage(statistics).resources).toEqual([
      {
        slug: "signal-book",
        name: "A fictional book on signals",
        href: "/ai-roadmap/orbit-foundations/signal-basics#resource-signal-book",
        typeLabel: "Book",
        categoryLabel: "Book",
        place: "Signal basics · Orbit foundations",
        book: {
          title: "The Quiet Orbit Handbook",
          href: "/ai-roadmap/bookshelf/quiet-orbit-handbook",
        },
        value: "1h",
      },
      {
        slug: "queue-guide",
        name: "A fictional queue guide",
        href: "/ai-roadmap/quiet-systems/calm-queues#resource-queue-guide",
        typeLabel: "Link",
        categoryLabel: "Resource",
        place: "Calm queues · Quiet systems",
        book: null,
        value: "33 min",
      },
    ]);
  });

  it("lists each event's attendance apart, leading to the diary's page of its first day", () => {
    expect(toStatisticsPage(statistics).events).toEqual([
      {
        slug: "spring-signals-lecture",
        name: "Spring signals lecture",
        kindLabel: "Lecture",
        period: "February 23–24, 2026",
        startsOn: "2026-02-23",
        diaryHref: "/ai-roadmap/diary/2026-02-23",
        value: "30 min",
      },
    ]);
  });

  it("leads back through the roadmap and the diary", () => {
    expect(toStatisticsPage(statistics).breadcrumbs).toEqual([
      { name: "AI Engineering Roadmap", href: "/ai-roadmap" },
      { name: "Learning Diary", href: "/ai-roadmap/diary" },
      { name: "Learning Statistics", href: "/ai-roadmap/diary/stats" },
    ]);
  });

  it("is empty with no logged time, with zero figures and no shares that divide by zero", () => {
    const page = toStatisticsPage(empty);

    expect(page.empty).toBe(true);
    expect(page.figures).toEqual([
      { label: "Total time", value: "0 min" },
      { label: "Study days", value: "0" },
      { label: "Avg per day", value: "0 min" },
    ]);
    expect(page.categories.map((category) => category.share)).toEqual(["0.0%", "0.0%", "0.0%"]);
    expect(page.studyTime).toBe("0 min");
    expect(page.areas).toEqual([]);
    expect(page.recentDays).toEqual([]);
    expect(page.weeks).toEqual([]);
    expect(page.months).toEqual([]);
    expect(page.resources).toEqual([]);
    expect(page.events).toEqual([]);
  });

  it("shows event attendance alone without study time in any area", () => {
    const page = toStatisticsPage({
      ...empty,
      totals: { ...split(0, 0, 3600), activeDays: 1 },
      days: [{ date: "2026-03-02", ...split(0, 0, 3600) }],
    });

    expect(page.empty).toBe(false);
    expect(page.studyTime).toBe("0 min");
    expect(page.areas).toEqual([]);
    expect(page.categories.map((category) => category.share)).toEqual(["0.0%", "0.0%", "100.0%"]);
  });
});
