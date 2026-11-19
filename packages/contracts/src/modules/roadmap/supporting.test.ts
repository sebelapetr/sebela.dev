import { describe, expect, it } from "vitest";

import {
  RoadmapFollowedSourceCreateSchema,
  RoadmapFollowedSourceListSchema,
  RoadmapFollowedSourceSchema,
  RoadmapFollowedSourceUpdateSchema,
  RoadmapGlossaryTermCreateSchema,
  RoadmapGlossaryTermListSchema,
  RoadmapGlossaryTermSchema,
  RoadmapGlossaryTermUpdateSchema,
  RoadmapProjectIdeaCreateSchema,
  RoadmapProjectIdeaListSchema,
  RoadmapProjectIdeaSchema,
  RoadmapProjectIdeaUpdateSchema,
} from "./index.js";

const stored = {
  id: "8a7b6c5d-4e3f-4a1b-9c2d-1e0f9a8b7c6d",
  createdAt: "2026-01-01T10:00:00.000Z",
  updatedAt: "2026-01-02T10:00:00.000Z",
};

const topic = {
  ...stored,
  id: "1f2e3d4c-5b6a-4987-8a6b-5c4d3e2f1a0b",
  slug: "agents",
  name: "Agents",
  position: 0,
};

/** A fictional project idea with every writable field. */
const idea = {
  slug: "fictional-reading-assistant",
  title: "A fictional reading assistant",
  whyItMatters: "It practises **retrieval** on a small corpus.",
  howToStart: "1. Pick three articles.\n2. Index them.",
  topics: ["agents"],
  position: 2,
};

/** A fictional followed source with every writable field. */
const source = {
  slug: "example-weekly",
  title: "Example Weekly",
  description: "A *fictional* newsletter.",
  link: "https://example.com/weekly",
  kind: "newsletter",
  position: 1,
};

/** A fictional glossary term with every writable field. */
const term = {
  slug: "context-window",
  term: "Context window",
  description: "How much text a model reads at once.",
  position: 0,
};

describe("RoadmapProjectIdeaSchema", () => {
  it("describes an idea with its shared topics", () => {
    const read = { ...stored, ...idea, topics: [topic] };
    expect(RoadmapProjectIdeaSchema.parse(read)).toEqual(read);
    expect(RoadmapProjectIdeaListSchema.parse([read])).toEqual([read]);
  });

  it("allows an idea without a way to start or topics", () => {
    const bare = { ...stored, ...idea, howToStart: null, topics: [] };
    expect(RoadmapProjectIdeaSchema.parse(bare)).toEqual(bare);
  });
});

describe("RoadmapProjectIdeaCreateSchema", () => {
  it("accepts an idea with every field", () => {
    expect(RoadmapProjectIdeaCreateSchema.parse(idea)).toEqual(idea);
  });

  it("fills omitted optional fields with none and no topics", () => {
    const required = { slug: idea.slug, title: idea.title, whyItMatters: idea.whyItMatters };
    expect(RoadmapProjectIdeaCreateSchema.parse({ ...required, position: 0 })).toEqual({
      ...required,
      howToStart: null,
      topics: [],
      position: 0,
    });
  });

  it.each([
    ["slug", "Reading Assistant"],
    ["title", "  "],
    ["whyItMatters", null],
    ["howToStart", ""],
    ["position", -1],
    ["position", 1.5],
  ])("refuses an invalid %s", (field, value) => {
    const result = RoadmapProjectIdeaCreateSchema.safeParse({ ...idea, [field]: value });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual([field]);
  });

  it("refuses a topic listed twice and unknown fields", () => {
    const repeated = RoadmapProjectIdeaCreateSchema.safeParse({
      ...idea,
      topics: ["agents", "agents"],
    });
    expect(repeated.error?.issues[0]?.path).toEqual(["topics"]);
    expect(RoadmapProjectIdeaCreateSchema.safeParse({ ...idea, module: "x" }).success).toBe(false);
  });
});

describe("RoadmapProjectIdeaUpdateSchema", () => {
  it("changes only the sent fields and clears an optional one with null", () => {
    expect(RoadmapProjectIdeaUpdateSchema.parse({ howToStart: null })).toEqual({
      howToStart: null,
    });
    expect(RoadmapProjectIdeaUpdateSchema.parse({ topics: [] })).toEqual({ topics: [] });
  });

  it("refuses an empty body, a slug change, clearing a required field and repeated topics", () => {
    expect(RoadmapProjectIdeaUpdateSchema.safeParse({}).success).toBe(false);
    expect(RoadmapProjectIdeaUpdateSchema.safeParse({ slug: "other" }).success).toBe(false);
    expect(RoadmapProjectIdeaUpdateSchema.safeParse({ whyItMatters: null }).success).toBe(false);
    expect(RoadmapProjectIdeaUpdateSchema.safeParse({ topics: ["a", "a"] }).success).toBe(false);
  });
});

describe("RoadmapFollowedSourceSchema", () => {
  it("describes a followed source", () => {
    const read = { ...stored, ...source };
    expect(RoadmapFollowedSourceSchema.parse(read)).toEqual(read);
    expect(RoadmapFollowedSourceListSchema.parse([read])).toEqual([read]);
  });
});

describe("RoadmapFollowedSourceCreateSchema", () => {
  it("accepts a source with every field", () => {
    expect(RoadmapFollowedSourceCreateSchema.parse(source)).toEqual(source);
  });

  it("fills an omitted description and link with none", () => {
    const required = { slug: source.slug, title: source.title, kind: "podcast", position: 0 };
    expect(RoadmapFollowedSourceCreateSchema.parse(required)).toEqual({
      ...required,
      description: null,
      link: null,
    });
  });

  it.each([
    ["title", ""],
    ["kind", "  "],
    ["kind", "x".repeat(101)],
    ["link", "javascript:alert(1)"],
    ["link", "ftp://example.com/feed"],
    ["position", 1_000_001],
  ])("refuses an invalid %s", (field, value) => {
    const result = RoadmapFollowedSourceCreateSchema.safeParse({ ...source, [field]: value });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual([field]);
  });
});

describe("RoadmapFollowedSourceUpdateSchema", () => {
  it("changes only the sent fields and refuses an empty body or a slug change", () => {
    expect(RoadmapFollowedSourceUpdateSchema.parse({ link: null })).toEqual({ link: null });
    expect(RoadmapFollowedSourceUpdateSchema.safeParse({}).success).toBe(false);
    expect(RoadmapFollowedSourceUpdateSchema.safeParse({ slug: "other" }).success).toBe(false);
    expect(RoadmapFollowedSourceUpdateSchema.safeParse({ kind: null }).success).toBe(false);
  });
});

describe("RoadmapGlossaryTermSchema", () => {
  it("describes a glossary term", () => {
    const read = { ...stored, ...term };
    expect(RoadmapGlossaryTermSchema.parse(read)).toEqual(read);
    expect(RoadmapGlossaryTermListSchema.parse([read])).toEqual([read]);
  });
});

describe("RoadmapGlossaryTermCreateSchema", () => {
  it("accepts a term with every field", () => {
    expect(RoadmapGlossaryTermCreateSchema.parse(term)).toEqual(term);
  });

  it.each([
    ["term", " "],
    ["description", null],
    ["slug", "../term"],
  ])("refuses an invalid %s", (field, value) => {
    const result = RoadmapGlossaryTermCreateSchema.safeParse({ ...term, [field]: value });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual([field]);
  });

  it("refuses a missing position and unknown fields", () => {
    const withoutPosition: Partial<typeof term> = { ...term };
    delete withoutPosition.position;
    expect(RoadmapGlossaryTermCreateSchema.safeParse(withoutPosition).success).toBe(false);
    expect(RoadmapGlossaryTermCreateSchema.safeParse({ ...term, topics: [] }).success).toBe(false);
  });
});

describe("RoadmapGlossaryTermUpdateSchema", () => {
  it("changes only the sent fields and refuses an empty body or a slug change", () => {
    expect(RoadmapGlossaryTermUpdateSchema.parse({ position: 4 })).toEqual({ position: 4 });
    expect(RoadmapGlossaryTermUpdateSchema.safeParse({}).success).toBe(false);
    expect(RoadmapGlossaryTermUpdateSchema.safeParse({ slug: "other" }).success).toBe(false);
  });
});
