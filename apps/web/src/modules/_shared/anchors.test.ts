import { describe, expect, it } from "vitest";

import { anchorHref, anchorId } from "./anchors";

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
  });
});
