import { describe, expect, it } from "vitest";

import { anchorHref, anchorId, roadmapHref } from "./anchors";

describe("anchorId", () => {
  it("names each kind of item by its stable slug", () => {
    expect(anchorId({ kind: "experience", slug: "fictional-staff-engineer" })).toBe(
      "experience-fictional-staff-engineer",
    );
    expect(anchorId({ kind: "project", slug: "route-planner" })).toBe("project-route-planner");
    expect(anchorId({ kind: "case-study", project: "route-planner" })).toBe(
      "case-study-route-planner",
    );
  });

  it("names an exploration by its slug and a technology group by its group", () => {
    expect(anchorId({ kind: "exploration", slug: "local-agent" })).toBe("exploration-local-agent");
    expect(anchorId({ kind: "technology-group", group: "core" })).toBe("technology-group-core");
    expect(anchorId({ kind: "technology-group", group: "ai-engineering-focus" })).toBe(
      "technology-group-ai-engineering-focus",
    );
    expect(anchorId({ kind: "technology-group", group: "secondary" })).toBe(
      "technology-group-secondary",
    );
  });

  it("names the independent R&D block", () => {
    expect(anchorId({ kind: "independent-rd" })).toBe("independent-rd");
  });

  it("names a service by its slug", () => {
    expect(anchorId({ kind: "service", slug: "process-automation" })).toBe(
      "service-process-automation",
    );
  });

  it("names a roadmap resource by its slug", () => {
    expect(
      anchorId({
        kind: "roadmap-resource",
        area: "orbit-foundations",
        module: "signal-basics",
        slug: "signal-notes",
      }),
    ).toBe("resource-signal-notes");
  });

  it("gives a project and its case study different anchors", () => {
    expect(anchorId({ kind: "project", slug: "route-planner" })).not.toBe(
      anchorId({ kind: "case-study", project: "route-planner" }),
    );
  });
});

describe("anchorHref", () => {
  it("points at the item on the experience page", () => {
    expect(anchorHref({ kind: "experience", slug: "fictional-staff-engineer" })).toBe(
      "/experience#experience-fictional-staff-engineer",
    );
    expect(anchorHref({ kind: "project", slug: "route-planner" })).toBe(
      "/experience#project-route-planner",
    );
    expect(anchorHref({ kind: "case-study", project: "route-planner" })).toBe(
      "/experience#case-study-route-planner",
    );
    expect(anchorHref({ kind: "exploration", slug: "local-agent" })).toBe(
      "/experience#exploration-local-agent",
    );
    expect(anchorHref({ kind: "technology-group", group: "secondary" })).toBe(
      "/experience#technology-group-secondary",
    );
    expect(anchorHref({ kind: "independent-rd" })).toBe("/experience#independent-rd");
  });

  it("points at a service on the services page", () => {
    expect(anchorHref({ kind: "service", slug: "process-automation" })).toBe(
      "/services#service-process-automation",
    );
  });
});

describe("roadmap addresses", () => {
  it("points at a roadmap resource on its module's page", () => {
    expect(
      anchorHref({
        kind: "roadmap-resource",
        area: "orbit-foundations",
        module: "signal-basics",
        slug: "signal-notes",
      }),
    ).toBe("/ai-roadmap/orbit-foundations/signal-basics#resource-signal-notes");
  });

  it("addresses an area and a module by their nested pages", () => {
    expect(roadmapHref({ area: "orbit-foundations" })).toBe("/ai-roadmap/orbit-foundations");
    expect(roadmapHref({ area: "orbit-foundations", module: "signal-basics" })).toBe(
      "/ai-roadmap/orbit-foundations/signal-basics",
    );
  });

  it("never lets a slug leave the roadmap's pages", () => {
    expect(roadmapHref({ area: "../cv" })).toBe("/ai-roadmap/..%2Fcv");
    expect(roadmapHref({ area: "a", module: "b?c#d" })).toBe("/ai-roadmap/a/b%3Fc%23d");
    expect(anchorHref({ kind: "roadmap-resource", area: "a/b", module: "c", slug: "d" })).toBe(
      "/ai-roadmap/a%2Fb/c#resource-d",
    );
  });
});
