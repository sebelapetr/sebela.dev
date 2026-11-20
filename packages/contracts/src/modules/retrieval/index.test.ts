import { describe, expect, it } from "vitest";

import {
  PassageSchema,
  PortfolioPassageSchema,
  SearchRequestSchema,
  SearchResultSchema,
  SupplementalPassageSchema,
  portfolioSourceId,
  portfolioSourcePath,
  retrievalContentKinds,
  retrievalMaxPassages,
  retrievalPassageMaxLength,
  retrievalQueryMaxLength,
  type PortfolioPassage,
  type SupplementalPassage,
} from "./index.js";

// Fictional records only.
const VERSION = "a".repeat(64);

const portfolio: PortfolioPassage = {
  sourceKind: "portfolio",
  sourceId: "portfolio:experience:lumen-press-staff-engineer",
  title: "Staff engineer at Lumen Press",
  version: VERSION,
  text: "Leads the editorial platform team.",
  score: 0.71,
  path: "/experience#experience-lumen-press-staff-engineer",
  provenance: {
    contentKind: "experience",
    sectionPath: ["Staff engineer at Lumen Press", "Summary"],
    indexedAt: "2026-11-20T10:00:00.000Z",
  },
};

const supplemental: SupplementalPassage = {
  sourceKind: "supplemental",
  sourceId: "document:northgate-evaluation-talk",
  title: "Notes from a talk at the Northgate Engineering meetup",
  version: VERSION,
  text: "Evaluation starts with a question set.",
  score: 0.64,
  provenance: {
    contentKind: "document",
    sectionPath: ["Evaluation"],
    indexedAt: "2026-11-20T10:00:00.000Z",
  },
};

describe("search request", () => {
  it("accepts a query with an optional kind filter and limit", () => {
    expect(SearchRequestSchema.parse({ query: "  Lumen Press  " })).toEqual({
      query: "Lumen Press",
    });
    expect(
      SearchRequestSchema.safeParse({ query: "agents", kinds: ["roadmap_module"], limit: 3 })
        .success,
    ).toBe(true);
  });

  it("bounds the query, the limit and the kinds", () => {
    expect(retrievalQueryMaxLength).toBe(500);
    expect(retrievalMaxPassages).toBe(8);
    const refused = [
      { query: "" },
      { query: "   " },
      { query: "x".repeat(retrievalQueryMaxLength + 1) },
      { query: "agents", kinds: [] },
      { query: "agents", kinds: ["wiki_page"] },
      { query: "agents", limit: 0 },
      { query: "agents", limit: retrievalMaxPassages + 1 },
      { query: "agents", limit: 2.5 },
      { query: "agents", extra: true },
    ];
    for (const body of refused) {
      expect(SearchRequestSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
    expect(
      SearchRequestSchema.safeParse({ query: "x".repeat(retrievalQueryMaxLength) }).success,
    ).toBe(true);
  });

  it("names every content kind, with documents as the only supplemental kind", () => {
    expect(retrievalContentKinds).toContain("experience");
    expect(retrievalContentKinds).toContain("diary_day");
    expect(retrievalContentKinds).toContain("document");
  });
});

describe("portfolio passages", () => {
  it("accepts a passage with its canonical site path", () => {
    expect(PortfolioPassageSchema.safeParse(portfolio).success).toBe(true);
    expect(PassageSchema.safeParse(portfolio).success).toBe(true);
  });

  it.each([
    ["profile", "person", "/"],
    [
      "experience",
      "lumen-press-staff-engineer",
      "/experience#experience-lumen-press-staff-engineer",
    ],
    ["project", "reading-assistant", "/experience#project-reading-assistant"],
    ["case_study", "reading-assistant", "/experience#case-study-reading-assistant"],
    ["exploration", "eval-dashboard", "/experience#exploration-eval-dashboard"],
    ["service", "evaluation-setup", "/services#service-evaluation-setup"],
    ["education", "llm-evaluation-course", "/cv"],
    ["roadmap_area", "retrieval-systems", "/ai-roadmap/retrieval-systems"],
    ["roadmap_module", "embeddings", "/ai-roadmap/foundations/embeddings"],
    [
      "roadmap_resource",
      "chunking-experiments",
      "/ai-roadmap/retrieval-systems/chunking-strategies#resource-chunking-experiments",
    ],
    ["diary_day", "2025-02-10", "/ai-roadmap/diary/2025-02-10"],
    [
      "book",
      "fictional-vector-search-handbook",
      "/ai-roadmap/bookshelf/fictional-vector-search-handbook",
    ],
    ["event", "retrieval-summit", "/ai-roadmap/events"],
    ["glossary_term", "grounding", "/ai-roadmap"],
  ] as const)("validates the %s path", (kind, key, path) => {
    const passage = {
      ...portfolio,
      sourceId: `portfolio:${kind}:${key}`,
      path,
      provenance: { ...portfolio.provenance, contentKind: kind },
    };
    expect(PortfolioPassageSchema.safeParse(passage).success).toBe(true);
    expect(portfolioSourceId(kind, key)).toBe(`portfolio:${kind}:${key}`);
  });

  it.each([
    ["an unknown route", "/blog/lumen-press-staff-engineer"],
    ["another record's anchor", "/experience#experience-northwind-freight-developer"],
    ["another kind's anchor", "/experience#project-lumen-press-staff-engineer"],
    ["an absolute URL", "https://example.test/experience#experience-lumen-press-staff-engineer"],
    ["a protocol-relative URL", "//example.test/experience"],
    ["a query", "/experience?x=1#experience-lumen-press-staff-engineer"],
  ])("refuses %s", (_label, path) => {
    expect(PortfolioPassageSchema.safeParse({ ...portfolio, path }).success).toBe(false);
  });

  it("refuses a passage whose source and provenance kinds disagree", () => {
    const passage = {
      ...portfolio,
      provenance: { ...portfolio.provenance, contentKind: "project" },
    };
    expect(PortfolioPassageSchema.safeParse(passage).success).toBe(false);
  });

  it("refuses a passage without a path, or with an oversized text", () => {
    const withoutPath: Partial<PortfolioPassage> = { ...portfolio };
    delete withoutPath.path;
    expect(PortfolioPassageSchema.safeParse(withoutPath).success).toBe(false);
    const long = { ...portfolio, text: "x".repeat(retrievalPassageMaxLength + 1) };
    expect(PortfolioPassageSchema.safeParse(long).success).toBe(false);
  });

  it("derives the canonical path from the source and the roadmap containers", () => {
    expect(portfolioSourcePath({ kind: "project", key: "booking-portal" })).toBe(
      "/experience#project-booking-portal",
    );
    expect(
      portfolioSourcePath({
        kind: "roadmap_resource",
        key: "red-team-exercise",
        area: "agents-in-production",
        module: "guardrails-basics",
      }),
    ).toBe("/ai-roadmap/agents-in-production/guardrails-basics#resource-red-team-exercise");
    expect(
      portfolioSourcePath({ kind: "roadmap_module", key: "embeddings", area: "foundations" }),
    ).toBe("/ai-roadmap/foundations/embeddings");
  });
});

describe("supplemental passages", () => {
  it("accepts a passage with a label and an identifier", () => {
    expect(SupplementalPassageSchema.safeParse(supplemental).success).toBe(true);
    expect(PassageSchema.safeParse(supplemental).success).toBe(true);
  });

  it.each([
    ["a url", { url: "https://example.test/files/talk.pdf" }],
    ["a path", { path: "/experience" }],
    ["a storage key", { storageKey: "documents/talk.pdf" }],
    ["a portfolio source ID", { sourceId: "portfolio:experience:lumen-press-staff-engineer" }],
    ["a portfolio kind", { provenance: { ...supplemental.provenance, contentKind: "experience" } }],
  ])("can never carry %s", (_label, change) => {
    expect(PassageSchema.safeParse({ ...supplemental, ...change }).success).toBe(false);
  });
});

describe("search result", () => {
  it("returns passages when evidence is found and none when it is not", () => {
    expect(
      SearchResultSchema.safeParse({ status: "found", passages: [portfolio, supplemental] })
        .success,
    ).toBe(true);
    expect(SearchResultSchema.safeParse({ status: "no_evidence", passages: [] }).success).toBe(
      true,
    );
  });

  it("never reports found without passages, or no evidence with some", () => {
    expect(SearchResultSchema.safeParse({ status: "found", passages: [] }).success).toBe(false);
    expect(
      SearchResultSchema.safeParse({ status: "no_evidence", passages: [portfolio] }).success,
    ).toBe(false);
    const many = Array.from({ length: retrievalMaxPassages + 1 }, () => portfolio);
    expect(SearchResultSchema.safeParse({ status: "found", passages: many }).success).toBe(false);
  });
});
