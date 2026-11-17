import { describe, expect, it } from "vitest";

import {
  CurrentFocusCreateSchema,
  CurrentFocusListSchema,
  CurrentFocusSchema,
  CurrentFocusUpdateSchema,
} from "./index.js";

const stored = {
  id: "8a7b6c5d-4e3f-4a1b-9c2d-1e0f9a8b7c6d",
  createdAt: "2026-01-01T10:00:00.000Z",
  updatedAt: "2026-01-02T10:00:00.000Z",
};

/** A fictional focus entry with every field. */
const evalHarness = {
  slug: "eval-harness",
  title: "An evaluation harness for agents",
  description: "Building a **fictional** harness that scores tool-calling agents.",
  link: "https://example.com/eval-harness",
  position: 1,
  project: "route-planner",
  topics: ["agents", "evaluation"],
};

const required = {
  slug: "learning-rag",
  title: "Learning retrieval",
  description: "Reading and trying out retrieval patterns.",
  position: 2,
};

const topic = { ...stored, slug: "agents", name: "Agents", position: 0 };

const project = { slug: "route-planner", name: "Route planner", experience: "northwind-lead" };

describe("CurrentFocusCreateSchema", () => {
  it("accepts a focus entry with every field", () => {
    expect(CurrentFocusCreateSchema.parse(evalHarness)).toEqual(evalHarness);
  });

  it("fills an omitted link, project and topics with none", () => {
    expect(CurrentFocusCreateSchema.parse(required)).toEqual({
      ...required,
      link: null,
      project: null,
      topics: [],
    });
  });

  it("accepts an explicit null link and project", () => {
    expect(
      CurrentFocusCreateSchema.parse({ ...evalHarness, link: null, project: null }),
    ).toMatchObject({ link: null, project: null });
  });

  it("trims the title and the description", () => {
    expect(
      CurrentFocusCreateSchema.parse({ ...required, title: "  Retrieval  ", description: " x " }),
    ).toMatchObject({ title: "Retrieval", description: "x" });
  });

  it("accepts the longest title and description", () => {
    const longest = { ...required, title: "t".repeat(200), description: "d".repeat(5000) };
    expect(CurrentFocusCreateSchema.parse(longest)).toMatchObject(longest);
  });

  it.each([
    ["a missing slug", { ...evalHarness, slug: undefined }],
    ["an invalid slug", { ...evalHarness, slug: "Eval Harness" }],
    ["a missing title", { ...evalHarness, title: undefined }],
    ["an empty title", { ...evalHarness, title: "  " }],
    ["a title that is too long", { ...evalHarness, title: "x".repeat(201) }],
    ["a missing description", { ...evalHarness, description: undefined }],
    ["no description", { ...evalHarness, description: null }],
    ["an empty description", { ...evalHarness, description: " " }],
    ["a description that is too long", { ...evalHarness, description: "x".repeat(5001) }],
    ["a link that is not a URL", { ...evalHarness, link: "eval-harness" }],
    ["a link that is not http", { ...evalHarness, link: "ftp://example.com/eval" }],
    ["a script link", { ...evalHarness, link: "javascript:alert(1)" }],
    ["a link without a domain", { ...evalHarness, link: "https://northwind/" }],
    [
      "a link that is too long",
      { ...evalHarness, link: `https://example.com/${"a".repeat(2048)}` },
    ],
    ["a missing position", { ...evalHarness, position: undefined }],
    ["a negative position", { ...evalHarness, position: -1 }],
    ["a fractional position", { ...evalHarness, position: 1.5 }],
    ["a project that is not a slug", { ...evalHarness, project: "Route Planner" }],
    ["an embedded project", { ...evalHarness, project: { slug: "route-planner" } }],
    ["topics that are not slugs", { ...evalHarness, topics: ["Agents"] }],
    ["a repeated topic", { ...evalHarness, topics: ["agents", "agents"] }],
    ["no topics", { ...evalHarness, topics: null }],
    [
      "too many topics",
      { ...evalHarness, topics: Array.from({ length: 51 }, (_, i) => `t${String(i)}`) },
    ],
    ["an experience", { ...evalHarness, experience: "northwind-lead" }],
    ["a visibility flag", { ...evalHarness, visible: true }],
  ])("rejects %s", (_, input) => {
    expect(CurrentFocusCreateSchema.safeParse(input).success).toBe(false);
  });

  it("names the field at fault", () => {
    const result = CurrentFocusCreateSchema.safeParse({ ...evalHarness, link: "nope" });
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([["link"]]);
  });

  it("names the topics when one is repeated", () => {
    const result = CurrentFocusCreateSchema.safeParse({ ...evalHarness, topics: ["a", "a"] });
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([["topics"]]);
  });
});

describe("CurrentFocusUpdateSchema", () => {
  it("accepts a partial change without filling other fields", () => {
    expect(CurrentFocusUpdateSchema.parse({ title: "Renamed" })).toEqual({ title: "Renamed" });
  });

  it("distinguishes clearing the project, link and topics from leaving them out", () => {
    expect(CurrentFocusUpdateSchema.parse({ project: null, link: null, topics: [] })).toEqual({
      project: null,
      link: null,
      topics: [],
    });
  });

  it("accepts replacing the project and the topics", () => {
    expect(
      CurrentFocusUpdateSchema.parse({ project: "fleet-board", topics: ["rag", "agents"] }),
    ).toEqual({ project: "fleet-board", topics: ["rag", "agents"] });
  });

  it.each([
    ["an empty change", {}],
    ["a change of the slug", { slug: "renamed" }],
    ["clearing the title", { title: null }],
    ["clearing the description", { description: null }],
    ["clearing the topics with null", { topics: null }],
    ["a repeated topic", { topics: ["rag", "rag"] }],
    ["an invalid link", { link: "ftp://example.com" }],
    ["an unknown field", { status: "built" }],
  ])("rejects %s", (_, input) => {
    expect(CurrentFocusUpdateSchema.safeParse(input).success).toBe(false);
  });
});

describe("CurrentFocusSchema and CurrentFocusListSchema", () => {
  const linked = { ...stored, ...evalHarness, project, topics: [topic] };
  const unlinked = { ...stored, ...required, link: null, project: null, topics: [] };

  it("describe stored focus entries with and without a project, link and topics", () => {
    expect(CurrentFocusSchema.parse(linked)).toEqual(linked);
    expect(CurrentFocusSchema.parse(unlinked)).toEqual(unlinked);
    expect(CurrentFocusListSchema.parse([linked, unlinked])).toEqual([linked, unlinked]);
    expect(CurrentFocusListSchema.parse([])).toEqual([]);
  });

  it("rejects a project named only by its slug", () => {
    expect(CurrentFocusSchema.safeParse({ ...linked, project: "route-planner" }).success).toBe(
      false,
    );
  });

  it("rejects an entry without its topics", () => {
    expect(CurrentFocusSchema.safeParse({ ...linked, topics: undefined }).success).toBe(false);
  });
});
