import { describe, expect, it } from "vitest";

import type { Experience, Technology } from "@sebela/api-client";

import { toExperienceSnapshot } from "./experience-snapshot";

const STAMP = "2026-01-01T00:00:00.000Z";
const TODAY = new Date("2026-11-17T12:00:00Z");

/** A fictional experience as the public list returns it; current unless it says otherwise. */
function experience(overrides: Partial<Experience> = {}): Experience {
  return {
    id: "6c1d3e5f-7a9b-4c2d-8e0f-1a3b5c7d9e21",
    slug: "fictional-staff-engineer",
    title: "Staff engineer",
    kind: "main_job",
    startedOn: "2022-01-03",
    endedOn: null,
    summary: "Fictional work for tests.",
    responsibilities: [],
    inCv: true,
    organization: {
      id: "7d2e4f6a-8b0c-4d3e-9f1a-2b4c6d8e0f32",
      slug: "fictional-company",
      name: "Fictional Company",
      website: null,
      description: null,
      logoId: null,
      createdAt: STAMP,
      updatedAt: STAMP,
    },
    technologies: [],
    projects: [],
    testimonials: [],
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  };
}

function technology(overrides: Partial<Technology> = {}): Technology {
  return {
    id: "8e3f5a7b-9c1d-4e4f-8a2b-3c5d7e9f1a43",
    slug: "fictional-language",
    name: "Fictional Language",
    tier: "primary",
    group: "core",
    logoKey: null,
    position: 0,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  };
}

describe("toExperienceSnapshot", () => {
  it("counts the whole years of the career, not of one technology", () => {
    const snapshot = toExperienceSnapshot(
      { careerStartedOn: "2018-03-01", experiences: [], technologies: [] },
      TODAY,
    );

    expect(snapshot.years).toBe(8);
  });

  it("states no years without a career start", () => {
    const snapshot = toExperienceSnapshot(
      { careerStartedOn: null, experiences: [], technologies: [] },
      TODAY,
    );

    expect(snapshot.years).toBeNull();
  });

  it("lists the roles held now, in the API's order, with their organization and kind", () => {
    const snapshot = toExperienceSnapshot(
      {
        careerStartedOn: null,
        experiences: [
          experience({ slug: "lead", title: "Lead engineer" }),
          experience({ slug: "earlier", endedOn: "2021-12-31" }),
          experience({
            slug: "consulting",
            title: "Consultant",
            kind: "own_business",
            organization: { ...experience().organization, name: "Fictional Studio" },
          }),
        ],
        technologies: [],
      },
      TODAY,
    );

    expect(snapshot.current).toEqual([
      {
        slug: "lead",
        title: "Lead engineer",
        organization: "Fictional Company",
        kind: "Full-time job",
      },
      {
        slug: "consulting",
        title: "Consultant",
        organization: "Fictional Studio",
        kind: "Own business",
      },
    ]);
  });

  it("names the core and the AI engineering focus technologies apart, leaving the secondary ones out", () => {
    const snapshot = toExperienceSnapshot(
      {
        careerStartedOn: null,
        experiences: [],
        technologies: [
          technology({ slug: "typescript", name: "TypeScript" }),
          technology({ slug: "postgresql", name: "PostgreSQL" }),
          technology({ slug: "evals", name: "Evals", group: "ai_engineering_focus" }),
          technology({ slug: "python", name: "Python", tier: "secondary", group: null }),
        ],
      },
      TODAY,
    );

    expect(snapshot.core).toEqual(["TypeScript", "PostgreSQL"]);
    expect(snapshot.aiFocus).toEqual(["Evals"]);
  });

  it("is empty but present without any experience or technology", () => {
    expect(
      toExperienceSnapshot({ careerStartedOn: null, experiences: [], technologies: [] }, TODAY),
    ).toEqual({ years: null, current: [], core: [], aiFocus: [] });
  });
});
