import { describe, expect, it } from "vitest";

import type {
  Experience,
  Exploration,
  RoadmapCurrentArea,
  Service,
  Technology,
} from "@sebela/api-client";

import type { AskContent } from "../../profile";
import { toAskEvidence } from "./evidence";

const STAMP = "2026-01-01T00:00:00.000Z";

function technology(
  slug: string,
  tier: Technology["tier"] = "primary",
  group: Technology["group"] = "core",
): Technology {
  return {
    id: "4a5b6c7d-8e9f-4a0b-9c1d-2e3f4a5b6c7d",
    slug,
    name: `Tech ${slug}`,
    tier,
    group,
    logoKey: null,
    position: 0,
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

function project(slug: string, caseStudy: boolean): Experience["projects"][number] {
  return {
    id: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
    slug,
    experience: "fictional-role",
    name: `Project ${slug}`,
    summary: "Made up.",
    problem: "Made up.",
    workDone: "Made up.",
    result: "Made up.",
    startedOn: "2021-01-01",
    endedOn: null,
    links: [],
    selectedForHomepage: false,
    position: 0,
    coverId: null,
    technologies: [],
    caseStudy: caseStudy
      ? {
          id: "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e",
          project: slug,
          role: "Made up.",
          body: "Made up.",
          createdAt: STAMP,
          updatedAt: STAMP,
        }
      : null,
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

function experience(slug: string, overrides: Partial<Experience> = {}): Experience {
  return {
    id: "6a1f3c2e-0b4d-4e7a-9c11-2f8d5b6e7a01",
    slug,
    title: "Engineer",
    kind: "main_job",
    startedOn: "2020-01-01",
    endedOn: "2022-06-30",
    summary: "Built **fictional** systems for [made-up](https://example.test) clients.",
    responsibilities: [],
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
    technologies: [technology("typescript"), technology("postgres")],
    projects: [project("route-tool", true), project("export-tool", false)],
    testimonials: [],
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  };
}

function service(slug: string): Service {
  return {
    id: "5d6e7f80-9a1b-4c2d-8e3f-4a5b6c7d8e9f",
    slug,
    name: `Service ${slug}`,
    summary: "A *made-up* offer.",
    audience: "Fictional firms.",
    deliverable: "A fictional result.",
    position: 0,
    evidence: [],
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

function exploration(slug: string, status: Exploration["status"]): Exploration {
  return {
    id: "8b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e",
    slug,
    name: `Exploration ${slug}`,
    summary: "Tries a `fictional` idea.",
    status,
    concepts: [],
    startedOn: "2025-02-01",
    endedOn: null,
    position: 0,
    technologies: [],
    topics: [],
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

function currentProgress(completed: number, total: number): RoadmapCurrentArea["progress"] {
  return {
    completed,
    total,
    status: "in-progress",
    completedAt: null,
    lastUpdatedAt: STAMP,
    estimatedMinutes: 0,
  };
}

function currentArea(
  slug: string,
  modules: [slug: string, description: string | null][],
): RoadmapCurrentArea {
  return {
    id: "7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f",
    slug,
    name: `Area ${slug}`,
    description: null,
    weight: 10,
    position: 0,
    createdAt: STAMP,
    updatedAt: STAMP,
    progress: currentProgress(1, 5),
    modules: modules.map(([moduleSlug, description]) => ({
      id: "8d9e0f1a-2b3c-4d4e-8f5a-6b7c8d9e0f1a",
      slug: moduleSlug,
      name: `Module ${moduleSlug}`,
      description,
      position: 0,
      createdAt: STAMP,
      updatedAt: STAMP,
      progress: currentProgress(1, 2),
    })),
  };
}

function content(overrides: Partial<AskContent> = {}): AskContent {
  return {
    name: "Robin Example",
    email: "robin@example.test",
    links: [{ label: "Code", url: "https://code.example.test/robin" }],
    experiences: [experience("fictional-role")],
    services: [service("automation")],
    explorations: [exploration("answer-checks", "designed")],
    technologies: [
      technology("typescript"),
      technology("retrieval", "primary", "ai_engineering_focus"),
    ],
    currentLearning: [],
    ...overrides,
  };
}

describe("toAskEvidence", () => {
  it("keeps the name and the contact the answers can offer", () => {
    expect(toAskEvidence(content())).toMatchObject({
      name: "Robin Example",
      contact: {
        email: "robin@example.test",
        links: [{ label: "Code", url: "https://code.example.test/robin" }],
      },
    });
  });

  it("keeps each experience with its period, plain summary, technologies and projects", () => {
    expect(toAskEvidence(content()).experiences).toEqual([
      {
        slug: "fictional-role",
        title: "Engineer",
        organization: "Fictional Org",
        startedOn: "2020-01-01",
        endedOn: "2022-06-30",
        summary: "Built fictional systems for made-up clients.",
        technologies: ["Tech typescript", "Tech postgres"],
        projects: [
          { slug: "route-tool", name: "Project route-tool", caseStudy: true },
          { slug: "export-tool", name: "Project export-tool", caseStudy: false },
        ],
      },
    ]);
  });

  it("keeps each service and each exploration with its stored status", () => {
    const evidence = toAskEvidence(
      content({
        explorations: [
          exploration("answer-checks", "built"),
          exploration("chunking", "tested"),
          exploration("tool-scopes", "designed"),
        ],
      }),
    );

    expect(evidence.services).toEqual([
      { slug: "automation", name: "Service automation", summary: "A made-up offer." },
    ]);
    expect(evidence.explorations.map(({ slug, status }) => [slug, status])).toEqual([
      ["answer-checks", "built"],
      ["chunking", "tested"],
      ["tool-scopes", "designed"],
    ]);
    expect(evidence.explorations[0]?.summary).toBe("Tries a fictional idea.");
  });

  it("keeps every module in progress on the roadmap with its area, in the API's order", () => {
    const evidence = toAskEvidence(
      content({
        currentLearning: [
          currentArea("signals", [
            ["signal-basics", "Learns *fictional* signals."],
            ["signal-depth", null],
          ]),
          currentArea("queues", [["calm-queues", "  "]]),
        ],
      }),
    );

    expect(evidence.learning).toEqual([
      {
        area: "signals",
        areaName: "Area signals",
        slug: "signal-basics",
        name: "Module signal-basics",
        summary: "Learns fictional signals.",
        completed: 1,
        total: 2,
      },
      {
        area: "signals",
        areaName: "Area signals",
        slug: "signal-depth",
        name: "Module signal-depth",
        summary: null,
        completed: 1,
        total: 2,
      },
      {
        area: "queues",
        areaName: "Area queues",
        slug: "calm-queues",
        name: "Module calm-queues",
        summary: null,
        completed: 1,
        total: 2,
      },
    ]);
  });

  it("has no learning when nothing on the roadmap is in progress", () => {
    expect(toAskEvidence(content()).learning).toEqual([]);
  });

  it("names the technology groups the experience page shows, in its order", () => {
    expect(toAskEvidence(content()).technologyGroups).toEqual(["core", "ai-engineering-focus"]);
    expect(
      toAskEvidence(content({ technologies: [technology("bash", "secondary", null)] }))
        .technologyGroups,
    ).toEqual(["secondary"]);
  });

  it("gives a record without a summary none, never an empty one", () => {
    const evidence = toAskEvidence(
      content({ experiences: [experience("fictional-role", { summary: "  " })] }),
    );
    expect(evidence.experiences[0]?.summary).toBeNull();
  });

  it("is plain data that survives being passed to the browser", () => {
    const evidence = toAskEvidence(content());
    expect(JSON.parse(JSON.stringify(evidence))).toEqual(evidence);
  });
});
