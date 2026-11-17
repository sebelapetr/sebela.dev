import { describe, expect, it } from "vitest";

import type { TimelineEntry, TimelineProject } from "../data/timeline";
import { deepLinkIndex, resolveDeepLink } from "./deep-link";

function project(slug: string, withCaseStudy: boolean): TimelineProject {
  return {
    slug,
    anchor: `project-${slug}`,
    name: "A fictional project",
    period: "May 2nd, 2022 – present",
    summary: "Summary.",
    problem: "Problem.",
    workDone: "Work.",
    result: "Result.",
    technologies: [],
    caseStudy: withCaseStudy
      ? { anchor: `case-study-${slug}`, role: "Lead engineer", body: "Body." }
      : null,
  };
}

function entry(slug: string, projects: readonly TimelineProject[]): TimelineEntry {
  return {
    slug,
    anchor: `experience-${slug}`,
    title: "A fictional role",
    organization: { name: "Fictional Org", website: null, logo: null },
    kind: "main_job",
    kindLabel: "Full-time job",
    period: "May 2nd, 2022 – present",
    current: false,
    summary: "Summary.",
    responsibilities: [],
    technologies: [],
    projects,
    testimonials: [],
  };
}

const entries = [
  entry("current-role", [project("planner", true)]),
  entry("older-role", [project("scheduling", true), project("export", false)]),
];

describe("deepLinkIndex", () => {
  it("lists every anchor with the disclosures to open, outermost first", () => {
    expect(deepLinkIndex(entries)).toEqual({
      "experience-current-role": ["experience-current-role"],
      "project-planner": ["experience-current-role"],
      "case-study-planner": ["experience-current-role", "case-study-planner"],
      "experience-older-role": ["experience-older-role"],
      "project-scheduling": ["experience-older-role"],
      "case-study-scheduling": ["experience-older-role", "case-study-scheduling"],
      "project-export": ["experience-older-role"],
    });
  });

  it("has no case-study anchor for a project without a case study", () => {
    expect(deepLinkIndex(entries)).not.toHaveProperty("case-study-export");
  });

  it("is empty without experiences", () => {
    expect(deepLinkIndex([])).toEqual({});
  });
});

describe("resolveDeepLink", () => {
  const index = deepLinkIndex(entries);

  it("opens the experience and the case study a hash names inside a closed experience", () => {
    expect(resolveDeepLink("#case-study-scheduling", index)).toEqual({
      anchor: "case-study-scheduling",
      open: ["experience-older-role", "case-study-scheduling"],
    });
  });

  it("opens the experience that holds a project", () => {
    expect(resolveDeepLink("#project-export", index)).toEqual({
      anchor: "project-export",
      open: ["experience-older-role"],
    });
  });

  it("accepts a hash without its #", () => {
    expect(resolveDeepLink("experience-older-role", index)).toEqual({
      anchor: "experience-older-role",
      open: ["experience-older-role"],
    });
  });

  it("decodes a percent-encoded hash", () => {
    expect(resolveDeepLink("#project%2Dexport", index)?.anchor).toBe("project-export");
  });

  it.each([
    ["an empty hash", ""],
    ["a lone #", "#"],
    ["an unknown anchor", "#project-removed"],
    ["a case study of a project without one", "#case-study-export"],
    ["a malformed encoding", "#project-%E0%A4%A"],
    ["a name every object inherits", "#constructor"],
    ["the prototype", "#__proto__"],
    ["an anchor in another case", "#PROJECT-EXPORT"],
  ])("opens nothing for %s", (_label, hash) => {
    expect(resolveDeepLink(hash, index)).toBeNull();
  });
});
