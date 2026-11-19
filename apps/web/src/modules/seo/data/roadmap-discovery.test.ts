import { describe, expect, it } from "vitest";

import type { HomepageProfile } from "../../profile";
import { discoveryResult, roadmapPaths, type DiscoveryReads } from "./roadmap-discovery";

// Only what the discovery reads; the rest of the profile does not matter here.
const PROFILE = { name: "Robin Example" } as HomepageProfile;

const AREAS = [
  {
    slug: "signal-area",
    name: "Signal area",
    description: "Learns **signals**.",
    modules: [
      { slug: "signal-basics", name: "Signal basics", description: null },
      { slug: "odd/slug", name: "Odd", description: "An odd one." },
    ],
  },
  { slug: "quiet-area", name: "Quiet area", description: null, modules: [] },
];

function reads(overrides: Partial<DiscoveryReads> = {}): DiscoveryReads {
  return {
    homepage: { status: "ready", profile: PROFILE },
    roadmap: { status: "ready", content: { roadmap: { areas: AREAS } } },
    diary: {
      status: "ready",
      content: { diary: { days: [{ date: "2026-03-02" }, { date: "2026-03-01" }] } },
    },
    bookshelf: {
      status: "ready",
      content: {
        books: [
          { book: { slug: "quiet-orbit", title: "The Quiet Orbit", author: "Ada Example" } },
          { book: { slug: "notes", title: "Untitled Notes", author: null } },
        ],
      },
    },
    ...overrides,
  };
}

describe("discoveryResult", () => {
  it("gathers the profile and the roadmap's pages while every read is ready", () => {
    expect(discoveryResult(reads())).toEqual({
      status: "ready",
      profile: PROFILE,
      roadmap: {
        areas: AREAS,
        diaryDates: ["2026-03-02", "2026-03-01"],
        books: [
          { slug: "quiet-orbit", title: "The Quiet Orbit", author: "Ada Example" },
          { slug: "notes", title: "Untitled Notes", author: null },
        ],
      },
    });
  });

  it("is missing while the person is not published", () => {
    expect(
      discoveryResult(
        reads({
          homepage: { status: "missing" },
          roadmap: { status: "missing" },
          diary: { status: "missing" },
          bookshelf: { status: "missing" },
        }),
      ),
    ).toEqual({ status: "missing" });
  });

  it.each(["homepage", "roadmap", "diary", "bookshelf"] as const)(
    "is unavailable while the %s cannot be read, never a document without it",
    (read) => {
      expect(discoveryResult(reads({ [read]: { status: "unavailable" } }))).toEqual({
        status: "unavailable",
      });
      expect(
        discoveryResult(
          reads({ homepage: { status: "missing" }, [read]: { status: "unavailable" } }),
        ),
      ).toEqual({ status: "unavailable" });
    },
  );

  it.each(["roadmap", "diary", "bookshelf"] as const)(
    "is missing while the %s is not published, even with the profile ready",
    (read) => {
      expect(discoveryResult(reads({ [read]: { status: "missing" } }))).toEqual({
        status: "missing",
      });
    },
  );
});

describe("roadmapPaths", () => {
  it("lists every roadmap page: the overview, areas with their modules, the diary, its days and statistics, the events, the bookshelf, its books and the reading guide", () => {
    const result = discoveryResult(reads());
    if (result.status !== "ready") throw new Error("expected a ready result");
    expect(roadmapPaths(result.roadmap)).toEqual([
      "/ai-roadmap",
      "/ai-roadmap/signal-area",
      "/ai-roadmap/signal-area/signal-basics",
      "/ai-roadmap/signal-area/odd%2Fslug",
      "/ai-roadmap/quiet-area",
      "/ai-roadmap/diary",
      "/ai-roadmap/diary/2026-03-02",
      "/ai-roadmap/diary/2026-03-01",
      "/ai-roadmap/diary/stats",
      "/ai-roadmap/events",
      "/ai-roadmap/bookshelf",
      "/ai-roadmap/bookshelf/quiet-orbit",
      "/ai-roadmap/bookshelf/notes",
      "/ai-roadmap/how-to-read-effectively",
    ]);
  });

  it("lists the roadmap's own pages even without areas, days or books", () => {
    expect(roadmapPaths({ areas: [], diaryDates: [], books: [] })).toEqual([
      "/ai-roadmap",
      "/ai-roadmap/diary",
      "/ai-roadmap/diary/stats",
      "/ai-roadmap/events",
      "/ai-roadmap/bookshelf",
      "/ai-roadmap/how-to-read-effectively",
    ]);
  });
});
