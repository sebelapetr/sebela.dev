import { describe, expect, it } from "vitest";

import type { Project } from "@sebela/api-client";

import { toSelectedWork } from "./selected-work";

const STAMP = "2026-01-01T00:00:00.000Z";

/** A fictional project as the public route returns it. */
function project(overrides: Partial<Project> = {}): Project {
  return {
    id: "2e4f6a8c-0b1d-4e3f-8a5c-7e9b1d3f5a70",
    slug: "fictional-route-planner",
    experience: "fictional-staff-engineer",
    name: "Route planner",
    summary: "Plans **fictional** delivery routes.",
    problem: "Drivers planned routes **by hand**.",
    workDone: "Built a planner over PostgreSQL.",
    result: "The team plans a day in minutes.",
    startedOn: "2022-05-02",
    endedOn: null,
    links: [],
    selectedForHomepage: true,
    position: 0,
    coverId: null,
    technologies: [
      {
        id: "4c5d6e7f-8a9b-4c0d-9e1f-2a3b4c5d6e70",
        slug: "postgresql",
        name: "PostgreSQL",
        tier: "primary",
        group: "core",
        logoKey: null,
        position: 1,
        createdAt: STAMP,
        updatedAt: STAMP,
      },
    ],
    caseStudy: null,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  };
}

const caseStudy = {
  id: "8f9e0d1c-2b3a-4c5d-8e6f-7a8b9c0d1e20",
  project: "fictional-route-planner",
  role: "Lead engineer",
  body: "A **fictional** account.",
  createdAt: STAMP,
  updatedAt: STAMP,
};

describe("toSelectedWork", () => {
  it("maps a selected project with a case study to a teaser that links to the case study", () => {
    expect(toSelectedWork([project({ caseStudy, endedOn: "2023-01-31" })])).toEqual([
      {
        slug: "fictional-route-planner",
        number: "01",
        name: "Route planner",
        period: "May 2nd, 2022 – January 31st, 2023",
        technologies: [{ slug: "postgresql", name: "PostgreSQL" }],
        problem: "Drivers planned routes **by hand**.",
        role: "Lead engineer",
        result: "The team plans a day in minutes.",
        href: "/experience#case-study-fictional-route-planner",
      },
    ]);
  });

  it("links a project without a case study to the project, with no role", () => {
    const [item] = toSelectedWork([project({ caseStudy: null })]);

    expect(item?.role).toBeNull();
    expect(item?.href).toBe("/experience#project-fictional-route-planner");
  });

  it("reads an ongoing project's period as present", () => {
    expect(toSelectedWork([project({ endedOn: null })])[0]?.period).toBe("May 2nd, 2022 – present");
  });

  it("keeps only the selected projects, in the API's order, numbered from 01", () => {
    const items = toSelectedWork([
      project({ slug: "first" }),
      project({ slug: "not-selected", selectedForHomepage: false }),
      project({ slug: "second" }),
    ]);

    expect(items.map((item) => [item.number, item.slug])).toEqual([
      ["01", "first"],
      ["02", "second"],
    ]);
  });

  it("is empty when no project is selected", () => {
    expect(toSelectedWork([project({ selectedForHomepage: false })])).toEqual([]);
    expect(toSelectedWork([])).toEqual([]);
  });
});
