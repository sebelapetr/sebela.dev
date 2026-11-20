import { PortfolioPassageSchema } from "@sebela/contracts";
import { describe, expect, it } from "vitest";

import type { PortfolioSnapshot } from "../ports/index.js";

import { chunkMaxLength, portfolioSources } from "./index.js";

const empty: PortfolioSnapshot = {
  person: null,
  experiences: [],
  projects: [],
  caseStudies: [],
  explorations: [],
  services: [],
  education: [],
  testimonials: [],
  roadmap: { areas: [] },
  diary: { days: [] },
  books: [],
  events: [],
  glossary: [],
};

const portfolio: PortfolioSnapshot = {
  ...empty,
  experiences: [
    {
      slug: "lumen-press-staff-engineer",
      title: "Staff engineer",
      summary: "Leads the editorial platform team.",
      responsibilities: ["Owns the article pipeline"],
      organization: { name: "Lumen Press" },
      technologies: [{ name: "TypeScript" }],
    },
  ],
  testimonials: [
    {
      slug: "editor-in-chief",
      experience: "lumen-press-staff-engineer",
      quote: "Calm under deadlines.",
      authorName: "Jordan Sample",
      authorRole: "Editor in chief",
    },
  ],
  caseStudies: [{ project: "reading-assistant", role: "Lead", body: "x ".repeat(2000).trim() }],
  roadmap: {
    areas: [
      {
        slug: "foundations",
        name: "Foundations",
        description: null,
        modules: [
          {
            slug: "embeddings",
            name: "Embeddings",
            description: "Vectors.",
            resources: [{ slug: "cosine-notes", name: "Cosine notes", description: null }],
          },
        ],
      },
    ],
  },
  diary: {
    days: [
      { date: "2025-02-10", notes: null },
      { date: "2025-02-11", notes: "Read." },
    ],
  },
  books: [
    {
      slug: "fictional-handbook",
      title: "A Fictional Handbook",
      author: null,
      description: null,
      summary: null,
    },
  ],
};

describe("portfolioSources", () => {
  it("makes one source per record with a canonical path the contract accepts", () => {
    const sources = portfolioSources(portfolio);
    const ids = sources.map((source) => source.sourceId);
    expect(ids).toEqual(
      expect.arrayContaining([
        "portfolio:experience:lumen-press-staff-engineer",
        "portfolio:case_study:reading-assistant",
        "portfolio:roadmap_area:foundations",
        "portfolio:roadmap_module:embeddings",
        "portfolio:roadmap_resource:cosine-notes",
        "portfolio:diary_day:2025-02-11",
        "portfolio:book:fictional-handbook",
      ]),
    );
    expect(new Set(ids).size).toBe(ids.length);
    for (const source of sources) {
      const passage = {
        sourceKind: "portfolio",
        sourceId: source.sourceId,
        title: source.title,
        version: source.version,
        text: source.chunks[0]?.text ?? "",
        score: 0.5,
        path: source.path,
        provenance: {
          contentKind: source.contentKind,
          sectionPath: [...(source.sections[0]?.headingPath ?? [])],
          indexedAt: "2026-11-20T10:00:00.000Z",
        },
      };
      expect(PortfolioPassageSchema.safeParse(passage).success, source.sourceId).toBe(true);
    }
  });

  it("skips a diary day without notes and keeps a testimonial with its experience", () => {
    const sources = portfolioSources(portfolio);
    expect(sources.map((source) => source.sourceId)).not.toContain(
      "portfolio:diary_day:2025-02-10",
    );
    const experience = sources.find(
      (source) => source.sourceId === "portfolio:experience:lumen-press-staff-engineer",
    );
    expect(experience?.chunks.map((chunk) => chunk.text).join("\n")).toContain(
      "Calm under deadlines.",
    );
  });

  it("bounds every chunk and hashes texts and versions stably", () => {
    const first = portfolioSources(portfolio);
    const again = portfolioSources(portfolio);
    expect(again).toEqual(first);
    const caseStudy = first.find((source) => source.contentKind === "case_study");
    expect(caseStudy?.chunks.length).toBeGreaterThan(1);
    for (const source of first) {
      expect(source.version).toMatch(/^[0-9a-f]{64}$/);
      for (const chunk of source.chunks) {
        expect(chunk.text.length).toBeLessThanOrEqual(chunkMaxLength);
        expect(chunk.textHash).toMatch(/^[0-9a-f]{64}$/);
      }
    }
  });

  it("changes the version only of the record that changed", () => {
    const [book] = portfolio.books;
    if (book === undefined) throw new Error("fixture");
    const before = portfolioSources(portfolio);
    const after = portfolioSources({
      ...portfolio,
      books: [{ ...book, summary: "Now summarized." }],
    });
    const version = (sources: typeof before, id: string) =>
      sources.find((source) => source.sourceId === id)?.version;
    expect(version(after, "portfolio:book:fictional-handbook")).not.toBe(
      version(before, "portfolio:book:fictional-handbook"),
    );
    expect(version(after, "portfolio:roadmap_module:embeddings")).toBe(
      version(before, "portfolio:roadmap_module:embeddings"),
    );
  });

  it("indexes nothing from an empty portfolio", () => {
    expect(portfolioSources(empty)).toEqual([]);
  });
});
