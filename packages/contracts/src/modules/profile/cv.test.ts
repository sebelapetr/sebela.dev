import { describe, expect, it } from "vitest";

import { CvExplorationSchema, CvSchema, explorationStatuses } from "./index.js";

const stored = {
  createdAt: "2026-01-01T10:00:00.000Z",
  updatedAt: "2026-01-02T10:00:00.000Z",
};

/** A fictional person. */
const person = {
  ...stored,
  id: "0a6f1b2c-3d4e-4f5a-8b6c-7d8e9f0a1b2c",
  name: "Alex Example",
  headline: "Fictional engineer",
  shortBio: "A **fictional** person used in tests.",
  longBio: null,
  location: "Harbour City",
  email: "alex@example.test",
  links: [{ label: "Website", url: "https://alex.example.test/" }],
  availability: null,
  careerStartedOn: "2012-09-01",
  servicesIntro: null,
  collaborationSteps: [],
  servicesNote: null,
  photoId: null,
  cvPdfId: "1b7a2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d",
};

const typescript = {
  ...stored,
  id: "2c8b3d4e-5f6a-4b7c-8d8e-9f0a1b2c3d4e",
  slug: "typescript",
  name: "TypeScript",
  tier: "primary",
  group: "core",
  logoKey: null,
  position: 0,
};

const evals = {
  ...typescript,
  id: "3d9c4e5f-6a7b-4c8d-9e9f-0a1b2c3d4e5f",
  slug: "evals",
  name: "Evals",
  group: "ai_engineering_focus",
};

const bash = {
  ...typescript,
  id: "4e0d5f6a-7b8c-4d9e-8f0a-1b2c3d4e5f6a",
  slug: "bash",
  name: "Bash",
  tier: "secondary",
  group: null,
};

const experience = {
  ...stored,
  id: "5f1e6a7b-8c9d-4e0f-9a1b-2c3d4e5f6a7b",
  slug: "northwind-platform",
  title: "Platform engineer",
  kind: "main_job",
  startedOn: "2020-01-01",
  endedOn: null,
  summary: "A **fictional** role.",
  responsibilities: ["Run the platform"],
  inCv: true,
  organization: {
    ...stored,
    id: "6a2f7b8c-9d0e-4f1a-8b2c-3d4e5f6a7b8c",
    slug: "northwind",
    name: "Northwind",
    website: null,
    description: null,
    logoId: null,
  },
  technologies: [typescript],
  projects: [],
  testimonials: [],
};

const education = {
  ...stored,
  id: "7b3a8c9d-0e1f-4a2b-9c3d-4e5f6a7b8c9d",
  slug: "harbour-tech",
  kind: "school",
  title: "Software engineering",
  institution: "Harbour Technical College",
  startedOn: "2008-09-01",
  endedOn: "2012-06-30",
  description: null,
  position: 0,
};

const exploration = {
  id: "8c4b9d0e-1f2a-4b3c-8d4e-5f6a7b8c9d0e",
  slug: "agent-lab",
  name: "Agent lab",
  summary: "A **fictional** playground.",
  status: "designed",
  concepts: ["Tool calling"],
  startedOn: "2025-02-01",
  endedOn: null,
  technologies: [typescript],
};

const cvPdf = {
  ...stored,
  id: person.cvPdfId,
  key: "development/media/cv.pdf",
  mediaType: "application/pdf",
  byteSize: 2048,
  width: null,
  height: null,
  altText: null,
  url: "https://media.example.test/development/media/cv.pdf",
};

const cv = {
  person,
  experiences: [experience],
  technologies: { primary: { core: [typescript], aiEngineeringFocus: [evals] }, secondary: [bash] },
  education: [education],
  explorations: [exploration],
  cvPdf,
};

describe("CvSchema", () => {
  it("accepts an assembled CV with every section", () => {
    expect(CvSchema.parse(cv)).toEqual(cv);
  });

  it("accepts empty sections and no current CV PDF", () => {
    const empty = {
      person: { ...person, cvPdfId: null },
      experiences: [],
      technologies: { primary: { core: [], aiEngineeringFocus: [] }, secondary: [] },
      education: [],
      explorations: [],
      cvPdf: null,
    };

    expect(CvSchema.parse(empty)).toEqual(empty);
  });

  it("rejects an experience that is not selected for the CV", () => {
    expect(
      CvSchema.safeParse({ ...cv, experiences: [{ ...experience, inCv: false }] }).success,
    ).toBe(false);
  });

  it.each([
    ["a secondary technology among the core ones", { core: [bash], aiEngineeringFocus: [] }, []],
    [
      "a core technology in the AI engineering focus",
      { core: [], aiEngineeringFocus: [typescript] },
      [],
    ],
    [
      "a primary technology among the secondary ones",
      { core: [], aiEngineeringFocus: [] },
      [evals],
    ],
  ])("rejects %s", (_name, primary, secondary) => {
    expect(CvSchema.safeParse({ ...cv, technologies: { primary, secondary } }).success).toBe(false);
  });

  it("rejects an image as the current CV PDF", () => {
    const image = { ...cvPdf, mediaType: "image/png", width: 10, height: 10 };

    expect(CvSchema.safeParse({ ...cv, cvPdf: image }).success).toBe(false);
  });
});

describe("CvExplorationSchema", () => {
  it.each(explorationStatuses)("keeps the status %s exactly as stored", (status) => {
    expect(CvExplorationSchema.parse({ ...exploration, status })).toMatchObject({ status });
  });

  it("rejects a status that is not defined", () => {
    expect(CvExplorationSchema.safeParse({ ...exploration, status: "delivered" }).success).toBe(
      false,
    );
  });

  it("keeps only the concise fields of a full exploration", () => {
    const full = {
      ...exploration,
      ...stored,
      position: 3,
      topics: [{ ...stored, id: exploration.id, slug: "agents", name: "Agents", position: 0 }],
    };

    expect(CvExplorationSchema.parse(full)).toEqual(exploration);
  });
});
