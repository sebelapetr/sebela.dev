import { describe, expect, it } from "vitest";

import {
  CaseStudyCreateSchema,
  CaseStudySchema,
  CaseStudyUpdateSchema,
  ProjectSchema,
} from "./index.js";

const stored = {
  id: "7a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
  createdAt: "2026-01-01T10:00:00.000Z",
  updatedAt: "2026-01-02T10:00:00.000Z",
};

const narrative = {
  role: "Lead engineer of a fictional team of four.",
  body: "## Context\n\nA **fictional** dispatcher planned routes by hand.\n\n- one\n- two",
};

describe("CaseStudyCreateSchema", () => {
  it("accepts the role and the Markdown body as they are", () => {
    expect(CaseStudyCreateSchema.parse(narrative)).toEqual(narrative);
  });

  it("keeps Markdown and inline HTML as text, without rendering it", () => {
    const body = "<b>bold</b> and [a link](https://example.com)";
    expect(CaseStudyCreateSchema.parse({ ...narrative, body })).toEqual({ ...narrative, body });
  });

  it("trims the texts", () => {
    expect(CaseStudyCreateSchema.parse({ role: " Lead ", body: "\n Body \n" })).toEqual({
      role: "Lead",
      body: "Body",
    });
  });

  it("accepts the longest role and body", () => {
    const longest = { role: "r".repeat(500), body: "b".repeat(50000) };
    expect(CaseStudyCreateSchema.parse(longest)).toEqual(longest);
  });

  it.each([
    ["a missing role", { body: narrative.body }],
    ["an empty role", { ...narrative, role: " " }],
    ["a role that is too long", { ...narrative, role: "r".repeat(501) }],
    ["a role that is not text", { ...narrative, role: 1 }],
    ["a missing body", { role: narrative.role }],
    ["an empty body", { ...narrative, body: "\n" }],
    ["a body that is too long", { ...narrative, body: "b".repeat(50001) }],
    ["a body that is not text", { ...narrative, body: ["one"] }],
    ["a project in the body", { ...narrative, project: "routing-engine" }],
    ["rendered HTML", { ...narrative, html: "<p>x</p>" }],
    ["a visibility flag", { ...narrative, visible: true }],
  ])("rejects %s", (_, input) => {
    expect(CaseStudyCreateSchema.safeParse(input).success).toBe(false);
  });

  it("names the offending field", () => {
    const result = CaseStudyCreateSchema.safeParse({ ...narrative, body: "" });
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([["body"]]);
  });
});

describe("CaseStudyUpdateSchema", () => {
  it("accepts a change of one field without filling the other", () => {
    expect(CaseStudyUpdateSchema.parse({ role: "Architect" })).toEqual({ role: "Architect" });
    expect(CaseStudyUpdateSchema.parse({ body: "New" })).toEqual({ body: "New" });
  });

  it.each([
    ["an empty change", {}],
    ["clearing the role", { role: null }],
    ["clearing the body", { body: null }],
    ["a body that is too long", { body: "b".repeat(50001) }],
    ["moving it to another project", { project: "fleet-dashboard" }],
  ])("rejects %s", (_, input) => {
    expect(CaseStudyUpdateSchema.safeParse(input).success).toBe(false);
  });
});

describe("CaseStudySchema", () => {
  const caseStudy = { ...stored, project: "routing-engine", ...narrative };

  it("describes a stored case study with the slug of its project", () => {
    expect(CaseStudySchema.parse(caseStudy)).toEqual(caseStudy);
  });

  it("rejects a case study without its project", () => {
    expect(CaseStudySchema.safeParse({ ...caseStudy, project: undefined }).success).toBe(false);
  });

  it("is part of the project it explains, or null while there is none", () => {
    const project = {
      ...stored,
      slug: "routing-engine",
      experience: "northwind-lead",
      name: "Routing engine",
      summary: "A fictional route planner.",
      problem: "Routes were planned by hand.",
      workDone: "Built the planner.",
      result: "Routes in minutes.",
      startedOn: "2022-01-01",
      endedOn: null,
      links: [],
      selectedForHomepage: true,
      position: 0,
      technologies: [],
      coverId: null,
      caseStudy,
    };
    expect(ProjectSchema.parse(project)).toEqual(project);
    expect(ProjectSchema.parse({ ...project, caseStudy: null })).toMatchObject({
      caseStudy: null,
    });
    expect(ProjectSchema.safeParse({ ...project, caseStudy: undefined }).success).toBe(false);
  });
});
