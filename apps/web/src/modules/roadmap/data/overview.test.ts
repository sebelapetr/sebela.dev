import { describe, expect, it } from "vitest";

import type {
  Roadmap,
  RoadmapProgress,
  RoadmapTreeArea,
  RoadmapTreeModule,
  RoadmapTreeResource,
} from "@sebela/api-client";

import {
  estimateLabel,
  formatLastUpdated,
  roadmapLead,
  resourceTypeLabel,
  romanNumeral,
  safeLink,
  toRoadmapOverview,
  weightLabel,
  weightLevel,
} from "./overview";

const STAMP = "2026-01-01T00:00:00.000Z";

function progress(overrides: Partial<RoadmapProgress> = {}): RoadmapProgress {
  return {
    completed: 0,
    total: 0,
    status: "planned",
    completedAt: null,
    lastUpdatedAt: null,
    estimatedMinutes: 0,
    ...overrides,
  };
}

function resource(slug: string, overrides: Partial<RoadmapTreeResource> = {}): RoadmapTreeResource {
  return {
    id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
    slug,
    name: `Fictional ${slug}`,
    description: null,
    type: "link",
    status: "planned",
    estimatedMinutes: null,
    startedAt: null,
    finishedAt: null,
    link: null,
    book: null,
    position: 0,
    topics: [],
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  };
}

function module(slug: string, overrides: Partial<RoadmapTreeModule> = {}): RoadmapTreeModule {
  return {
    id: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e",
    slug,
    name: `Fictional ${slug}`,
    description: null,
    position: 0,
    createdAt: STAMP,
    updatedAt: STAMP,
    progress: progress(),
    resources: [],
    ...overrides,
  };
}

function area(slug: string, overrides: Partial<RoadmapTreeArea> = {}): RoadmapTreeArea {
  return {
    id: "3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f",
    slug,
    name: `Fictional ${slug}`,
    description: null,
    weight: 10,
    position: 0,
    createdAt: STAMP,
    updatedAt: STAMP,
    progress: progress(),
    modules: [],
    ...overrides,
  };
}

function roadmap(areas: RoadmapTreeArea[], summary: Partial<Roadmap["summary"]> = {}): Roadmap {
  return {
    summary: {
      areaCount: areas.length,
      moduleCount: 0,
      resourceCount: 0,
      completed: 0,
      total: 0,
      estimatedMinutes: 0,
      estimatedHours: 0,
      lastUpdatedAt: null,
      ...summary,
    },
    areas,
  };
}

describe("toRoadmapOverview", () => {
  it("states the API's totals and last update, never totals of its own", () => {
    const overview = toRoadmapOverview(
      roadmap([area("only")], {
        areaCount: 4,
        moduleCount: 11,
        resourceCount: 23,
        estimatedMinutes: 2770,
        estimatedHours: 46,
        lastUpdatedAt: "2026-03-14T09:30:00.000Z",
      }),
    );

    expect(overview.facts).toEqual({
      areaCount: 4,
      moduleCount: 11,
      resourceCount: 23,
      estimatedHours: 46,
      lastUpdated: "March 14, 2026",
    });
  });

  it("leaves the last update out when nothing has been updated", () => {
    expect(toRoadmapOverview(roadmap([])).facts.lastUpdated).toBeNull();
  });

  it("starts at the first area in the API's order and has no start without areas", () => {
    const overview = toRoadmapOverview(roadmap([area("first-area"), area("second-area")]));

    expect(overview.start).toEqual({
      name: "Fictional first-area",
      href: "/ai-roadmap/first-area",
    });
    expect(toRoadmapOverview(roadmap([])).start).toBeNull();
  });

  it("numbers areas and modules by their place in the API's order, not their stored position", () => {
    const overview = toRoadmapOverview(
      roadmap([
        area("a", { position: 0, modules: [module("m1", { position: 0 }), module("m2")] }),
        area("b", { position: 7, modules: [module("m3", { position: 4 })] }),
      ]),
    );

    expect(overview.areas.map((row) => row.order)).toEqual(["1.", "2."]);
    expect(overview.areas.map((row) => row.modules.map((m) => m.order))).toEqual([
      ["I.", "II."],
      ["I."],
    ]);
  });

  it("shows each area's own progress, weight and status from the API", () => {
    const [row] = toRoadmapOverview(
      roadmap([
        area("current-area", {
          name: "Current area",
          description: "Made-up **Markdown**.",
          weight: 25,
          progress: progress({ completed: 3, total: 7, status: "in-progress" }),
        }),
      ]),
    ).areas;

    expect(row).toMatchObject({
      slug: "current-area",
      name: "Current area",
      description: "Made-up **Markdown**.",
      href: "/ai-roadmap/current-area",
      weight: 25,
      weightLevel: 3,
      weightLabel: "High weight (>14%)",
      completed: 3,
      total: 7,
      status: "in-progress",
      current: true,
    });
  });

  it.each([
    ["planned", false],
    ["completed", false],
    ["in-progress", true],
  ] as const)("marks a %s area as current: %s", (status, current) => {
    const [row] = toRoadmapOverview(roadmap([area("a", { progress: progress({ status }) })])).areas;

    expect(row?.current).toBe(current);
  });

  it("keeps an empty area and an empty module as they are, with nothing to complete", () => {
    const [row] = toRoadmapOverview(roadmap([area("empty", { modules: [module("none")] })])).areas;

    expect(row).toMatchObject({ completed: 0, total: 0, status: "planned" });
    expect(row?.modules[0]).toMatchObject({
      completed: 0,
      total: 0,
      status: "planned",
      estimate: null,
      resources: [],
    });
  });

  it("gives a module the API's planned estimate, or none when nothing is estimated", () => {
    const [row] = toRoadmapOverview(
      roadmap([
        area("a", {
          modules: [
            module("estimated", {
              progress: progress({ completed: 1, total: 4, estimatedMinutes: 150 }),
            }),
            module("unestimated", { progress: progress({ total: 2, estimatedMinutes: 0 }) }),
          ],
        }),
      ]),
    ).areas;

    expect(row?.modules.map((m) => [m.slug, m.estimate, m.completed, m.total])).toEqual([
      ["estimated", "2.5h", 1, 4],
      ["unestimated", null, 0, 2],
    ]);
  });

  it("maps every resource with its type, status, estimate and safe link", () => {
    const [row] = toRoadmapOverview(
      roadmap([
        area("a", {
          modules: [
            module("m", {
              resources: [
                resource("paper", {
                  name: "A fictional paper",
                  description: "Read *slowly*.",
                  type: "text",
                  status: "completed",
                  estimatedMinutes: 45,
                  link: "https://example.test/paper",
                }),
                resource("unknown", { status: "skipped", estimatedMinutes: null, link: null }),
                resource("unsafe", { link: "javascript:alert(1)" }),
              ],
            }),
          ],
        }),
      ]),
    ).areas;

    expect(row?.modules[0]?.resources).toEqual([
      {
        slug: "paper",
        name: "A fictional paper",
        description: "Read *slowly*.",
        type: "text",
        typeLabel: "Text",
        status: "completed",
        estimate: "45m",
        href: "https://example.test/paper",
        bookHref: null,
      },
      {
        slug: "unknown",
        name: "Fictional unknown",
        description: null,
        type: "link",
        typeLabel: "Link",
        status: "skipped",
        estimate: null,
        href: null,
        bookHref: null,
      },
      {
        slug: "unsafe",
        name: "Fictional unsafe",
        description: null,
        type: "link",
        typeLabel: "Link",
        status: "planned",
        estimate: null,
        href: null,
        bookHref: null,
      },
    ]);
  });

  it("leads a resource of a book to the book's page on the bookshelf", () => {
    const [row] = toRoadmapOverview(
      roadmap([
        area("first-area", {
          modules: [
            module("first-module", {
              resources: [
                resource("reading", { type: "book", book: "quiet-orbit" }),
                resource("odd", { type: "book", book: "a/b?c" }),
              ],
            }),
          ],
        }),
      ]),
    ).areas;

    expect(row?.modules[0]?.resources.map((r) => r.bookHref)).toEqual([
      "/ai-roadmap/bookshelf/quiet-orbit",
      "/ai-roadmap/bookshelf/a%2Fb%3Fc",
    ]);
  });

  it("builds an area's address from its slug without letting the slug leave the roadmap", () => {
    const [row] = toRoadmapOverview(roadmap([area("../x?y#z")])).areas;

    expect(row?.href).toBe("/ai-roadmap/..%2Fx%3Fy%23z");
  });

  it("links every module to its own page under its area", () => {
    const [row] = toRoadmapOverview(
      roadmap([area("first-area", { modules: [module("first-module"), module("a/b")] })]),
    ).areas;

    expect(row?.modules.map((m) => m.href)).toEqual([
      "/ai-roadmap/first-area/first-module",
      "/ai-roadmap/first-area/a%2Fb",
    ]);
  });
});

describe("estimateLabel", () => {
  it.each([
    [1, "1m"],
    [45, "45m"],
    [59, "59m"],
    [60, "1h"],
    [120, "2h"],
    [90, "1.5h"],
    [100, "1.7h"],
    [1500, "25h"],
  ])("labels %i minutes as %s", (minutes, label) => {
    expect(estimateLabel(minutes)).toBe(label);
  });
});

describe("romanNumeral", () => {
  it.each([
    [1, "I"],
    [2, "II"],
    [4, "IV"],
    [9, "IX"],
    [14, "XIV"],
    [40, "XL"],
    [49, "XLIX"],
    [99, "XCIX"],
  ])("writes %i as %s", (value, numeral) => {
    expect(romanNumeral(value)).toBe(numeral);
  });
});

describe("weight", () => {
  it.each([
    [1, 1, "Low weight (≤8%)"],
    [8, 1, "Low weight (≤8%)"],
    [9, 2, "Medium weight (9-14%)"],
    [14, 2, "Medium weight (9-14%)"],
    [15, 3, "High weight (>14%)"],
    [100, 3, "High weight (>14%)"],
  ])("shows a weight of %i%% as %i dots, %s", (weight, level, label) => {
    expect(weightLevel(weight)).toBe(level);
    expect(weightLabel(weight)).toBe(label);
  });
});

describe("formatLastUpdated", () => {
  it("names the day in Prague, in words", () => {
    expect(formatLastUpdated("2026-07-04T12:00:00.000Z")).toBe("July 4, 2026");
    // Just before midnight UTC is already the next day in Prague.
    expect(formatLastUpdated("2026-12-31T23:30:00.000Z")).toBe("January 1, 2027");
  });
});

describe("resourceTypeLabel", () => {
  it.each([
    ["youtube-video", "Video"],
    ["youtube-playlist", "Playlist"],
    ["video", "Video"],
    ["google-drive", "Drive"],
    ["link", "Link"],
    ["text", "Text"],
    ["project", "Repo"],
    ["book", "Book"],
  ] as const)("calls %s %s", (type, label) => {
    expect(resourceTypeLabel(type)).toBe(label);
  });
});

describe("safeLink", () => {
  it.each(["https://example.test/a", "http://example.test/b?c=d"])("keeps %s", (link) => {
    expect(safeLink(link)).toBe(link);
  });

  it.each([
    null,
    "",
    "javascript:alert(1)",
    "JAVASCRIPT:alert(1)",
    "data:text/html,hi",
    "//example.test/protocol-relative",
    "/relative",
    "not a url",
    "ftp://example.test/file",
  ])("drops %s", (link) => {
    expect(safeLink(link)).toBeNull();
  });
});

describe("roadmapLead", () => {
  const facts = {
    areaCount: 6,
    moduleCount: 14,
    resourceCount: 40,
    estimatedHours: 120,
    lastUpdated: "March 14, 2026",
  };

  it("says what the roadmap holds, its planned hours and its last update", () => {
    expect(roadmapLead(facts)).toBe(
      "A structured, hands-on path from full-stack development to production AI engineering: " +
        "6 areas, 14 modules, 40 vetted resources, roughly 120 hours of study and implementation. " +
        "Free, and updated as I actually work through it (last updated March 14, 2026).",
    );
  });

  it("leaves the last update out when nothing has been updated", () => {
    expect(roadmapLead({ ...facts, lastUpdated: null })).toMatch(/work through it\.$/u);
  });

  it("counts one of each in the singular", () => {
    expect(
      roadmapLead({ ...facts, areaCount: 1, moduleCount: 1, resourceCount: 1, estimatedHours: 1 }),
    ).toContain(": 1 area, 1 module, 1 vetted resource, roughly 1 hour of study");
  });
});
