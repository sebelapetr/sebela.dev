import { describe, expect, it } from "vitest";

import type { ExplorationRow } from "../data/explorations";
import type { TechnologyGroup } from "../data/technologies";
import type { TimelineEntry, TimelineProject } from "../data/timeline";
import { deepLinkIndex, deepLinkScrollBehavior, inPageHash, resolveDeepLink } from "./deep-link";

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

function explorationRow(slug: string): ExplorationRow {
  return {
    slug,
    anchor: `exploration-${slug}`,
    name: "A fictional exploration",
    status: "tested",
    statusLabel: "Tested",
    statusMeaning: "Tried hands-on",
    summary: "Summary.",
    concepts: [],
  };
}

function group(key: TechnologyGroup["key"]): TechnologyGroup {
  return {
    key,
    anchor: `technology-group-${key}`,
    label: "A fictional group",
    technologies: [{ slug: "fictional", name: "Fictional", logoKey: null }],
  };
}

const page = { timeline: entries, explorations: [], technologies: [] };

describe("deepLinkIndex", () => {
  it("lists every anchor with the disclosures to open, outermost first", () => {
    expect(deepLinkIndex(page)).toEqual({
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
    expect(deepLinkIndex(page)).not.toHaveProperty("case-study-export");
  });

  it("addresses the R&D block and each exploration without opening anything", () => {
    const index = deepLinkIndex({
      timeline: [],
      explorations: [explorationRow("local-agent"), explorationRow("memory-graph")],
      technologies: [],
    });

    expect(index).toEqual({
      "independent-rd": [],
      "exploration-local-agent": [],
      "exploration-memory-graph": [],
    });
  });

  it("opens the collapsed list of secondary technologies, and nothing for the other groups", () => {
    const index = deepLinkIndex({
      timeline: [],
      explorations: [],
      technologies: [group("core"), group("ai-engineering-focus"), group("secondary")],
    });

    expect(index).toEqual({
      "technology-group-core": [],
      "technology-group-ai-engineering-focus": [],
      "technology-group-secondary": ["technology-group-secondary"],
    });
  });

  it("is empty on a page without content", () => {
    expect(deepLinkIndex({ timeline: [], explorations: [], technologies: [] })).toEqual({});
  });
});

describe("resolveDeepLink", () => {
  const index = deepLinkIndex({
    timeline: entries,
    explorations: [explorationRow("local-agent")],
    technologies: [group("secondary")],
  });

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

  it("opens the secondary technologies a hash names", () => {
    expect(resolveDeepLink("#technology-group-secondary", index)).toEqual({
      anchor: "technology-group-secondary",
      open: ["technology-group-secondary"],
    });
  });

  it("brings an exploration into view without opening anything", () => {
    expect(resolveDeepLink("#exploration-local-agent", index)).toEqual({
      anchor: "exploration-local-agent",
      open: [],
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
    ["a removed exploration", "#exploration-removed"],
    ["a technology group the page does not show", "#technology-group-core"],
    ["a case study of a project without one", "#case-study-export"],
    ["a malformed encoding", "#project-%E0%A4%A"],
    ["a name every object inherits", "#constructor"],
    ["the prototype", "#__proto__"],
    ["an anchor in another case", "#PROJECT-EXPORT"],
  ])("opens nothing for %s", (_label, hash) => {
    expect(resolveDeepLink(hash, index)).toBeNull();
  });
});

describe("deepLinkScrollBehavior", () => {
  it("jumps at once when the page loads with a link, whatever the motion preference", () => {
    expect(deepLinkScrollBehavior("load", false)).toBe("instant");
    expect(deepLinkScrollBehavior("load", true)).toBe("instant");
  });

  it("scrolls smoothly when the visitor navigates within the page", () => {
    expect(deepLinkScrollBehavior("navigation", false)).toBe("smooth");
  });

  it("jumps at once within the page when reduced motion is requested", () => {
    expect(deepLinkScrollBehavior("navigation", true)).toBe("instant");
  });
});

describe("inPageHash", () => {
  const current = "https://site.example/experience?tab=1#project-export";

  it.each([
    ["a bare hash", "#case-study-export", "#case-study-export"],
    ["the same page with a hash", "/experience?tab=1#project-other", "#project-other"],
    ["an absolute address of the same page", "https://site.example/experience?tab=1#x", "#x"],
    ["the hash the page already shows", "#project-export", "#project-export"],
  ])("returns the hash of %s", (_label, href, hash) => {
    expect(inPageHash(href, current)).toBe(hash);
  });

  it.each([
    ["another page", "/services#service-a"],
    ["the same path with another query", "/experience#project-other"],
    ["another origin", "https://other.example/experience?tab=1#project-other"],
    ["the page without a hash", "/experience?tab=1"],
    ["an empty hash", "/experience?tab=1#"],
    ["a mail link", "mailto:someone@site.example"],
  ])("returns null for %s", (_label, href) => {
    expect(inPageHash(href, current)).toBeNull();
  });
});
