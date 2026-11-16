import { describe, expect, it } from "vitest";

import {
  EducationCreateSchema,
  EducationListSchema,
  EducationSchema,
  EducationUpdateSchema,
  educationKinds,
} from "./index.js";

const stored = {
  id: "7b1d2c3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e",
  createdAt: "2026-01-01T10:00:00.000Z",
  updatedAt: "2026-01-02T10:00:00.000Z",
};

/** A fictional school with a full period. */
const harbourTech = {
  slug: "harbour-tech",
  kind: "school",
  title: "Software engineering",
  institution: "Harbour Technical College",
  startedOn: "2008-09-01",
  endedOn: "2012-06-30",
  description: "A **fictional** degree used in tests.",
  position: 3,
};

describe("educationKinds", () => {
  it("lists school, course, certification and milestone", () => {
    expect(educationKinds).toEqual(["school", "course", "certification", "milestone"]);
  });
});

describe("EducationCreateSchema", () => {
  it("accepts an education with every field", () => {
    expect(EducationCreateSchema.parse(harbourTech)).toEqual(harbourTech);
  });

  it.each(educationKinds)("keeps the kind %s exactly as sent", (kind) => {
    expect(EducationCreateSchema.parse({ ...harbourTech, kind })).toMatchObject({ kind });
  });

  it("fills an omitted institution, description and either date with null", () => {
    const certification = {
      slug: "cloud-associate",
      kind: "certification",
      title: "Cloud associate",
      endedOn: "2021-05-14",
      position: 0,
    };
    expect(EducationCreateSchema.parse(certification)).toEqual({
      ...certification,
      institution: null,
      startedOn: null,
      description: null,
    });
  });

  it("accepts a start without an end, an end without a start and one day", () => {
    expect(EducationCreateSchema.parse({ ...harbourTech, endedOn: null })).toMatchObject({
      startedOn: "2008-09-01",
      endedOn: null,
    });
    expect(EducationCreateSchema.parse({ ...harbourTech, startedOn: null })).toMatchObject({
      startedOn: null,
      endedOn: "2012-06-30",
    });
    const oneDay = { ...harbourTech, startedOn: "2019-03-02", endedOn: "2019-03-02" };
    expect(EducationCreateSchema.parse(oneDay)).toMatchObject({ endedOn: "2019-03-02" });
  });

  it("trims the title, institution and description", () => {
    expect(
      EducationCreateSchema.parse({
        ...harbourTech,
        title: " Degree ",
        institution: " College ",
        description: " x ",
      }),
    ).toMatchObject({ title: "Degree", institution: "College", description: "x" });
  });

  it.each([
    ["a missing slug", { ...harbourTech, slug: undefined }],
    ["an invalid slug", { ...harbourTech, slug: "Harbour Tech" }],
    ["a missing kind", { ...harbourTech, kind: undefined }],
    ["an unknown kind", { ...harbourTech, kind: "bootcamp" }],
    ["a kind in another case", { ...harbourTech, kind: "School" }],
    ["a missing title", { ...harbourTech, title: undefined }],
    ["an empty title", { ...harbourTech, title: " " }],
    ["a title that is too long", { ...harbourTech, title: "x".repeat(201) }],
    ["an empty institution", { ...harbourTech, institution: " " }],
    ["an institution that is too long", { ...harbourTech, institution: "x".repeat(201) }],
    ["an empty description", { ...harbourTech, description: "" }],
    ["a description that is too long", { ...harbourTech, description: "x".repeat(5001) }],
    ["a start that is not a date", { ...harbourTech, startedOn: "September 2008" }],
    ["an impossible date", { ...harbourTech, endedOn: "2012-02-30" }],
    ["an end before the start", { ...harbourTech, startedOn: "2012-01-02", endedOn: "2012-01-01" }],
    ["no date at all", { ...harbourTech, startedOn: null, endedOn: null }],
    ["omitted dates", { ...harbourTech, startedOn: undefined, endedOn: undefined }],
    ["a missing position", { ...harbourTech, position: undefined }],
    ["a negative position", { ...harbourTech, position: -1 }],
    ["a fractional position", { ...harbourTech, position: 1.5 }],
    ["an experience, which education never is", { ...harbourTech, experience: "lead" }],
    ["a visibility flag", { ...harbourTech, visible: true }],
  ])("rejects %s", (_, input) => {
    expect(EducationCreateSchema.safeParse(input).success).toBe(false);
  });

  it("names the end when it is before the start", () => {
    const result = EducationCreateSchema.safeParse({ ...harbourTech, endedOn: "2000-01-01" });
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([["endedOn"]]);
  });

  it("names both dates when neither is given", () => {
    const result = EducationCreateSchema.safeParse({
      ...harbourTech,
      startedOn: undefined,
      endedOn: undefined,
    });
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([["startedOn"], ["endedOn"]]);
  });

  it("names the kind when it is unknown", () => {
    const result = EducationCreateSchema.safeParse({ ...harbourTech, kind: "degree" });
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([["kind"]]);
  });
});

describe("EducationUpdateSchema", () => {
  it("accepts a partial change without filling other fields", () => {
    expect(EducationUpdateSchema.parse({ kind: "course" })).toEqual({ kind: "course" });
  });

  it("accepts clearing the institution, the description and one of the dates", () => {
    expect(
      EducationUpdateSchema.parse({ institution: null, description: null, endedOn: null }),
    ).toEqual({ institution: null, description: null, endedOn: null });
    expect(EducationUpdateSchema.parse({ startedOn: null })).toEqual({ startedOn: null });
  });

  it.each([
    ["an empty change", {}],
    ["a change of the slug", { slug: "renamed" }],
    ["clearing the kind", { kind: null }],
    ["an unknown kind", { kind: "diploma" }],
    ["clearing the title", { title: null }],
    ["clearing the position", { position: null }],
    ["clearing both dates", { startedOn: null, endedOn: null }],
    ["an end before the start", { startedOn: "2012-01-02", endedOn: "2012-01-01" }],
    ["an experience", { experience: "lead" }],
  ])("rejects %s", (_, input) => {
    expect(EducationUpdateSchema.safeParse(input).success).toBe(false);
  });
});

describe("EducationSchema and EducationListSchema", () => {
  it("describe stored education records", () => {
    const education = { ...stored, ...harbourTech };
    expect(EducationSchema.parse(education)).toEqual(education);
    expect(EducationListSchema.parse([education])).toEqual([education]);
    expect(EducationListSchema.parse([])).toEqual([]);
  });

  it("describe a record without institution, description or start", () => {
    const milestone = {
      ...stored,
      ...harbourTech,
      kind: "milestone",
      institution: null,
      description: null,
      startedOn: null,
    };
    expect(EducationSchema.parse(milestone)).toEqual(milestone);
  });

  it("rejects a stored kind outside the defined ones", () => {
    expect(EducationSchema.safeParse({ ...stored, ...harbourTech, kind: "bootcamp" }).success).toBe(
      false,
    );
  });
});
