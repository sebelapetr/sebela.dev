import { describe, expect, it } from "vitest";

import { RoadmapStatisticsSchema } from "./index.js";

const split = (resource: number, book: number, event: number) => ({
  totalSeconds: resource + book + event,
  resourceSeconds: resource,
  bookSeconds: book,
  eventSeconds: event,
});

/** Fictional statistics: one resource, one book resource and one event. */
const statistics = {
  totals: { ...split(3600, 1800, 5400), activeDays: 2 },
  days: [
    { date: "2026-03-01", ...split(1800, 0, 0) },
    { date: "2026-03-02", ...split(1800, 1800, 5400) },
  ],
  weeks: [
    { startsOn: "2026-02-23", ...split(1800, 0, 0) },
    { startsOn: "2026-03-02", ...split(1800, 1800, 5400) },
  ],
  months: [{ month: "2026-03", ...split(3600, 1800, 5400) }],
  areas: [
    {
      slug: "foundations",
      name: "Foundations",
      totalSeconds: 5400,
      resourceSeconds: 3600,
      bookSeconds: 1800,
      modules: [
        {
          slug: "prompting",
          name: "Prompting",
          totalSeconds: 5400,
          resourceSeconds: 3600,
          bookSeconds: 1800,
        },
      ],
    },
  ],
  resources: [
    {
      slug: "prompt-guide",
      name: "Fictional prompt guide",
      type: "text",
      category: "resource",
      module: { slug: "prompting", name: "Prompting" },
      area: { slug: "foundations", name: "Foundations" },
      book: null,
      totalSeconds: 3600,
    },
    {
      slug: "reading-a-book",
      name: "Reading a fictional book",
      type: "book",
      category: "book",
      module: { slug: "prompting", name: "Prompting" },
      area: { slug: "foundations", name: "Foundations" },
      book: { slug: "fictional-book", title: "A Fictional Book" },
      totalSeconds: 1800,
    },
  ],
  events: [
    {
      slug: "fictional-summit",
      name: "Fictional Summit",
      kind: "conference",
      startsOn: "2026-03-02",
      endsOn: "2026-03-03",
      totalSeconds: 5400,
    },
  ],
};

const empty = {
  totals: { ...split(0, 0, 0), activeDays: 0 },
  days: [],
  weeks: [],
  months: [],
  areas: [],
  resources: [],
  events: [],
};

describe("RoadmapStatisticsSchema", () => {
  it("describes totals, periods and breakdowns in whole seconds", () => {
    expect(RoadmapStatisticsSchema.parse(statistics)).toEqual(statistics);
  });

  it("describes an empty dataset", () => {
    expect(RoadmapStatisticsSchema.parse(empty)).toEqual(empty);
  });

  it("refuses fractional or negative seconds", () => {
    const fractional = { ...statistics, totals: { ...statistics.totals, totalSeconds: 1.5 } };
    const negative = { ...empty, totals: { ...empty.totals, eventSeconds: -1 } };
    expect(RoadmapStatisticsSchema.safeParse(fractional).success).toBe(false);
    expect(RoadmapStatisticsSchema.safeParse(negative).success).toBe(false);
  });

  it("refuses a malformed date, week start or month", () => {
    const [day, ...days] = statistics.days;
    expect(
      RoadmapStatisticsSchema.safeParse({
        ...statistics,
        days: [{ ...day, date: "1. 3." }, ...days],
      }).success,
    ).toBe(false);
    expect(
      RoadmapStatisticsSchema.safeParse({
        ...statistics,
        weeks: [{ ...statistics.weeks[0], startsOn: "2026-W09" }],
      }).success,
    ).toBe(false);
    expect(
      RoadmapStatisticsSchema.safeParse({
        ...statistics,
        months: [{ ...statistics.months[0], month: "2026-13" }],
      }).success,
    ).toBe(false);
  });

  it("names only the resource and book categories for resources", () => {
    const [resource] = statistics.resources;
    expect(
      RoadmapStatisticsSchema.safeParse({
        ...statistics,
        resources: [{ ...resource, category: "event" }],
      }).success,
    ).toBe(false);
  });

  it("keeps event time out of the area and module breakdowns", () => {
    const [area] = statistics.areas;
    expect(
      RoadmapStatisticsSchema.safeParse({
        ...statistics,
        areas: [{ ...area, eventSeconds: 0 }],
      }).success,
    ).toBe(false);
  });
});
