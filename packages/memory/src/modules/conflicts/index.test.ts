import { describe, expect, it } from "vitest";

import type { SourceChunk } from "../ingest/index.js";
import type { PortfolioSnapshot } from "../ports/index.js";

import { findConflicts } from "./index.js";

const snapshot: PortfolioSnapshot = {
  person: null,
  experiences: [
    {
      slug: "harbor-retail-senior-developer",
      title: "Senior full-stack developer",
      summary: "Built the fictional online store.",
      responsibilities: [],
      startedOn: "2019-02-01",
      endedOn: "2022-03-31",
      organization: { name: "Harbor Retail Group" },
      technologies: [{ name: "TypeScript" }, { name: "Node.js" }],
    },
    {
      slug: "northwind-freight-developer",
      title: "Web developer",
      summary: "Built the fictional booking portal.",
      responsibilities: [],
      startedOn: "2015-09-01",
      endedOn: "2019-01-31",
      organization: { name: "Northwind Freight" },
      technologies: [{ name: "PHP" }],
    },
    {
      slug: "lumen-press-staff-engineer",
      title: "Staff engineer",
      summary: "Leads the fictional editorial platform.",
      responsibilities: [],
      startedOn: "2022-04-01",
      endedOn: null,
      organization: { name: "Lumen Press" },
      technologies: [{ name: "Python" }],
    },
  ],
  projects: [
    {
      slug: "harbor-loyalty",
      experience: "harbor-retail-senior-developer",
      name: "Loyalty programme",
      summary: "A fictional loyalty programme.",
      problem: "",
      workDone: "",
      result: "",
      technologies: [{ name: "Redis" }],
    },
  ],
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

const chunk = (ordinal: number, heading: string, body: string): SourceChunk => ({
  sectionOrdinal: ordinal,
  ordinal,
  text: `${heading}\n${body}`,
  textHash: String(ordinal),
});

const today = new Date("2026-11-21T00:00:00.000Z");

describe("findConflicts", () => {
  it("finds a year outside the named organization's experience", () => {
    const found = findConflicts(
      [
        chunk(
          0,
          "Old CV (2021 edition) / Harbor Retail Group",
          "Senior full-stack developer from February 2019 until June 2023.",
        ),
      ],
      snapshot,
      today,
    );
    expect(found).toEqual([
      {
        kind: "date",
        chunkOrdinal: 0,
        sourceId: "portfolio:experience:harbor-retail-senior-developer",
        claim: "2023",
        fact: "2019-02-01 to 2022-03-31",
      },
    ]);
  });

  it("reads years in the body only and counts a continuing role up to today", () => {
    expect(
      findConflicts(
        [chunk(0, "CV (2031 edition) / Lumen Press", "Staff engineer since 2022, still in 2026.")],
        snapshot,
        today,
      ),
    ).toEqual([]);
  });

  it("finds another experience's role title claimed for the organization", () => {
    expect(
      findConflicts(
        [chunk(2, "Notes / Northwind Freight", "Worked there as a staff engineer in 2016.")],
        snapshot,
        today,
      ),
    ).toEqual([
      {
        kind: "role_title",
        chunkOrdinal: 2,
        sourceId: "portfolio:experience:northwind-freight-developer",
        claim: "staff engineer",
        fact: "Web developer",
      },
    ]);
  });

  it("finds a technology neither the experience nor its projects used", () => {
    const found = findConflicts(
      [
        chunk(
          1,
          "Notes / Harbor Retail Group",
          "Wrote the store in TypeScript on Node.js with Redis and Python scripts.",
        ),
      ],
      snapshot,
      today,
    );
    expect(found).toEqual([
      {
        kind: "technology",
        chunkOrdinal: 1,
        sourceId: "portfolio:experience:harbor-retail-senior-developer",
        claim: "Python",
        fact: "TypeScript, Node.js, Redis",
      },
    ]);
  });

  it("matches technology names as whole names, not inside other words", () => {
    expect(
      findConflicts(
        [chunk(0, "Notes / Harbor Retail Group", "The PHPUnit-like checks ran on Node.js.")],
        snapshot,
        today,
      ),
    ).toEqual([]);
  });

  it("checks nothing in a chunk that names no organization", () => {
    expect(
      findConflicts(
        [chunk(0, "A talk", "In 1999 a staff engineer wrote Python and PHP.")],
        snapshot,
        today,
      ),
    ).toEqual([]);
  });

  it("finds nothing in agreeing chunks", () => {
    expect(
      findConflicts(
        [
          chunk(
            0,
            "CV / Harbor Retail Group",
            "Senior full-stack developer from 2019, TypeScript.",
          ),
          chunk(1, "CV / Northwind Freight", "Web developer from 2015, on PHP."),
        ],
        snapshot,
        today,
      ),
    ).toEqual([]);
  });
});
