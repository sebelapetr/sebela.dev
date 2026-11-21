import { describe, expect, it } from "vitest";

import {
  SlugParamsSchema,
  TechnologyCreateSchema,
  TechnologyListSchema,
  TechnologySchema,
  TechnologyUpdateSchema,
  TopicCreateSchema,
  TopicListSchema,
  TopicSchema,
  TopicUpdateSchema,
} from "./index.js";

const stored = {
  id: "6f1c2a52-3a0e-4c37-9a52-8f0a6f8d2b11",
  createdAt: "2026-01-01T10:00:00.000Z",
  updatedAt: "2026-01-02T10:00:00.000Z",
};

const core = {
  slug: "typescript",
  name: "TypeScript",
  tier: "primary",
  group: "core",
  position: 1,
};

describe("SlugParamsSchema", () => {
  it.each(["northwind-freight", "next-js", "a1", "rag"])("accepts the slug %s", (slug) => {
    expect(SlugParamsSchema.parse({ slug })).toEqual({ slug });
  });

  it.each([
    ["an empty slug", ""],
    ["upper case", "Northwind-Freight"],
    ["a space", "next js"],
    ["a leading hyphen", "-rag"],
    ["a trailing hyphen", "rag-"],
    ["a double hyphen", "next--js"],
    ["a dot", "next.js"],
    ["a path", "../person"],
    ["a slug that is too long", "a".repeat(101)],
  ])("rejects %s", (_, slug) => {
    expect(SlugParamsSchema.safeParse({ slug }).success).toBe(false);
  });
});

describe("TechnologyCreateSchema", () => {
  it("accepts a core technology with a logo key", () => {
    const input = { ...core, logoKey: "typescript" };
    expect(TechnologyCreateSchema.parse(input)).toEqual(input);
  });

  it("fills an unset group and logo key with null for a secondary technology", () => {
    expect(
      TechnologyCreateSchema.parse({
        slug: "bash",
        name: "Bash",
        tier: "secondary",
        position: 0,
      }),
    ).toEqual({
      slug: "bash",
      name: "Bash",
      tier: "secondary",
      group: null,
      logoKey: null,
      position: 0,
    });
  });

  it("accepts the AI engineering focus group for a primary technology", () => {
    expect(
      TechnologyCreateSchema.parse({
        ...core,
        slug: "rag",
        name: "RAG",
        group: "ai_engineering_focus",
      }),
    ).toMatchObject({ group: "ai_engineering_focus", logoKey: null });
  });

  it("trims the name", () => {
    expect(TechnologyCreateSchema.parse({ ...core, name: "  TypeScript " }).name).toBe(
      "TypeScript",
    );
  });

  it.each([
    ["a primary technology without a group", { ...core, group: null }],
    [
      "a primary technology with an omitted group",
      { slug: "go", name: "Go", tier: "primary", position: 0 },
    ],
    ["a secondary technology with a group", { ...core, tier: "secondary" }],
    ["an unknown tier", { ...core, tier: "tertiary" }],
    ["an unknown group", { ...core, group: "frontend" }],
    ["a negative position", { ...core, position: -1 }],
    ["a fractional position", { ...core, position: 1.5 }],
    ["a position that is too large", { ...core, position: 1_000_001 }],
    ["a position given as text", { ...core, position: "1" }],
    ["a missing position", { slug: "go", name: "Go", tier: "primary", group: "core" }],
    ["an invalid slug", { ...core, slug: "Type Script" }],
    ["an empty name", { ...core, name: "  " }],
    ["a logo key that is a URL", { ...core, logoKey: "https://cdn.example.test/ts.svg" }],
    ["a logo key that is a path", { ...core, logoKey: "../logos/ts" }],
    ["an unexpected field", { ...core, logo: "typescript.svg" }],
  ])("rejects %s", (_, input) => {
    expect(TechnologyCreateSchema.safeParse(input).success).toBe(false);
  });

  it("names the group field when tier and group disagree", () => {
    const result = TechnologyCreateSchema.safeParse({ ...core, tier: "secondary" });
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([["group"]]);
  });
});

describe("TechnologyUpdateSchema", () => {
  it("accepts a partial change without filling other fields", () => {
    expect(TechnologyUpdateSchema.parse({ position: 3 })).toEqual({ position: 3 });
  });

  it("accepts moving a technology to the secondary tier with its group cleared", () => {
    expect(TechnologyUpdateSchema.parse({ tier: "secondary", group: null })).toEqual({
      tier: "secondary",
      group: null,
    });
  });

  it.each([
    ["an empty change", {}],
    ["a change of the slug", { slug: "renamed" }],
    ["a tier and group that disagree", { tier: "primary", group: null }],
    ["a secondary tier with a group", { tier: "secondary", group: "core" }],
    ["a negative position", { position: -1 }],
    ["clearing the name", { name: null }],
  ])("rejects %s", (_, input) => {
    expect(TechnologyUpdateSchema.safeParse(input).success).toBe(false);
  });
});

describe("TechnologySchema and TechnologyListSchema", () => {
  it("describe stored technologies with identifiers and timestamps", () => {
    const technology = { ...stored, ...TechnologyCreateSchema.parse(core) };
    expect(TechnologySchema.parse(technology)).toEqual(technology);
    expect(TechnologyListSchema.parse([technology])).toEqual([technology]);
    expect(TechnologyListSchema.parse([])).toEqual([]);
  });
});

describe("TopicCreateSchema", () => {
  it("accepts a topic", () => {
    const topic = { slug: "mcp", name: "Model Context Protocol", position: 2 };
    expect(TopicCreateSchema.parse(topic)).toEqual(topic);
  });

  it.each([
    ["a missing position", { slug: "mcp", name: "MCP" }],
    ["a negative position", { slug: "mcp", name: "MCP", position: -1 }],
    ["an invalid slug", { slug: "MCP!", name: "MCP", position: 0 }],
    ["an empty name", { slug: "mcp", name: "", position: 0 }],
    ["a name that is too long", { slug: "mcp", name: "x".repeat(101), position: 0 }],
    ["an unexpected field", { slug: "mcp", name: "MCP", position: 0, roadmap: true }],
  ])("rejects %s", (_, input) => {
    expect(TopicCreateSchema.safeParse(input).success).toBe(false);
  });
});

describe("TopicUpdateSchema", () => {
  it("accepts a partial change", () => {
    expect(TopicUpdateSchema.parse({ name: "Agents" })).toEqual({ name: "Agents" });
  });

  it.each([
    ["an empty change", {}],
    ["a change of the slug", { slug: "renamed" }],
    ["a fractional position", { position: 0.5 }],
  ])("rejects %s", (_, input) => {
    expect(TopicUpdateSchema.safeParse(input).success).toBe(false);
  });
});

describe("TopicSchema and TopicListSchema", () => {
  it("describe stored topics with identifiers and timestamps", () => {
    const topic = { ...stored, slug: "agents", name: "Agents", position: 0 };
    expect(TopicSchema.parse(topic)).toEqual(topic);
    expect(TopicListSchema.parse([topic])).toEqual([topic]);
  });
});
