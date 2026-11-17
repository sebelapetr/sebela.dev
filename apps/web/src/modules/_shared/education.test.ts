import { describe, expect, it } from "vitest";

import type { Education, EducationKind } from "@sebela/api-client";

import { toEducationRows } from "./education";

const STAMP = "2026-01-01T00:00:00.000Z";

function education(
  slug: string,
  kind: EducationKind,
  overrides: Partial<Education> = {},
): Education {
  return {
    id: "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f",
    slug,
    kind,
    title: `Fictional ${slug}`,
    institution: "Fictional Institute",
    startedOn: "2010-09-01",
    endedOn: "2014-06-30",
    description: null,
    position: 0,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  };
}

describe("toEducationRows", () => {
  it("keeps the API's order and labels each kind", () => {
    const rows = toEducationRows([
      education("degree", "school"),
      education("workshop", "course"),
      education("cloud-exam", "certification"),
      education("first-talk", "milestone"),
    ]);

    expect(rows.map((row) => [row.slug, row.kindLabel])).toEqual([
      ["degree", "School"],
      ["workshop", "Course"],
      ["cloud-exam", "Certification"],
      ["first-talk", "Milestone"],
    ]);
  });

  it("shows the title, the institution and the description", () => {
    const [row] = toEducationRows([
      education("degree", "school", {
        title: "Fictional Computer Science",
        institution: "Fictional University",
        description: "Thesis on **made-up** schedulers.",
      }),
    ]);

    expect(row).toMatchObject({
      title: "Fictional Computer Science",
      institution: "Fictional University",
      description: "Thesis on **made-up** schedulers.",
    });
  });

  it("keeps an absent institution and description absent", () => {
    const [row] = toEducationRows([
      education("first-talk", "milestone", { institution: null, description: null }),
    ]);

    expect(row).toMatchObject({ institution: null, description: null });
  });

  it("writes the period in words", () => {
    const rows = toEducationRows([
      education("both", "school", { startedOn: "2010-09-01", endedOn: "2014-06-30" }),
      education("ongoing", "course", { startedOn: "2025-10-01", endedOn: null }),
      education("completed", "certification", { startedOn: null, endedOn: "2023-05-12" }),
      education("one-day", "milestone", { startedOn: "2022-03-04", endedOn: "2022-03-04" }),
    ]);

    expect(rows.map((row) => row.period)).toEqual([
      "September 1st, 2010 – June 30th, 2014",
      "October 1st, 2025 – present",
      "May 12th, 2023",
      "March 4th, 2022",
    ]);
  });

  it("has no period when the API gives no date", () => {
    const [row] = toEducationRows([
      education("undated", "milestone", { startedOn: null, endedOn: null }),
    ]);

    expect(row?.period).toBeNull();
  });

  it("is empty without education", () => {
    expect(toEducationRows([])).toEqual([]);
  });
});
