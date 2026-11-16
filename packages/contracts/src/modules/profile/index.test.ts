import { describe, expect, it } from "vitest";

import { PersonCreateSchema, PersonSchema, PersonUpdateSchema } from "./index.js";

const minimal = {
  name: "Alex Example",
  headline: "Fictional platform engineer",
  shortBio: "A fictional person used in tests.",
};

describe("PersonCreateSchema", () => {
  it("accepts the required fields and fills the optional ones", () => {
    expect(PersonCreateSchema.parse(minimal)).toEqual({
      ...minimal,
      longBio: null,
      location: null,
      email: null,
      links: [],
      availability: null,
      careerStartedOn: null,
      photoId: null,
      cvPdfId: null,
    });
  });

  it("accepts every field", () => {
    const full = {
      ...minimal,
      longBio: "# About\n\nLonger **markdown** text.",
      location: "Nowhere City",
      email: "alex@example.com",
      links: [{ label: "Website", url: "https://example.com/alex" }],
      availability: "Open to one new client from next quarter.",
      careerStartedOn: "2015-09-01",
      photoId: "0b8f5c2e-1d4a-4f6b-9c3e-2a7d8e9f0a1b",
      cvPdfId: "1c9f6d3f-2e5b-4a7c-8d4f-3b8e9f0a1b2c",
    };
    expect(PersonCreateSchema.parse(full)).toEqual(full);
  });

  it("trims text fields", () => {
    expect(PersonCreateSchema.parse({ ...minimal, name: "  Alex Example  " }).name).toBe(
      "Alex Example",
    );
  });

  it.each([
    ["a missing name", { headline: minimal.headline, shortBio: minimal.shortBio }],
    ["an empty name", { ...minimal, name: "   " }],
    ["an unexpected field", { ...minimal, id: "00000000-0000-4000-8000-000000000000" }],
    ["a malformed email", { ...minimal, email: "not-an-email" }],
    ["a link that is not http(s)", { ...minimal, links: [{ label: "x", url: "ftp://x.test" }] }],
    [
      "a link with an unexpected field",
      { ...minimal, links: [{ label: "x", url: "https://x.test", rel: "me" }] },
    ],
    ["a date that is not a calendar date", { ...minimal, careerStartedOn: "2015-02-30" }],
    ["a date with a time", { ...minimal, careerStartedOn: "2015-09-01T00:00:00Z" }],
    ["a photo that is a file name", { ...minimal, photoId: "alex.png" }],
    ["a CV PDF that is a path", { ...minimal, cvPdfId: "../cv.pdf" }],
    ["an embedded photo", { ...minimal, photo: { url: "https://media.example.test/a.png" } }],
    ["a name that is too long", { ...minimal, name: "x".repeat(201) }],
    [
      "too many links",
      {
        ...minimal,
        links: Array.from({ length: 21 }, () => ({ label: "x", url: "https://x.test" })),
      },
    ],
  ])("rejects %s", (_, input) => {
    expect(PersonCreateSchema.safeParse(input).success).toBe(false);
  });
});

describe("PersonUpdateSchema", () => {
  it("accepts a partial change without filling other fields", () => {
    expect(PersonUpdateSchema.parse({ headline: "New headline" })).toEqual({
      headline: "New headline",
    });
  });

  it("allows clearing an optional field", () => {
    expect(PersonUpdateSchema.parse({ email: null })).toEqual({ email: null });
  });

  it("attaches and clears the photo and the CV PDF by media identifier", () => {
    const photoId = "0b8f5c2e-1d4a-4f6b-9c3e-2a7d8e9f0a1b";
    expect(PersonUpdateSchema.parse({ photoId, cvPdfId: null })).toEqual({
      photoId,
      cvPdfId: null,
    });
  });

  it.each([
    ["an empty change", {}],
    ["clearing a required field", { name: null }],
    ["an unexpected field", { createdAt: "2020-01-01T00:00:00Z" }],
  ])("rejects %s", (_, input) => {
    expect(PersonUpdateSchema.safeParse(input).success).toBe(false);
  });
});

describe("PersonSchema", () => {
  it("describes a stored person with its identifier and timestamps", () => {
    const stored = {
      id: "6f1c2a52-3a0e-4c37-9a52-8f0a6f8d2b11",
      ...PersonCreateSchema.parse(minimal),
      createdAt: "2026-01-01T10:00:00.000Z",
      updatedAt: "2026-01-02T10:00:00.000Z",
    };
    expect(PersonSchema.parse(stored)).toEqual(stored);
  });
});
