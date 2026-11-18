import { describe, expect, it } from "vitest";

import type {
  RoadmapArea,
  RoadmapProgress,
  RoadmapTreeArea,
  RoadmapTreeModule,
  RoadmapTreeResource,
} from "@sebela/api-client";

import { roadmapPageFacts, toRoadmapAreaPage, toRoadmapModulePage } from "./detail";

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

function plainArea(slug: string, overrides: Partial<RoadmapArea> = {}): RoadmapArea {
  return {
    id: "3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f",
    slug,
    name: `Fictional ${slug}`,
    description: null,
    weight: 10,
    position: 0,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  };
}

function treeArea(slug: string, overrides: Partial<RoadmapTreeArea> = {}): RoadmapTreeArea {
  return { ...plainArea(slug), progress: progress(), modules: [], ...overrides };
}

describe("toRoadmapAreaPage", () => {
  it("shows the area with the API's progress, weight, status and planned estimate", () => {
    const page = toRoadmapAreaPage(
      treeArea("signal-area", {
        name: "Signal area",
        description: "Made-up **Markdown**.",
        weight: 25,
        position: 6,
        progress: progress({
          completed: 3,
          total: 7,
          status: "in-progress",
          estimatedMinutes: 270,
        }),
      }),
    );

    expect(page).toMatchObject({
      slug: "signal-area",
      name: "Signal area",
      description: "Made-up **Markdown**.",
      href: "/ai-roadmap/signal-area",
      weight: 25,
      weightLevel: 3,
      weightLabel: "High weight (>14%)",
      completed: 3,
      total: 7,
      status: "in-progress",
      current: true,
      estimate: "4.5h",
    });
  });

  it("has no estimate when nothing in the area is estimated", () => {
    expect(toRoadmapAreaPage(treeArea("a")).estimate).toBeNull();
  });

  it("says when the area last changed, from the API's last update, in Prague's day", () => {
    const changed = treeArea("a", {
      progress: progress({ lastUpdatedAt: "2026-03-14T23:30:00.000Z" }),
    });
    expect(toRoadmapAreaPage(changed).updated).toBe("March 15, 2026");
    expect(toRoadmapAreaPage(treeArea("a")).updated).toBeNull();
  });

  it("leads to the areas before and after it in the roadmap's order", () => {
    const areas = [
      { slug: "first", name: "First area" },
      { slug: "middle", name: "Middle area" },
      { slug: "last/odd", name: "Last area" },
    ];
    expect(toRoadmapAreaPage(treeArea("middle"), areas)).toMatchObject({
      previous: { name: "First area", href: "/ai-roadmap/first" },
      next: { name: "Last area", href: "/ai-roadmap/last%2Fodd" },
    });
    expect(toRoadmapAreaPage(treeArea("first"), areas)).toMatchObject({
      previous: null,
      next: { name: "Middle area", href: "/ai-roadmap/middle" },
    });
    expect(toRoadmapAreaPage(treeArea("last/odd"), areas)).toMatchObject({
      previous: { name: "Middle area" },
      next: null,
    });
  });

  it("has no neighbours when the roadmap's areas do not hold it", () => {
    expect(toRoadmapAreaPage(treeArea("gone"), [{ slug: "other", name: "Other" }])).toMatchObject({
      previous: null,
      next: null,
    });
    expect(toRoadmapAreaPage(treeArea("alone"))).toMatchObject({ previous: null, next: null });
  });

  it("leads from the overview to the area", () => {
    expect(toRoadmapAreaPage(treeArea("a/b", { name: "Odd area" })).breadcrumbs).toEqual([
      { name: "AI Engineering Roadmap", href: "/ai-roadmap" },
      { name: "Odd area", href: "/ai-roadmap/a%2Fb" },
    ]);
  });

  it("lists the modules in the API's order, numbered by it, each linking to its own page", () => {
    const page = toRoadmapAreaPage(
      treeArea("signal-area", {
        modules: [
          module("later", {
            position: 9,
            progress: progress({
              completed: 1,
              total: 2,
              status: "in-progress",
              estimatedMinutes: 30,
            }),
            resources: [resource("note", { status: "completed" })],
          }),
          module("sooner", { position: 1 }),
        ],
      }),
    );

    expect(page.modules.map((m) => [m.order, m.slug, m.href, m.status, m.estimate])).toEqual([
      ["I.", "later", "/ai-roadmap/signal-area/later", "in-progress", "30m"],
      ["II.", "sooner", "/ai-roadmap/signal-area/sooner", "planned", null],
    ]);
    expect(page.modules[0]?.resources.map((r) => [r.slug, r.status])).toEqual([
      ["note", "completed"],
    ]);
  });
});

describe("toRoadmapModulePage", () => {
  const area = plainArea("signal-area", { name: "Signal area" });

  it("shows the module with the API's progress, status and estimate, under its area", () => {
    const page = toRoadmapModulePage(
      area,
      module("signal-basics", {
        name: "Signal basics",
        description: "Made-up *module*.",
        progress: progress({
          completed: 1,
          total: 4,
          status: "in-progress",
          estimatedMinutes: 120,
        }),
      }),
    );

    expect(page).toMatchObject({
      slug: "signal-basics",
      name: "Signal basics",
      description: "Made-up *module*.",
      href: "/ai-roadmap/signal-area/signal-basics",
      completed: 1,
      total: 4,
      status: "in-progress",
      current: true,
      estimate: "2h",
      area: { slug: "signal-area", name: "Signal area", href: "/ai-roadmap/signal-area" },
    });
  });

  it("says when the module last changed, from the API's last update", () => {
    const changed = module("m", {
      progress: progress({ lastUpdatedAt: "2026-07-01T08:00:00.000Z" }),
    });
    expect(toRoadmapModulePage(area, changed).updated).toBe("July 1, 2026");
    expect(toRoadmapModulePage(area, module("m")).updated).toBeNull();
  });

  it.each([
    ["planned", false],
    ["completed", false],
    ["in-progress", true],
  ] as const)("marks a %s module as current: %s", (status, current) => {
    expect(toRoadmapModulePage(area, module("m", { progress: progress({ status }) })).current).toBe(
      current,
    );
  });

  it("leads from the overview through the area to the module", () => {
    expect(toRoadmapModulePage(area, module("m?x", { name: "Odd module" })).breadcrumbs).toEqual([
      { name: "AI Engineering Roadmap", href: "/ai-roadmap" },
      { name: "Signal area", href: "/ai-roadmap/signal-area" },
      { name: "Odd module", href: "/ai-roadmap/signal-area/m%3Fx" },
    ]);
  });

  it("lists the resources in the API's order with their status, type, estimate and anchor", () => {
    const page = toRoadmapModulePage(
      area,
      module("signal-basics", {
        resources: [
          resource("signal-book", {
            name: "A fictional book",
            type: "book",
            status: "in-progress",
            estimatedMinutes: 600,
            link: "https://example.test/book",
            position: 5,
          }),
          resource("unsafe", { link: "javascript:alert(1)", position: 1 }),
        ],
      }),
    );

    expect(page.resources).toEqual([
      {
        slug: "signal-book",
        name: "A fictional book",
        description: null,
        type: "book",
        typeLabel: "Book",
        status: "in-progress",
        estimate: "10h",
        href: "https://example.test/book",
        anchor: "resource-signal-book",
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
        anchor: "resource-unsafe",
      },
    ]);
  });

  it("keeps a module without resources as it is, with nothing to complete", () => {
    expect(toRoadmapModulePage(area, module("empty"))).toMatchObject({
      completed: 0,
      total: 0,
      status: "planned",
      estimate: null,
      resources: [],
    });
  });
});

describe("roadmapPageFacts", () => {
  it("gives an area page's metadata facts: its kind, way, description and the API's estimate", () => {
    const area = treeArea("signal", {
      name: "Signal area",
      description: "Learns **signals**.",
      progress: progress({ estimatedMinutes: 150 }),
    });
    expect(
      roadmapPageFacts({ name: "Robin Example", headline: "Fictional", area, areas: [] }),
    ).toEqual({
      name: "Robin Example",
      kind: "area",
      breadcrumbs: [
        { name: "AI Engineering Roadmap", href: "/ai-roadmap" },
        { name: "Signal area", href: "/ai-roadmap/signal" },
      ],
      summary: "Learns **signals**.",
      estimatedMinutes: 150,
    });
  });

  it("gives a module page's metadata facts with the way through its area", () => {
    const content = {
      name: "Robin Example",
      headline: "Fictional",
      area: plainArea("signal", { name: "Signal area" }),
      module: module("basics", {
        name: "Signal basics",
        progress: progress({ estimatedMinutes: 45 }),
      }),
    };
    expect(roadmapPageFacts(content)).toEqual({
      name: "Robin Example",
      kind: "module",
      breadcrumbs: [
        { name: "AI Engineering Roadmap", href: "/ai-roadmap" },
        { name: "Signal area", href: "/ai-roadmap/signal" },
        { name: "Signal basics", href: "/ai-roadmap/signal/basics" },
      ],
      summary: null,
      estimatedMinutes: 45,
    });
  });
});
