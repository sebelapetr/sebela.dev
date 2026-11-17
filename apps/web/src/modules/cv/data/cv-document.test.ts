import { describe, expect, it } from "vitest";

import type { CvExploration, Education, Experience, Technology } from "@sebela/api-client";

import type { CvContent } from "../../profile";

import { toCvDocument } from "./cv-document";

const STAMP = "2026-01-01T00:00:00.000Z";

function experience(slug: string, overrides: Partial<Experience> = {}): Experience {
  return {
    id: "6a1f3c2e-0b4d-4e7a-9c11-2f8d5b6e7a01",
    slug,
    title: "Engineer",
    kind: "main_job",
    startedOn: "2020-01-01",
    endedOn: null,
    summary: "Fictional **work**.",
    responsibilities: ["Kept a fictional service running."],
    inCv: true,
    organization: {
      id: "3c9e1b7a-5d2f-4a6b-8e0c-1f2a3b4c5d60",
      slug: "fictional-org",
      name: "Fictional Org",
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

function technology(slug: string, name: string): Technology {
  return {
    id: "4a5b6c7d-8e9f-4a0b-9c1d-2e3f4a5b6c7d",
    slug,
    name,
    tier: "primary",
    group: "core",
    logoKey: null,
    position: 0,
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

function exploration(slug: string, overrides: Partial<CvExploration> = {}): CvExploration {
  return {
    id: "8b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e",
    slug,
    name: `Exploration ${slug}`,
    summary: "A fictional idea.",
    status: "built",
    concepts: ["a concept"],
    startedOn: "2025-02-01",
    endedOn: null,
    technologies: [],
    ...overrides,
  };
}

function education(slug: string, overrides: Partial<Education> = {}): Education {
  return {
    id: "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f",
    slug,
    kind: "school",
    title: `Fictional ${slug}`,
    institution: "Fictional University",
    startedOn: "2010-09-01",
    endedOn: "2014-06-30",
    description: null,
    position: 0,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  };
}

function content(overrides: Partial<CvContent> = {}): CvContent {
  return {
    name: "Robin Example",
    headline: "Fictional engineer for tests",
    location: "Fictional City",
    shortBio: "Robin is **made up** for the tests.",
    contact: {
      email: { address: "robin@example.test", href: "mailto:robin@example.test" },
      links: [{ label: "Code", url: "https://code.example.test/robin" }],
    },
    experiences: [],
    technologies: { primary: { core: [], aiEngineeringFocus: [] }, secondary: [] },
    education: [],
    explorations: [],
    cvPdf: { updatedOn: "2026-03-14" },
    ...overrides,
  };
}

describe("toCvDocument", () => {
  it("keeps the header, the contacts, the summary and the PDF as they were read", () => {
    const document = toCvDocument(content());

    expect(document.header).toEqual({
      name: "Robin Example",
      headline: "Fictional engineer for tests",
      location: "Fictional City",
      email: { address: "robin@example.test", href: "mailto:robin@example.test" },
      links: [{ label: "Code", url: "https://code.example.test/robin" }],
    });
    expect(document.summary).toBe("Robin is **made up** for the tests.");
    expect(document.pdf).toEqual({ updatedOn: "2026-03-14" });
  });

  it("lists exactly the experiences the API selected, in the API's order", () => {
    const document = toCvDocument(
      content({
        experiences: [
          experience("current", {
            title: "Staff engineer",
            kind: "side_project",
            technologies: [technology("typescript", "TypeScript"), technology("react", "React")],
          }),
          experience("older", { startedOn: "2016-03-01", endedOn: "2019-12-31" }),
        ],
      }),
    );

    expect(document.experiences).toEqual([
      {
        slug: "current",
        title: "Staff engineer",
        organization: "Fictional Org",
        kindLabel: "Side project",
        period: "January 1st, 2020 – present",
        summary: "Fictional **work**.",
        responsibilities: ["Kept a fictional service running."],
        technologies: ["TypeScript", "React"],
      },
      {
        slug: "older",
        title: "Engineer",
        organization: "Fictional Org",
        kindLabel: "Full-time job",
        period: "March 1st, 2016 – December 31st, 2019",
        summary: "Fictional **work**.",
        responsibilities: ["Kept a fictional service running."],
        technologies: [],
      },
    ]);
  });

  it("keeps the independent R&D apart from the experiences, one line each with its status", () => {
    const document = toCvDocument(
      content({
        experiences: [experience("job")],
        explorations: [
          exploration("agent", { status: "built", endedOn: "2025-06-30" }),
          exploration("graph", { status: "tested" }),
          exploration("planner", { status: "designed", startedOn: "2026-01-05" }),
        ],
      }),
    );

    expect(document.experiences.map(({ slug }) => slug)).toEqual(["job"]);
    expect(document.explorations).toEqual([
      {
        slug: "agent",
        name: "Exploration agent",
        status: "built",
        statusLabel: "Built",
        statusMeaning: "Implemented and working",
        period: "February 1st, 2025 – June 30th, 2025",
        summary: "A fictional idea.",
      },
      {
        slug: "graph",
        name: "Exploration graph",
        status: "tested",
        statusLabel: "Tested",
        statusMeaning: "Tried hands-on",
        period: "February 1st, 2025 – present",
        summary: "A fictional idea.",
      },
      {
        slug: "planner",
        name: "Exploration planner",
        status: "designed",
        statusLabel: "Designed",
        statusMeaning: "Unimplemented design, planned or architected only",
        period: "January 5th, 2026 – present",
        summary: "A fictional idea.",
      },
    ]);
  });

  it("groups the skills as core, AI engineering focus and other, each in catalog order", () => {
    const document = toCvDocument(
      content({
        technologies: {
          primary: {
            core: [technology("typescript", "TypeScript"), technology("postgres", "PostgreSQL")],
            aiEngineeringFocus: [technology("evals", "Evals")],
          },
          secondary: [technology("docker", "Docker")],
        },
      }),
    );

    expect(document.skills).toEqual([
      { key: "core", label: "Core", technologies: ["TypeScript", "PostgreSQL"] },
      { key: "ai-engineering-focus", label: "AI engineering focus", technologies: ["Evals"] },
      { key: "secondary", label: "Other technologies & tools", technologies: ["Docker"] },
    ]);
  });

  it("leaves out a skill group without technologies", () => {
    const document = toCvDocument(
      content({
        technologies: {
          primary: { core: [technology("typescript", "TypeScript")], aiEngineeringFocus: [] },
          secondary: [],
        },
      }),
    );

    expect(document.skills.map(({ key }) => key)).toEqual(["core"]);
  });

  it("lists the education in the API's order", () => {
    const document = toCvDocument(
      content({
        education: [
          education("workshop", { kind: "course", startedOn: null, endedOn: "2021-05-20" }),
          education("degree"),
        ],
      }),
    );

    expect(
      document.education.map(({ slug, kindLabel, period }) => ({ slug, kindLabel, period })),
    ).toEqual([
      { slug: "workshop", kindLabel: "Course", period: "May 20th, 2021" },
      {
        slug: "degree",
        kindLabel: "School",
        period: "September 1st, 2010 – June 30th, 2014",
      },
    ]);
  });

  it("is a usable CV without a PDF", () => {
    const document = toCvDocument(content({ cvPdf: null }));

    expect(document.pdf).toBeNull();
    expect(document.header.name).toBe("Robin Example");
  });
});
