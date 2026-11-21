// The guard on the demo seed's titles: every page the fictional demo seed gives a title, from its
// real names read from the seed's files, stays within `TITLE_MAX` characters. The seed's files are
// read as data; nothing of the database package is imported.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { pageText, type IndexedPage } from "./page-metadata";
import { TITLE_MAX } from "./page-title";
import { roadmapPageMetadata, type RoadmapPageCrumb, type RoadmapPageFacts } from "./roadmap-page";

const SEED = new URL("../../../../../../packages/db/seed/demo/", import.meta.url);

function seed(file: string): unknown {
  return JSON.parse(readFileSync(new URL(file, SEED), "utf8"));
}

const person = seed("person.json") as { name: string; headline: string };
const areas = seed("roadmap-areas.json") as { slug: string; name: string }[];
const modules = seed("roadmap-modules.json") as { slug: string; area: string; name: string }[];
const books = seed("roadmap-books.json") as { slug: string; title: string }[];
const days = seed("roadmap-diary.json") as { date: string }[];

const ORIGIN = "https://site.example.test";

// The roadmap's own page names, as the roadmap module's breadcrumbs give them.
const OVERVIEW: RoadmapPageCrumb = { name: "AI Engineering Roadmap", href: "/ai-roadmap" };
const DIARY: RoadmapPageCrumb = { name: "Learning Diary", href: "/ai-roadmap/diary" };
const BOOKSHELF: RoadmapPageCrumb = { name: "Bookshelf", href: "/ai-roadmap/bookshelf" };

/** A diary day's name, as the roadmap module writes its date. */
const DIARY_DATE = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
});

const GRAPHEMES = new Intl.Segmenter("en", { granularity: "grapheme" });

function length(text: string): number {
  return Array.from(GRAPHEMES.segment(text)).length;
}

function roadmapTitle(...breadcrumbs: RoadmapPageCrumb[]): string {
  const facts: RoadmapPageFacts = {
    name: person.name,
    kind: "area",
    estimatedMinutes: 0,
    breadcrumbs,
    summary: null,
  };
  return roadmapPageMetadata(ORIGIN, facts).title as string;
}

function crumb(name: string): RoadmapPageCrumb {
  return { name, href: "/ai-roadmap/page" };
}

const titles: string[] = [
  ...(["home", "experience", "services", "cv"] as const satisfies readonly IndexedPage[]).map(
    (page) => pageText(ORIGIN, page, person).title,
  ),
  roadmapTitle(OVERVIEW),
  ...areas.map((area) => roadmapTitle(OVERVIEW, crumb(area.name))),
  ...modules.map((module) => {
    const area = areas.find((candidate) => candidate.slug === module.area);
    return roadmapTitle(OVERVIEW, crumb(area?.name ?? ""), crumb(module.name));
  }),
  roadmapTitle(OVERVIEW, DIARY),
  ...days.map((day) =>
    roadmapTitle(OVERVIEW, DIARY, crumb(DIARY_DATE.format(new Date(`${day.date}T00:00:00Z`)))),
  ),
  roadmapTitle(OVERVIEW, DIARY, crumb("Learning Statistics")),
  roadmapTitle(OVERVIEW, crumb("Events")),
  roadmapTitle(OVERVIEW, BOOKSHELF),
  ...books.map((book) => roadmapTitle(OVERVIEW, BOOKSHELF, crumb(book.title))),
  roadmapTitle(OVERVIEW, BOOKSHELF, crumb("How to Read Effectively")),
];

describe("the demo seed's titles", () => {
  it("reads every page the seed names", () => {
    expect(areas.length).toBeGreaterThan(0);
    expect(modules.length).toBeGreaterThan(0);
    expect(books.length).toBeGreaterThan(0);
    expect(days.length).toBeGreaterThan(0);
    expect(modules.every((module) => areas.some((area) => area.slug === module.area))).toBe(true);
  });

  it.each(titles)(`keeps "%s" within ${String(TITLE_MAX)} characters`, (title) => {
    expect(length(title)).toBeLessThanOrEqual(TITLE_MAX);
  });
});
