import { describe, expect, it } from "vitest";

import {
  RoadmapBookCreateSchema,
  RoadmapBookListSchema,
  RoadmapBookSchema,
  RoadmapBookUpdateSchema,
  roadmapBookStatuses,
} from "./index.js";

/** A fictional book with every writable field. */
const patterns = {
  slug: "fictional-patterns",
  title: "Fictional Patterns",
  author: "Ada Example",
  description: "A **fictional** book about patterns.",
  pages: 320,
  year: 2024,
  isbn: "978-0-00-000000-0",
  priority: 2,
  startedOn: "2026-01-05",
  endedOn: "2026-02-10",
  summary: "## Notes\n\nA fictional summary.",
  coverId: "1f2e3d4c-5b6a-4987-8a6b-5c4d3e2f1a0b",
};

const stored = {
  id: "8a7b6c5d-4e3f-4a1b-9c2d-1e0f9a8b7c6d",
  createdAt: "2026-01-01T10:00:00.000Z",
  updatedAt: "2026-01-02T10:00:00.000Z",
};

const cover = {
  ...stored,
  id: patterns.coverId,
  key: "media/2026/01/cover.webp",
  mediaType: "image/webp",
  byteSize: 1024,
  width: 400,
  height: 600,
  altText: "Cover of Fictional Patterns",
  url: "https://media.example.com/media/2026/01/cover.webp",
};

const book = {
  ...stored,
  ...patterns,
  cover,
  status: "completed",
  resource: {
    slug: "fictional-patterns-reading",
    name: "Reading Fictional Patterns",
    module: "prompting-basics",
    area: "foundations",
  },
  readingSeconds: 5400,
};

describe("roadmapBookStatuses", () => {
  it("names the three derived statuses in reading order", () => {
    expect(roadmapBookStatuses).toEqual(["to-read", "reading", "completed"]);
  });
});

describe("RoadmapBookSchema", () => {
  it("describes a book with its cover, derived status, linking resource and reading time", () => {
    expect(RoadmapBookSchema.parse(book)).toEqual(book);
    expect(RoadmapBookListSchema.parse([book])).toEqual([book]);
  });

  it("allows a book without a cover, optional metadata or a linking resource", () => {
    const bare = {
      ...book,
      author: null,
      description: null,
      pages: null,
      year: null,
      isbn: null,
      startedOn: null,
      endedOn: null,
      summary: null,
      coverId: null,
      cover: null,
      status: "to-read",
      resource: null,
      readingSeconds: 0,
    };
    expect(RoadmapBookSchema.parse(bare)).toEqual(bare);
  });

  it("refuses an unknown status and negative reading time", () => {
    expect(RoadmapBookSchema.safeParse({ ...book, status: "finished" }).success).toBe(false);
    expect(RoadmapBookSchema.safeParse({ ...book, readingSeconds: -1 }).success).toBe(false);
  });
});

describe("RoadmapBookCreateSchema", () => {
  it("accepts a book with every field", () => {
    expect(RoadmapBookCreateSchema.parse(patterns)).toEqual(patterns);
  });

  it("fills omitted optional fields with null and the priority with zero", () => {
    const required = { slug: "fictional-basics", title: "Fictional Basics" };
    expect(RoadmapBookCreateSchema.parse(required)).toEqual({
      ...required,
      author: null,
      description: null,
      pages: null,
      year: null,
      isbn: null,
      priority: 0,
      startedOn: null,
      endedOn: null,
      summary: null,
      coverId: null,
    });
  });

  it("refuses an end before the start", () => {
    const result = RoadmapBookCreateSchema.safeParse({
      ...patterns,
      startedOn: "2026-02-11",
      endedOn: "2026-02-10",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["endedOn"]);
  });

  it.each([
    ["pages", 0],
    ["pages", 1.5],
    ["priority", -1],
    ["year", 0],
    ["startedOn", "2026-02-30"],
    ["endedOn", "2026-02-10T00:00:00Z"],
    ["coverId", "not-a-uuid"],
    ["title", "  "],
    ["slug", "Fictional Patterns"],
    ["isbn", "not an isbn!"],
  ])("refuses an invalid %s", (field, value) => {
    const result = RoadmapBookCreateSchema.safeParse({ ...patterns, [field]: value });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual([field]);
  });

  it("refuses unknown and derived fields", () => {
    expect(RoadmapBookCreateSchema.safeParse({ ...patterns, status: "completed" }).success).toBe(
      false,
    );
    expect(RoadmapBookCreateSchema.safeParse({ ...patterns, resource: "x" }).success).toBe(false);
  });
});

describe("RoadmapBookUpdateSchema", () => {
  it("changes only the sent fields, clears with null and checks dates sent together", () => {
    expect(RoadmapBookUpdateSchema.parse({ endedOn: null })).toEqual({ endedOn: null });
    expect(RoadmapBookUpdateSchema.parse({ priority: 4, coverId: null })).toEqual({
      priority: 4,
      coverId: null,
    });
    expect(
      RoadmapBookUpdateSchema.safeParse({ startedOn: "2026-03-02", endedOn: "2026-03-01" }).success,
    ).toBe(false);
  });

  it("refuses an empty body and a slug change", () => {
    expect(RoadmapBookUpdateSchema.safeParse({}).success).toBe(false);
    expect(RoadmapBookUpdateSchema.safeParse({ slug: "other" }).success).toBe(false);
  });
});
