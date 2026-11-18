import { describe, expect, it } from "vitest";

import {
  RoadmapAreaCreateSchema,
  RoadmapAreaDetailSchema,
  RoadmapAreaParamsSchema,
  RoadmapAreaUpdateSchema,
  RoadmapCurrentSchema,
  RoadmapModuleCreateSchema,
  RoadmapModuleDetailSchema,
  RoadmapModuleParamsSchema,
  RoadmapModuleUpdateSchema,
  RoadmapResourceCreateSchema,
  RoadmapResourceUpdateSchema,
  RoadmapSchema,
  reservedRoadmapAreaSlugs,
  roadmapResourceStatuses,
  roadmapResourceTypes,
} from "./index.js";

const stored = {
  id: "8a7b6c5d-4e3f-4a1b-9c2d-1e0f9a8b7c6d",
  createdAt: "2026-01-01T10:00:00.000Z",
  updatedAt: "2026-01-02T10:00:00.000Z",
};

/** A fictional area with every field. */
const foundations = {
  slug: "foundations",
  name: "Foundations",
  description: "The **fictional** basics.",
  weight: 30,
  position: 0,
};

const prompting = {
  slug: "prompting-basics",
  area: "foundations",
  name: "Prompting basics",
  description: "Writing clear instructions.",
  position: 1,
};

const notes = {
  slug: "prompting-notes",
  module: "prompting-basics",
  name: "Prompting notes",
  description: "A fictional set of notes.",
  type: "text",
  status: "completed",
  estimatedMinutes: 45,
  startedAt: "2026-01-01T08:00:00.000Z",
  finishedAt: "2026-01-03T09:30:00.000Z",
  link: "https://example.com/prompting-notes",
  position: 0,
  book: null,
  topics: ["agents", "evaluation"],
};

const progress = {
  completed: 1,
  total: 2,
  status: "completed",
  completedAt: "2026-01-03T09:30:00.000Z",
  lastUpdatedAt: "2026-01-02T10:00:00.000Z",
  estimatedMinutes: 45,
};

describe("the roadmap catalogs", () => {
  it("keeps the resource types and statuses of the original application", () => {
    expect(roadmapResourceTypes).toEqual([
      "youtube-video",
      "youtube-playlist",
      "google-drive",
      "video",
      "link",
      "text",
      "project",
      "book",
    ]);
    expect(roadmapResourceStatuses).toEqual([
      "planned",
      "in-progress",
      "completed",
      "paused",
      "skipped",
    ]);
  });

  it("reserves the slugs of the roadmap's own pages", () => {
    expect(reservedRoadmapAreaSlugs).toEqual([
      "diary",
      "bookshelf",
      "events",
      "how-to-read-effectively",
    ]);
  });
});

describe("RoadmapAreaCreateSchema", () => {
  it("accepts an area with every field", () => {
    expect(RoadmapAreaCreateSchema.parse(foundations)).toEqual(foundations);
  });

  it("fills an omitted description with none", () => {
    const required = { slug: "agents", name: "Agents", weight: 20, position: 1 };
    expect(RoadmapAreaCreateSchema.parse(required)).toEqual({ ...required, description: null });
  });

  it.each(reservedRoadmapAreaSlugs)("refuses the reserved slug %s", (slug) => {
    const result = RoadmapAreaCreateSchema.safeParse({ ...foundations, slug });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["slug"]);
  });

  it.each([0, 101, 2.5])("refuses the weight %s outside 1 to 100", (weight) => {
    expect(RoadmapAreaCreateSchema.safeParse({ ...foundations, weight }).success).toBe(false);
  });

  it("refuses a negative position and an unknown field", () => {
    expect(RoadmapAreaCreateSchema.safeParse({ ...foundations, position: -1 }).success).toBe(false);
    expect(RoadmapAreaCreateSchema.safeParse({ ...foundations, extra: true }).success).toBe(false);
  });
});

describe("RoadmapAreaUpdateSchema", () => {
  it("accepts a partial change and refuses an empty one or a slug change", () => {
    expect(RoadmapAreaUpdateSchema.parse({ weight: 40 })).toEqual({ weight: 40 });
    expect(RoadmapAreaUpdateSchema.safeParse({}).success).toBe(false);
    expect(RoadmapAreaUpdateSchema.safeParse({ slug: "renamed" }).success).toBe(false);
  });
});

describe("RoadmapModuleCreateSchema", () => {
  it("accepts a module naming its area", () => {
    expect(RoadmapModuleCreateSchema.parse(prompting)).toEqual(prompting);
  });

  it("requires the area", () => {
    const orphan = { slug: "orphan", name: "Orphan", position: 0 };
    expect(RoadmapModuleCreateSchema.safeParse(orphan).success).toBe(false);
  });

  it("lets an update move the module to another area", () => {
    expect(RoadmapModuleUpdateSchema.parse({ area: "agents" })).toEqual({ area: "agents" });
    expect(RoadmapModuleUpdateSchema.safeParse({}).success).toBe(false);
  });
});

describe("RoadmapResourceCreateSchema", () => {
  it("accepts a resource with every field", () => {
    expect(RoadmapResourceCreateSchema.parse(notes)).toEqual(notes);
  });

  it("fills omitted optional fields: planned, no estimate, dates, link or topics", () => {
    const required = {
      slug: "intro-video",
      module: "prompting-basics",
      name: "Intro video",
      type: "youtube-video",
      position: 0,
    };
    expect(RoadmapResourceCreateSchema.parse(required)).toEqual({
      ...required,
      description: null,
      status: "planned",
      estimatedMinutes: null,
      startedAt: null,
      finishedAt: null,
      link: null,
      book: null,
      topics: [],
    });
  });

  it("links a book only from a resource of type book", () => {
    const reading = { ...notes, type: "book", book: "fictional-patterns" };
    expect(RoadmapResourceCreateSchema.parse(reading)).toEqual(reading);
    const result = RoadmapResourceCreateSchema.safeParse({ ...notes, book: "fictional-patterns" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["book"]);
    expect(RoadmapResourceCreateSchema.safeParse({ ...reading, book: "Not A Slug" }).success).toBe(
      false,
    );
  });

  it("refuses an unknown type or status", () => {
    expect(RoadmapResourceCreateSchema.safeParse({ ...notes, type: "podcast" }).success).toBe(
      false,
    );
    expect(RoadmapResourceCreateSchema.safeParse({ ...notes, status: "done" }).success).toBe(false);
  });

  it("refuses a negative or fractional estimate", () => {
    for (const estimatedMinutes of [-1, 1.5]) {
      expect(RoadmapResourceCreateSchema.safeParse({ ...notes, estimatedMinutes }).success).toBe(
        false,
      );
    }
  });

  it("refuses a finish before the start", () => {
    const result = RoadmapResourceCreateSchema.safeParse({
      ...notes,
      startedAt: "2026-01-03T09:30:00.500Z",
      finishedAt: "2026-01-03T09:30:00Z",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["finishedAt"]);
  });

  it("refuses a repeated topic and a non-http link", () => {
    expect(
      RoadmapResourceCreateSchema.safeParse({ ...notes, topics: ["agents", "agents"] }).success,
    ).toBe(false);
    expect(
      RoadmapResourceCreateSchema.safeParse({ ...notes, link: "ftp://example.com/notes" }).success,
    ).toBe(false);
  });
});

describe("RoadmapResourceUpdateSchema", () => {
  it("accepts a status change alone and checks dates sent together", () => {
    expect(RoadmapResourceUpdateSchema.parse({ status: "skipped" })).toEqual({
      status: "skipped",
    });
    expect(
      RoadmapResourceUpdateSchema.safeParse({
        startedAt: "2026-02-02T00:00:00Z",
        finishedAt: "2026-02-01T00:00:00Z",
      }).success,
    ).toBe(false);
    expect(RoadmapResourceUpdateSchema.safeParse({}).success).toBe(false);
  });

  it("accepts a book link or its removal and refuses a book with another type in one body", () => {
    expect(RoadmapResourceUpdateSchema.parse({ book: "fictional-patterns" })).toEqual({
      book: "fictional-patterns",
    });
    expect(RoadmapResourceUpdateSchema.parse({ book: null, type: "text" })).toEqual({
      book: null,
      type: "text",
    });
    const result = RoadmapResourceUpdateSchema.safeParse({
      type: "link",
      book: "fictional-patterns",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["book"]);
  });
});

describe("RoadmapSchema", () => {
  it("describes the whole tree with derived progress and a summary", () => {
    const resource = {
      slug: notes.slug,
      name: notes.name,
      description: notes.description,
      type: notes.type,
      status: notes.status,
      estimatedMinutes: notes.estimatedMinutes,
      startedAt: notes.startedAt,
      finishedAt: notes.finishedAt,
      link: notes.link,
      position: notes.position,
      book: notes.book,
    };
    const tree = {
      summary: {
        areaCount: 1,
        moduleCount: 1,
        resourceCount: 1,
        completed: 1,
        total: 1,
        estimatedMinutes: 45,
        estimatedHours: 1,
        lastUpdatedAt: "2026-01-02T10:00:00.000Z",
      },
      areas: [
        {
          ...stored,
          ...foundations,
          progress,
          modules: [
            {
              ...stored,
              slug: prompting.slug,
              name: prompting.name,
              description: prompting.description,
              position: prompting.position,
              progress,
              resources: [
                {
                  ...stored,
                  ...resource,
                  topics: [{ ...stored, slug: "agents", name: "Agents", position: 0 }],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(RoadmapSchema.parse(tree)).toEqual(tree);
  });

  it("refuses a derived status that a parent cannot have", () => {
    const summary = {
      areaCount: 0,
      moduleCount: 0,
      resourceCount: 0,
      completed: 0,
      total: 0,
      estimatedMinutes: 0,
      estimatedHours: 0,
      lastUpdatedAt: null,
    };
    expect(RoadmapSchema.parse({ summary, areas: [] })).toEqual({ summary, areas: [] });
    expect(
      RoadmapSchema.safeParse({
        summary,
        areas: [
          { ...stored, ...foundations, progress: { ...progress, status: "paused" }, modules: [] },
        ],
      }).success,
    ).toBe(false);
  });
});

/** The tree nodes of the fictional hierarchy, as the detail and current reads return them. */
const treeResource = {
  ...stored,
  slug: notes.slug,
  name: notes.name,
  description: notes.description,
  type: notes.type,
  status: notes.status,
  estimatedMinutes: notes.estimatedMinutes,
  startedAt: notes.startedAt,
  finishedAt: notes.finishedAt,
  link: notes.link,
  position: notes.position,
  book: null,
  topics: [{ ...stored, slug: "agents", name: "Agents", position: 0 }],
};
const moduleNode = {
  ...stored,
  slug: prompting.slug,
  name: prompting.name,
  description: prompting.description,
  position: prompting.position,
  progress,
};
const current = { ...progress, status: "in-progress", completedAt: null };

describe("the detail addresses", () => {
  it("name an area, and a module inside its area, by slug", () => {
    expect(RoadmapAreaParamsSchema.parse({ area: "foundations" })).toEqual({
      area: "foundations",
    });
    expect(
      RoadmapModuleParamsSchema.parse({ area: "foundations", module: "prompting-basics" }),
    ).toEqual({ area: "foundations", module: "prompting-basics" });
  });

  it("refuse a slug that is not one and a module without its area", () => {
    expect(RoadmapAreaParamsSchema.safeParse({ area: "Not A Slug" }).success).toBe(false);
    expect(RoadmapModuleParamsSchema.safeParse({ module: "prompting-basics" }).success).toBe(false);
    expect(
      RoadmapModuleParamsSchema.safeParse({ area: "foundations", module: "../x" }).success,
    ).toBe(false);
  });
});

describe("RoadmapAreaDetailSchema", () => {
  it("holds the area with its progress and its modules with their resources", () => {
    const detail = {
      area: {
        ...stored,
        ...foundations,
        progress,
        modules: [{ ...moduleNode, resources: [treeResource] }],
      },
    };
    expect(RoadmapAreaDetailSchema.parse(detail)).toEqual(detail);
  });

  it("refuses an area without its derived progress", () => {
    expect(
      RoadmapAreaDetailSchema.safeParse({ area: { ...stored, ...foundations, modules: [] } })
        .success,
    ).toBe(false);
  });
});

describe("RoadmapModuleDetailSchema", () => {
  it("holds the module with its progress and resources and the area it belongs to", () => {
    const detail = {
      area: { ...stored, ...foundations },
      module: { ...moduleNode, resources: [treeResource] },
    };
    expect(RoadmapModuleDetailSchema.parse(detail)).toEqual(detail);
  });

  it("refuses a module without its area", () => {
    expect(
      RoadmapModuleDetailSchema.safeParse({ module: { ...moduleNode, resources: [] } }).success,
    ).toBe(false);
  });
});

describe("RoadmapCurrentSchema", () => {
  it("accepts no current learning as a valid answer", () => {
    expect(RoadmapCurrentSchema.parse({ areas: [] })).toEqual({ areas: [] });
  });

  it("holds the areas in progress with their modules in progress, without resources", () => {
    const learning = {
      areas: [
        {
          ...stored,
          ...foundations,
          progress: current,
          modules: [{ ...moduleNode, progress: current }],
        },
      ],
    };
    expect(RoadmapCurrentSchema.parse(learning)).toEqual(learning);
  });

  it.each(["planned", "completed"])("refuses an area or a module that is %s", (status) => {
    const area = { ...stored, ...foundations, progress: current, modules: [] };
    expect(
      RoadmapCurrentSchema.safeParse({ areas: [{ ...area, progress: { ...current, status } }] })
        .success,
    ).toBe(false);
    expect(
      RoadmapCurrentSchema.safeParse({
        areas: [{ ...area, modules: [{ ...moduleNode, progress: { ...current, status } }] }],
      }).success,
    ).toBe(false);
  });
});
