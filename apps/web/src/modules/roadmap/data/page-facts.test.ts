import { describe, expect, it } from "vitest";

import type { DiaryDay, Roadmap, RoadmapEvent, RoadmapTreeArea } from "@sebela/api-client";

import {
  diaryDayPageFacts,
  diaryPageFacts,
  eventsPageFacts,
  overviewPageFacts,
  readingGuidePageFacts,
  statisticsPageFacts,
} from "./page-facts";

const STAMP = "2026-01-01T00:00:00.000Z";
const NAME = "Fictional Person";
const OVERVIEW = { name: "AI Engineering Roadmap", href: "/ai-roadmap" };
const DIARY = { name: "Learning Diary", href: "/ai-roadmap/diary" };

function area(slug: string, description: string | null = null): RoadmapTreeArea {
  return {
    id: "3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f",
    slug,
    name: `Fictional ${slug}`,
    description,
    weight: 10,
    position: 0,
    createdAt: STAMP,
    updatedAt: STAMP,
    progress: {
      completed: 0,
      total: 0,
      status: "planned",
      completedAt: null,
      lastUpdatedAt: null,
      estimatedMinutes: 0,
    },
    modules: [],
  };
}

function roadmap(areas: RoadmapTreeArea[]): Roadmap {
  return {
    summary: {
      areaCount: areas.length,
      moduleCount: 3,
      resourceCount: 5,
      completed: 0,
      total: 0,
      estimatedMinutes: 600,
      estimatedHours: 10,
      lastUpdatedAt: null,
    },
    areas,
  };
}

function day(date: string, notes: string | null = null): DiaryDay {
  return { date, notes, entries: [], events: [], totalSeconds: 0 };
}

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

describe("overviewPageFacts", () => {
  it("lists the areas in the roadmap's order under the overview's lead", () => {
    const facts = overviewPageFacts({
      name: NAME,
      headline: "A fictional headline",
      roadmap: roadmap([area("first", "The **first** area."), area("second")]),
      projectIdeas: [],
      followedSources: [],
      glossaryTerms: [],
    });

    expect(facts).toEqual({
      name: NAME,
      kind: "overview",
      breadcrumbs: [OVERVIEW],
      summary: expect.stringContaining("2 areas, 3 modules, 5 vetted resources") as unknown,
      areas: [
        { name: "Fictional first", href: "/ai-roadmap/first", description: "The **first** area." },
        { name: "Fictional second", href: "/ai-roadmap/second", description: null },
      ],
    });
  });
});

describe("diaryPageFacts", () => {
  it("lists the diary's days in its order, each with its date in words and its notes", () => {
    const facts = diaryPageFacts({
      name: NAME,
      headline: "A fictional headline",
      diary: { days: [day("2026-03-03", "Read **a chapter**."), day("2026-03-02")] },
    });

    expect(facts).toEqual({
      name: NAME,
      kind: "diary",
      breadcrumbs: [OVERVIEW, DIARY],
      summary: null,
      days: [
        {
          name: "Tuesday, March 3, 2026",
          href: "/ai-roadmap/diary/2026-03-03",
          description: "Read **a chapter**.",
        },
        { name: "Monday, March 2, 2026", href: "/ai-roadmap/diary/2026-03-02", description: null },
      ],
    });
  });
});

describe("diaryDayPageFacts", () => {
  it("is the day under the diary with its notes as the summary", () => {
    const facts = diaryDayPageFacts({
      name: NAME,
      headline: "A fictional headline",
      day: day("2026-03-02", "Practised _retrieval_."),
      areas: [],
      books: [],
    });

    expect(facts).toEqual({
      name: NAME,
      kind: "diary-day",
      breadcrumbs: [
        OVERVIEW,
        DIARY,
        { name: "Monday, March 2, 2026", href: "/ai-roadmap/diary/2026-03-02" },
      ],
      summary: "Practised _retrieval_.",
      date: "2026-03-02",
    });
  });
});

describe("statisticsPageFacts", () => {
  it("is the statistics under the diary", () => {
    expect(statisticsPageFacts({ name: NAME })).toEqual({
      name: NAME,
      kind: "statistics",
      breadcrumbs: [
        OVERVIEW,
        DIARY,
        { name: "Learning Statistics", href: "/ai-roadmap/diary/stats" },
      ],
      summary: null,
    });
  });
});

describe("eventsPageFacts", () => {
  it("lists the events in the page's order with a link only when it is safe", () => {
    const facts = eventsPageFacts({
      name: NAME,
      headline: "A fictional headline",
      events: [
        event("summit", {
          startsOn: "2026-04-01",
          endsOn: "2026-04-02",
          link: "https://summit.example.test/",
          place: "Fictional City",
          organizer: "Fictional Org",
        }),
        event("webinar", { online: true, link: "javascript:alert(1)" }),
      ],
    });

    expect(facts).toEqual({
      name: NAME,
      kind: "events",
      breadcrumbs: [OVERVIEW, { name: "Events", href: "/ai-roadmap/events" }],
      summary: null,
      events: [
        {
          name: "Fictional summit",
          startsOn: "2026-04-01",
          endsOn: "2026-04-02",
          href: "https://summit.example.test/",
          online: false,
          place: "Fictional City",
          organizer: "Fictional Org",
        },
        {
          name: "Fictional webinar",
          startsOn: "2026-03-02",
          endsOn: "2026-03-02",
          href: null,
          online: true,
          place: null,
          organizer: null,
        },
      ],
    });
  });
});

describe("readingGuidePageFacts", () => {
  it("is the guide under the bookshelf, based on its source, with its opening as the summary", () => {
    const facts = readingGuidePageFacts({ name: NAME });

    expect(facts).toEqual({
      name: NAME,
      kind: "reading-guide",
      breadcrumbs: [
        OVERVIEW,
        { name: "Bookshelf", href: "/ai-roadmap/bookshelf" },
        { name: "How to Read Effectively", href: "/ai-roadmap/how-to-read-effectively" },
      ],
      summary: expect.any(String) as unknown,
      basedOn: {
        name: "How to Remember Everything You Read",
        url: "https://www.youtube.com/watch?v=okHkUIW46ks&t=27s",
      },
    });
  });
});
