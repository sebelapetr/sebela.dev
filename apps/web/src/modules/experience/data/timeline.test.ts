import { describe, expect, it } from "vitest";

import type { CaseStudy, Experience, Project, Testimonial } from "@sebela/api-client";

import { careerYears, toTimelineEntries } from "./timeline";

const STAMP = "2026-01-01T00:00:00.000Z";

/** A fictional experience as the public route returns it. */
function experience(overrides: Partial<Experience> = {}): Experience {
  return {
    id: "6a1f3c2e-0b4d-4e7a-9c11-2f8d5b6e7a01",
    slug: "fictional-staff-engineer",
    title: "Staff engineer",
    kind: "main_job",
    startedOn: "2022-04-01",
    endedOn: null,
    summary: "Leads a **fictional** platform team.",
    responsibilities: ["Own the architecture", "Mentor the team"],
    inCv: true,
    organization: {
      id: "3c9e1b7a-5d2f-4a6b-8e0c-1f2a3b4c5d60",
      slug: "fictional-press",
      name: "Fictional Press",
      website: "https://press.example.test/",
      description: null,
      logoId: null,
      createdAt: STAMP,
      updatedAt: STAMP,
    },
    technologies: [
      {
        id: "9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c60",
        slug: "typescript",
        name: "TypeScript",
        tier: "primary",
        group: "core",
        logoKey: "typescript",
        position: 0,
        createdAt: STAMP,
        updatedAt: STAMP,
      },
    ],
    projects: [],
    testimonials: [],
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  };
}

function testimonial(overrides: Partial<Testimonial> = {}): Testimonial {
  return {
    id: "1d2c3b4a-5e6f-4a7b-8c9d-0e1f2a3b4c50",
    slug: "fictional-editor",
    experience: "fictional-staff-engineer",
    quote: "A fictional quote.",
    authorName: "Mira Example",
    authorRole: "Editor (fictional)",
    position: 0,
    authorPhotoId: null,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  };
}

/** A fictional project of the fictional experience, as the public route returns it. */
function project(overrides: Partial<Project> = {}): Project {
  return {
    id: "2e4f6a8c-0b1d-4e3f-8a5c-7e9b1d3f5a70",
    slug: "fictional-route-planner",
    experience: "fictional-staff-engineer",
    name: "Route planner",
    summary: "Plans **fictional** delivery routes.",
    problem: "Drivers planned routes by hand.",
    workDone: "Built a planner over PostgreSQL.",
    result: "The team plans a day in minutes.",
    startedOn: "2022-05-02",
    endedOn: "2023-01-31",
    links: [],
    selectedForHomepage: false,
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

function caseStudy(overrides: Partial<CaseStudy> = {}): CaseStudy {
  return {
    id: "8f9e0d1c-2b3a-4c5d-8e6f-7a8b9c0d1e20",
    project: "fictional-route-planner",
    role: "Lead engineer",
    body: "## Approach\n\nA **fictional** account.",
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  };
}

describe("toTimelineEntries", () => {
  it("maps an experience to an entry with its period, kind label and anchor", () => {
    expect(toTimelineEntries([experience({ endedOn: "2024-07-10" })])).toEqual([
      {
        slug: "fictional-staff-engineer",
        anchor: "experience-fictional-staff-engineer",
        title: "Staff engineer",
        organization: {
          name: "Fictional Press",
          website: "https://press.example.test/",
          logo: null,
        },
        kind: "main_job",
        kindLabel: "Full-time job",
        period: "April 1st, 2022 – July 10th, 2024",
        current: false,
        summary: "Leads a **fictional** platform team.",
        responsibilities: ["Own the architecture", "Mentor the team"],
        technologies: [{ slug: "typescript", name: "TypeScript" }],
        projects: [],
        testimonials: [],
      },
    ]);
  });

  describe("organization logos", () => {
    const LOGO_ID = "7d2c4e6f-8a1b-4c3d-9e5f-0a1b2c3d4e5f";
    const logo = {
      url: "https://media.example.test/press.png",
      altText: "The fictional Press logo.",
      width: 96,
      height: 48,
    };
    const withLogo = (logoId: string | null) =>
      experience({ organization: { ...experience().organization, logoId } });

    it("gives the entry its organization's logo", () => {
      const [entry] = toTimelineEntries([withLogo(LOGO_ID)], new Map([[LOGO_ID, logo]]));
      expect(entry?.organization.logo).toEqual(logo);
    });

    it("has no logo when the organization has none", () => {
      const [entry] = toTimelineEntries([withLogo(null)], new Map([[LOGO_ID, logo]]));
      expect(entry?.organization.logo).toBeNull();
    });

    it("has no logo when the organization's logo could not be read or shown", () => {
      const [entry] = toTimelineEntries([withLogo(LOGO_ID)], new Map());
      expect(entry?.organization.logo).toBeNull();
    });
  });

  it("is empty without experiences", () => {
    expect(toTimelineEntries([])).toEqual([]);
  });

  describe("the expand policy", () => {
    it("marks only ongoing experiences as current", () => {
      const entries = toTimelineEntries([
        experience({ slug: "ongoing", endedOn: null }),
        experience({ slug: "ended", endedOn: "2021-12-31" }),
      ]);

      expect(entries.map((entry) => [entry.slug, entry.current])).toEqual([
        ["ongoing", true],
        ["ended", false],
      ]);
    });

    it("keeps concurrent current experiences as separate entries with their own kinds", () => {
      const entries = toTimelineEntries([
        experience({ slug: "job", kind: "main_job", startedOn: "2022-04-01" }),
        experience({ slug: "studio", kind: "own_business", startedOn: "2020-06-01" }),
        experience({ slug: "library", kind: "side_project", startedOn: "2021-02-12" }),
      ]);

      expect(entries.map((entry) => [entry.slug, entry.kindLabel, entry.current])).toEqual([
        ["job", "Full-time job", true],
        ["studio", "Own business", true],
        ["library", "Side project", true],
      ]);
    });
  });

  it("keeps the API's order and never nests side work under an employer of the same organization", () => {
    const entries = toTimelineEntries([
      experience({ slug: "employer", kind: "main_job", endedOn: "2023-01-31" }),
      experience({ slug: "client-work", kind: "side_project", endedOn: "2022-12-31" }),
      experience({ slug: "earlier", kind: "main_job", endedOn: "2019-01-31" }),
    ]);

    expect(entries.map((entry) => entry.slug)).toEqual(["employer", "client-work", "earlier"]);
  });

  it("gives every experience a distinct, stable anchor from its slug", () => {
    const entries = toTimelineEntries([
      experience({ slug: "first" }),
      experience({ slug: "second" }),
    ]);

    expect(entries.map((entry) => entry.anchor)).toEqual(["experience-first", "experience-second"]);
  });

  it("shows testimonials only beside their own experience, in their order", () => {
    const entries = toTimelineEntries([
      experience({
        slug: "with-quotes",
        testimonials: [
          testimonial({ slug: "second", experience: "with-quotes", position: 1 }),
          testimonial({ slug: "stray", experience: "another-experience", position: 0 }),
          testimonial({ slug: "first", experience: "with-quotes", position: 0 }),
        ],
      }),
      experience({ slug: "without-quotes" }),
    ]);

    expect(entries[0]?.testimonials.map((quote) => quote.slug)).toEqual(["first", "second"]);
    expect(entries[1]?.testimonials).toEqual([]);
  });

  describe("testimonial author photos", () => {
    const PHOTO_ID = "5c4b3a29-1807-4f6e-9d5c-4b3a29180716";
    const photo = {
      url: "https://media.example.test/mira.png",
      altText: "An illustrated portrait of Mira Example.",
      width: 160,
      height: 160,
    };
    const withQuote = (authorPhotoId: string | null) =>
      experience({ testimonials: [testimonial({ authorPhotoId })] });

    it("maps a testimonial to its quote, author and author photo", () => {
      const [entry] = toTimelineEntries(
        [withQuote(PHOTO_ID)],
        new Map(),
        new Map([[PHOTO_ID, photo]]),
      );
      expect(entry?.testimonials).toEqual([
        {
          slug: "fictional-editor",
          quote: "A fictional quote.",
          authorName: "Mira Example",
          authorRole: "Editor (fictional)",
          authorPhoto: photo,
        },
      ]);
    });

    it("has no author photo when the testimonial has none", () => {
      const [entry] = toTimelineEntries([withQuote(null)], new Map(), new Map([[PHOTO_ID, photo]]));
      expect(entry?.testimonials[0]?.authorPhoto).toBeNull();
    });

    it("has no author photo when it could not be read or shown", () => {
      const [entry] = toTimelineEntries([withQuote(PHOTO_ID)], new Map(), new Map());
      expect(entry?.testimonials[0]?.authorPhoto).toBeNull();
    });

    it("never takes an organization's logo as an author photo", () => {
      const [entry] = toTimelineEntries([withQuote(PHOTO_ID)], new Map([[PHOTO_ID, photo]]));
      expect(entry?.testimonials[0]?.authorPhoto).toBeNull();
    });
  });

  describe("projects", () => {
    it("maps a project with its anchor, period, evidence and technologies", () => {
      const [entry] = toTimelineEntries([experience({ projects: [project()] })]);

      expect(entry?.projects).toEqual([
        {
          slug: "fictional-route-planner",
          anchor: "project-fictional-route-planner",
          name: "Route planner",
          period: "May 2nd, 2022 – January 31st, 2023",
          summary: "Plans **fictional** delivery routes.",
          problem: "Drivers planned routes by hand.",
          workDone: "Built a planner over PostgreSQL.",
          result: "The team plans a day in minutes.",
          technologies: [{ slug: "postgresql", name: "PostgreSQL" }],
          caseStudy: null,
        },
      ]);
    });

    it("reads an ongoing project's period as present", () => {
      const [entry] = toTimelineEntries([experience({ projects: [project({ endedOn: null })] })]);
      expect(entry?.projects[0]?.period).toBe("May 2nd, 2022 – present");
    });

    it("gives a project with a case study the case study's own anchor, role and account", () => {
      const [entry] = toTimelineEntries([
        experience({ projects: [project({ caseStudy: caseStudy() })] }),
      ]);

      expect(entry?.projects[0]?.caseStudy).toEqual({
        anchor: "case-study-fictional-route-planner",
        role: "Lead engineer",
        body: "## Approach\n\nA **fictional** account.",
      });
    });

    it("has no case study when the project has none, rather than an empty one", () => {
      const [entry] = toTimelineEntries([experience({ projects: [project({ caseStudy: null })] })]);
      expect(entry?.projects[0]?.caseStudy).toBeNull();
    });

    it("orders the projects by their position, then slug, whatever the selection", () => {
      const [entry] = toTimelineEntries([
        experience({
          projects: [
            project({ slug: "c-late", position: 2 }),
            project({ slug: "b-second", position: 0, selectedForHomepage: true }),
            project({ slug: "a-first", position: 0 }),
          ],
        }),
      ]);

      expect(entry?.projects.map((item) => item.slug)).toEqual(["a-first", "b-second", "c-late"]);
    });

    it("keeps each project only inside the experience it belongs to", () => {
      const [entry] = toTimelineEntries([
        experience({ projects: [project(), project({ slug: "elsewhere", experience: "other" })] }),
      ]);

      expect(entry?.projects.map((item) => item.slug)).toEqual(["fictional-route-planner"]);
    });

    it("has no projects without any", () => {
      const [entry] = toTimelineEntries([experience({ projects: [] })]);
      expect(entry?.projects).toEqual([]);
    });
  });
});

describe("careerYears", () => {
  it("counts whole years since the career started", () => {
    expect(careerYears("2015-09-01", new Date("2026-11-17T12:00:00Z"))).toBe(11);
  });

  it("does not count a year before its anniversary", () => {
    expect(careerYears("2015-09-01", new Date("2026-08-31T12:00:00Z"))).toBe(10);
    expect(careerYears("2015-09-01", new Date("2026-09-01T12:00:00Z"))).toBe(11);
  });

  it("is null without a start date or before the first full year", () => {
    expect(careerYears(null, new Date("2026-11-17T12:00:00Z"))).toBeNull();
    expect(careerYears("2026-03-01", new Date("2026-11-17T12:00:00Z"))).toBeNull();
  });
});
