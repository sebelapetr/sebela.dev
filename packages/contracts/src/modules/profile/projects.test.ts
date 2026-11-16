import { describe, expect, it } from "vitest";

import {
  ExperienceSchema,
  ProjectCreateSchema,
  ProjectListSchema,
  ProjectSchema,
  ProjectUpdateSchema,
} from "./index.js";

const stored = {
  id: "3c9e1f7a-5b2d-4e8a-9f1c-7d6b5a4e3c2b",
  createdAt: "2026-01-01T10:00:00.000Z",
  updatedAt: "2026-01-02T10:00:00.000Z",
};

const routing = {
  slug: "routing-engine",
  experience: "northwind-lead",
  name: "Routing engine",
  summary: "A **fictional** route planner for delivery vans.",
  problem: "Dispatchers planned routes by hand.",
  workDone: "Designed and built the planning service.",
  result: "Routes are planned in minutes.",
  startedOn: "2022-01-01",
  endedOn: "2022-09-30",
  links: [{ label: "Product page", url: "https://example.com/routing" }],
  selectedForHomepage: true,
  position: 1,
  technologies: ["typescript", "postgres"],
  coverId: "0b8f5c2e-1d4a-4f6b-9c3e-2a7d8e9f0a1b",
};

const technology = {
  ...stored,
  slug: "typescript",
  name: "TypeScript",
  tier: "primary",
  group: "core",
  logoKey: null,
  position: 1,
};

describe("ProjectCreateSchema", () => {
  it("accepts a project with every field", () => {
    expect(ProjectCreateSchema.parse(routing)).toEqual(routing);
  });

  it("accepts an open end and an end on the day of the start", () => {
    expect(ProjectCreateSchema.parse({ ...routing, endedOn: null })).toMatchObject({
      endedOn: null,
    });
    const sameDay = { ...routing, startedOn: "2024-01-01", endedOn: "2024-01-01" };
    expect(ProjectCreateSchema.parse(sameDay)).toMatchObject({ endedOn: "2024-01-01" });
  });

  it("fills an unset end, links, homepage selection and technologies", () => {
    const minimal = {
      slug: "fleet-dashboard",
      experience: "northwind-lead",
      name: "Fleet dashboard",
      summary: "Shows where the vans are.",
      problem: "Nobody knew where the vans were.",
      workDone: "Built the dashboard.",
      result: "Fewer phone calls.",
      startedOn: "2023-01-01",
      position: 0,
    };
    expect(ProjectCreateSchema.parse(minimal)).toEqual({
      ...minimal,
      endedOn: null,
      links: [],
      selectedForHomepage: false,
      technologies: [],
      coverId: null,
    });
  });

  it("trims the texts", () => {
    expect(
      ProjectCreateSchema.parse({
        ...routing,
        name: " Routing ",
        problem: " p ",
        workDone: " w ",
        result: " r ",
      }),
    ).toMatchObject({ name: "Routing", problem: "p", workDone: "w", result: "r" });
  });

  it.each([
    ["a missing slug", { ...routing, slug: undefined }],
    ["an invalid slug", { ...routing, slug: "Routing Engine" }],
    ["a missing experience", { ...routing, experience: undefined }],
    ["an experience that is not a slug", { ...routing, experience: "Northwind Lead" }],
    ["an embedded experience", { ...routing, experience: { slug: "northwind-lead" } }],
    ["no experience", { ...routing, experience: null }],
    ["a missing name", { ...routing, name: undefined }],
    ["an empty name", { ...routing, name: " " }],
    ["a name that is too long", { ...routing, name: "x".repeat(201) }],
    ["a missing summary", { ...routing, summary: undefined }],
    ["a summary that is too long", { ...routing, summary: "x".repeat(5001) }],
    ["a missing problem", { ...routing, problem: undefined }],
    ["an empty problem", { ...routing, problem: " " }],
    ["a problem that is too long", { ...routing, problem: "x".repeat(5001) }],
    ["a missing work description", { ...routing, workDone: undefined }],
    ["a work description that is too long", { ...routing, workDone: "x".repeat(10001) }],
    ["a missing result", { ...routing, result: undefined }],
    ["a result that is too long", { ...routing, result: "x".repeat(5001) }],
    ["a missing start", { ...routing, startedOn: undefined }],
    ["a start that is not a date", { ...routing, startedOn: "January 2022" }],
    ["an impossible end", { ...routing, endedOn: "2022-02-30" }],
    ["an end before the start", { ...routing, startedOn: "2024-01-02", endedOn: "2024-01-01" }],
    ["a link without a label", { ...routing, links: [{ url: "https://example.com" }] }],
    ["a link that is not http", { ...routing, links: [{ label: "x", url: "ftp://example.com" }] }],
    ["a link without a domain", { ...routing, links: [{ label: "x", url: "https://northwind/" }] }],
    ["a link with an unexpected field", { ...routing, links: [{ ...routing.links[0], x: 1 }] }],
    ["too many links", { ...routing, links: Array(21).fill(routing.links[0]) }],
    ["a homepage flag that is not a boolean", { ...routing, selectedForHomepage: "yes" }],
    ["a missing position", { ...routing, position: undefined }],
    ["a negative position", { ...routing, position: -1 }],
    ["a fractional position", { ...routing, position: 1.5 }],
    ["a technology that is not a slug", { ...routing, technologies: ["Type Script"] }],
    ["an embedded technology", { ...routing, technologies: [{ slug: "typescript" }] }],
    ["a repeated technology", { ...routing, technologies: ["typescript", "typescript"] }],
    [
      "too many technologies",
      { ...routing, technologies: [...Array(51).keys()].map((n) => `t${String(n)}`) },
    ],
    ["a cover that is a file name", { ...routing, coverId: "routing-cover.png" }],
    ["an embedded cover", { ...routing, cover: { id: routing.coverId } }],
    ["an embedded case study, which has its own route", { ...routing, caseStudy: { body: "x" } }],
    ["a visibility flag", { ...routing, visible: true }],
    ["a draft flag", { ...routing, draft: false }],
  ])("rejects %s", (_, input) => {
    expect(ProjectCreateSchema.safeParse(input).success).toBe(false);
  });

  it("names the end when it is before the start", () => {
    const result = ProjectCreateSchema.safeParse({ ...routing, endedOn: "2020-01-01" });
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([["endedOn"]]);
  });

  it("names the technologies when one is repeated", () => {
    const result = ProjectCreateSchema.safeParse({
      ...routing,
      technologies: ["typescript", "postgres", "typescript"],
    });
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([["technologies"]]);
  });
});

describe("ProjectUpdateSchema", () => {
  it("accepts a partial change without filling other fields", () => {
    expect(ProjectUpdateSchema.parse({ name: "Route planner" })).toEqual({
      name: "Route planner",
    });
    expect(ProjectUpdateSchema.parse({ result: "Faster" })).not.toHaveProperty("technologies");
  });

  it("accepts moving the project to another experience", () => {
    expect(ProjectUpdateSchema.parse({ experience: "acme-founder" })).toEqual({
      experience: "acme-founder",
    });
  });

  it("accepts a replacement of the technologies, including an empty one", () => {
    expect(ProjectUpdateSchema.parse({ technologies: ["postgres"] })).toEqual({
      technologies: ["postgres"],
    });
    expect(ProjectUpdateSchema.parse({ technologies: [] })).toEqual({ technologies: [] });
  });

  it("attaches and clears the cover by media identifier", () => {
    expect(ProjectUpdateSchema.parse({ coverId: routing.coverId })).toEqual({
      coverId: routing.coverId,
    });
    expect(ProjectUpdateSchema.parse({ coverId: null })).toEqual({ coverId: null });
  });

  it("accepts deselecting the project and reopening its end", () => {
    expect(ProjectUpdateSchema.parse({ selectedForHomepage: false, endedOn: null })).toEqual({
      selectedForHomepage: false,
      endedOn: null,
    });
  });

  it.each([
    ["an empty change", {}],
    ["a change of the slug", { slug: "renamed" }],
    ["detaching the project from its experience", { experience: null }],
    ["clearing the name", { name: null }],
    ["clearing the start", { startedOn: null }],
    ["clearing the technologies", { technologies: null }],
    ["an end before the start", { startedOn: "2024-01-02", endedOn: "2024-01-01" }],
    ["a repeated technology", { technologies: ["postgres", "postgres"] }],
    ["a cover that is a path", { coverId: "../cover.png" }],
    ["an embedded cover", { cover: null }],
  ])("rejects %s", (_, input) => {
    expect(ProjectUpdateSchema.safeParse(input).success).toBe(false);
  });
});

describe("ProjectSchema and ProjectListSchema", () => {
  const project = { ...stored, ...routing, technologies: [technology], caseStudy: null };

  it("describe stored projects with their owning experience and technologies", () => {
    expect(ProjectSchema.parse(project)).toEqual(project);
    expect(ProjectListSchema.parse([project])).toEqual([project]);
    expect(ProjectListSchema.parse([])).toEqual([]);
  });

  it("rejects a project without an owning experience", () => {
    expect(ProjectSchema.safeParse({ ...project, experience: null }).success).toBe(false);
  });

  it("is part of the experience it belongs to", () => {
    const experience = {
      ...stored,
      slug: "northwind-lead",
      title: "Lead Engineer",
      kind: "main_job",
      startedOn: "2021-03-01",
      endedOn: null,
      summary: "Led a fictional logistics platform.",
      responsibilities: [],
      inCv: true,
      organization: {
        ...stored,
        slug: "northwind",
        name: "Northwind Example",
        website: null,
        description: null,
        logoId: null,
      },
      technologies: [],
      projects: [project, { ...project, slug: "fleet", selectedForHomepage: false }],
      testimonials: [],
    };
    expect(ExperienceSchema.parse(experience)).toEqual(experience);
    expect(ExperienceSchema.safeParse({ ...experience, projects: undefined }).success).toBe(false);
  });
});
