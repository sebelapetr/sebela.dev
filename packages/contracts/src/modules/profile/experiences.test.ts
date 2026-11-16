import { describe, expect, it } from "vitest";

import {
  ExperienceCreateSchema,
  ExperienceListSchema,
  ExperienceSchema,
  ExperienceUpdateSchema,
  experienceKinds,
} from "./index.js";

const stored = {
  id: "3c9e1f7a-5b2d-4e8a-9f1c-7d6b5a4e3c2b",
  createdAt: "2026-01-01T10:00:00.000Z",
  updatedAt: "2026-01-02T10:00:00.000Z",
};

const lead = {
  slug: "northwind-lead",
  title: "Lead Engineer",
  kind: "main_job",
  organization: "northwind",
  startedOn: "2021-03-01",
  endedOn: "2024-06-30",
  summary: "Led a **fictional** logistics platform.",
  responsibilities: ["Designed the routing service", "Mentored two engineers"],
  inCv: true,
  technologies: ["typescript", "postgres"],
};

describe("experienceKinds", () => {
  it("lists the main job, side project and own business", () => {
    expect(experienceKinds).toEqual(["main_job", "side_project", "own_business"]);
  });
});

describe("ExperienceCreateSchema", () => {
  it("accepts an experience with every field", () => {
    expect(ExperienceCreateSchema.parse(lead)).toEqual(lead);
  });

  it("accepts an open end, which marks a current role", () => {
    expect(ExperienceCreateSchema.parse({ ...lead, endedOn: null })).toMatchObject({
      endedOn: null,
    });
  });

  it("accepts an end on the day of the start", () => {
    const sameDay = { ...lead, startedOn: "2024-01-01", endedOn: "2024-01-01" };
    expect(ExperienceCreateSchema.parse(sameDay)).toMatchObject({ endedOn: "2024-01-01" });
  });

  it("fills an unset end, responsibilities and technologies", () => {
    const minimal = {
      slug: "acme-tools",
      title: "Founder",
      kind: "own_business",
      organization: "acme",
      startedOn: "2023-01-01",
      summary: "Builds internal tools.",
      inCv: false,
    };
    expect(ExperienceCreateSchema.parse(minimal)).toEqual({
      ...minimal,
      endedOn: null,
      responsibilities: [],
      technologies: [],
    });
  });

  it("trims the title, the summary and each responsibility", () => {
    expect(
      ExperienceCreateSchema.parse({
        ...lead,
        title: "  Lead ",
        summary: " x ",
        responsibilities: [" a "],
      }),
    ).toMatchObject({ title: "Lead", summary: "x", responsibilities: ["a"] });
  });

  it.each([
    ["a missing slug", { ...lead, slug: undefined }],
    ["an invalid slug", { ...lead, slug: "Northwind Lead" }],
    ["a missing title", { ...lead, title: undefined }],
    ["an empty title", { ...lead, title: "  " }],
    ["a title that is too long", { ...lead, title: "x".repeat(201) }],
    ["an unknown kind", { ...lead, kind: "freelance" }],
    ["a missing organization", { ...lead, organization: undefined }],
    ["an organization that is not a slug", { ...lead, organization: "North Wind" }],
    ["an embedded organization", { ...lead, organization: { slug: "northwind" } }],
    ["a missing start", { ...lead, startedOn: undefined }],
    ["a start that is not a date", { ...lead, startedOn: "March 2021" }],
    ["a start with a time", { ...lead, startedOn: "2021-03-01T00:00:00Z" }],
    ["an impossible date", { ...lead, startedOn: "2021-02-30" }],
    ["an end before the start", { ...lead, startedOn: "2024-01-02", endedOn: "2024-01-01" }],
    ["a missing summary", { ...lead, summary: undefined }],
    ["an empty summary", { ...lead, summary: " " }],
    ["a summary that is too long", { ...lead, summary: "x".repeat(5001) }],
    ["an empty responsibility", { ...lead, responsibilities: [" "] }],
    ["a responsibility that is too long", { ...lead, responsibilities: ["x".repeat(501)] }],
    ["too many responsibilities", { ...lead, responsibilities: Array(31).fill("x") }],
    ["a missing CV flag", { ...lead, inCv: undefined }],
    ["a CV flag that is not a boolean", { ...lead, inCv: "yes" }],
    ["a technology that is not a slug", { ...lead, technologies: ["Type Script"] }],
    ["an embedded technology", { ...lead, technologies: [{ slug: "typescript" }] }],
    ["a repeated technology", { ...lead, technologies: ["typescript", "typescript"] }],
    [
      "too many technologies",
      { ...lead, technologies: [...Array(51).keys()].map((n) => `t${String(n)}`) },
    ],
    ["projects before they exist", { ...lead, projects: [] }],
    ["testimonials, which name their experience themselves", { ...lead, testimonials: [] }],
    ["an unexpected field", { ...lead, position: 1 }],
  ])("rejects %s", (_, input) => {
    expect(ExperienceCreateSchema.safeParse(input).success).toBe(false);
  });

  it("names the end when it is before the start", () => {
    const result = ExperienceCreateSchema.safeParse({ ...lead, endedOn: "2020-01-01" });
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([["endedOn"]]);
  });

  it("names the technologies when one is repeated", () => {
    const result = ExperienceCreateSchema.safeParse({
      ...lead,
      technologies: ["typescript", "postgres", "typescript"],
    });
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([["technologies"]]);
  });
});

describe("ExperienceUpdateSchema", () => {
  it("accepts a partial change without filling other fields", () => {
    expect(ExperienceUpdateSchema.parse({ title: "Staff Engineer" })).toEqual({
      title: "Staff Engineer",
    });
  });

  it("keeps the technologies unchanged when they are omitted", () => {
    expect(ExperienceUpdateSchema.parse({ inCv: false })).not.toHaveProperty("technologies");
  });

  it("accepts a replacement of the technologies, including an empty one", () => {
    expect(ExperienceUpdateSchema.parse({ technologies: ["postgres"] })).toEqual({
      technologies: ["postgres"],
    });
    expect(ExperienceUpdateSchema.parse({ technologies: [] })).toEqual({ technologies: [] });
  });

  it("accepts reopening the end and moving to another organization", () => {
    expect(ExperienceUpdateSchema.parse({ endedOn: null, organization: "acme" })).toEqual({
      endedOn: null,
      organization: "acme",
    });
  });

  it.each([
    ["an empty change", {}],
    ["a change of the slug", { slug: "renamed" }],
    ["clearing the title", { title: null }],
    ["clearing the start", { startedOn: null }],
    ["clearing the organization", { organization: null }],
    ["clearing the technologies", { technologies: null }],
    ["an end before the start", { startedOn: "2024-01-02", endedOn: "2024-01-01" }],
    ["a repeated technology", { technologies: ["postgres", "postgres"] }],
    ["an unknown kind", { kind: "internship" }],
  ])("rejects %s", (_, input) => {
    expect(ExperienceUpdateSchema.safeParse(input).success).toBe(false);
  });
});

describe("ExperienceSchema and ExperienceListSchema", () => {
  it("describe stored experiences with their organization, technologies and projects resolved", () => {
    const experience = {
      ...stored,
      ...lead,
      organization: {
        ...stored,
        slug: "northwind",
        name: "Northwind Example",
        website: null,
        description: null,
      },
      technologies: [
        {
          ...stored,
          slug: "typescript",
          name: "TypeScript",
          tier: "primary",
          group: "core",
          logoKey: null,
          position: 1,
        },
      ],
      projects: [],
      testimonials: [],
    };
    expect(ExperienceSchema.parse(experience)).toEqual(experience);
    expect(ExperienceListSchema.parse([experience])).toEqual([experience]);
    expect(ExperienceListSchema.parse([])).toEqual([]);
  });

  it("rejects an organization given only by its slug", () => {
    expect(ExperienceSchema.safeParse({ ...stored, ...lead }).success).toBe(false);
  });
});
