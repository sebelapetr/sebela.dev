import { describe, expect, it } from "vitest";

import {
  ExperienceSchema,
  TestimonialCreateSchema,
  TestimonialListSchema,
  TestimonialSchema,
  TestimonialUpdateSchema,
} from "./index.js";

const stored = {
  id: "5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a",
  createdAt: "2026-01-01T10:00:00.000Z",
  updatedAt: "2026-01-02T10:00:00.000Z",
};

/** A fictional quote by a fictional colleague. */
const kindWords = {
  slug: "dana-on-routing",
  experience: "northwind-lead",
  quote: "Planning our fictional delivery routes went from a day to a coffee break.",
  authorName: "Dana Placeholder",
  authorRole: "Head of Operations",
  position: 1,
};

describe("TestimonialCreateSchema", () => {
  it("accepts a testimonial with every field", () => {
    expect(TestimonialCreateSchema.parse(kindWords)).toEqual(kindWords);
  });

  it("trims the quote, the author's name and the author's role", () => {
    expect(
      TestimonialCreateSchema.parse({
        ...kindWords,
        quote: "  Great work.  ",
        authorName: " Dana Placeholder ",
        authorRole: " Head of Operations ",
      }),
    ).toMatchObject({
      quote: "Great work.",
      authorName: "Dana Placeholder",
      authorRole: "Head of Operations",
    });
  });

  it("accepts the longest quote, name and role", () => {
    const longest = {
      ...kindWords,
      quote: "q".repeat(2000),
      authorName: "n".repeat(200),
      authorRole: "r".repeat(200),
    };
    expect(TestimonialCreateSchema.parse(longest)).toEqual(longest);
  });

  it.each([
    ["a missing slug", { ...kindWords, slug: undefined }],
    ["an invalid slug", { ...kindWords, slug: "Dana On Routing" }],
    ["a missing experience", { ...kindWords, experience: undefined }],
    ["no experience", { ...kindWords, experience: null }],
    ["an experience that is not a slug", { ...kindWords, experience: "Northwind Lead" }],
    ["an embedded experience", { ...kindWords, experience: { slug: "northwind-lead" } }],
    ["a missing quote", { ...kindWords, quote: undefined }],
    ["an empty quote", { ...kindWords, quote: "   " }],
    ["a quote that is too long", { ...kindWords, quote: "x".repeat(2001) }],
    ["a quote that is not text", { ...kindWords, quote: 5 }],
    ["a missing author name", { ...kindWords, authorName: undefined }],
    ["an empty author name", { ...kindWords, authorName: " " }],
    ["an author name that is too long", { ...kindWords, authorName: "x".repeat(201) }],
    ["a missing author role", { ...kindWords, authorRole: undefined }],
    ["no author role", { ...kindWords, authorRole: null }],
    ["an empty author role", { ...kindWords, authorRole: " " }],
    ["an author role that is too long", { ...kindWords, authorRole: "x".repeat(201) }],
    ["a missing position", { ...kindWords, position: undefined }],
    ["a negative position", { ...kindWords, position: -1 }],
    ["a fractional position", { ...kindWords, position: 1.5 }],
    ["an author photo before media exists", { ...kindWords, authorPhoto: "dana" }],
    ["a visibility flag", { ...kindWords, visible: true }],
  ])("rejects %s", (_, input) => {
    expect(TestimonialCreateSchema.safeParse(input).success).toBe(false);
  });

  it("names the field at fault", () => {
    const result = TestimonialCreateSchema.safeParse({ ...kindWords, quote: "" });
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([["quote"]]);
  });
});

describe("TestimonialUpdateSchema", () => {
  it("accepts a partial change without filling other fields", () => {
    expect(TestimonialUpdateSchema.parse({ quote: "Still great." })).toEqual({
      quote: "Still great.",
    });
  });

  it("accepts moving the testimonial to another experience", () => {
    expect(TestimonialUpdateSchema.parse({ experience: "acme-founder" })).toEqual({
      experience: "acme-founder",
    });
  });

  it.each([
    ["an empty change", {}],
    ["a change of the slug", { slug: "renamed" }],
    ["detaching the testimonial from its experience", { experience: null }],
    ["clearing the quote", { quote: null }],
    ["an empty quote", { quote: " " }],
    ["clearing the author's role", { authorRole: null }],
    ["an unknown field", { rating: 5 }],
  ])("rejects %s", (_, input) => {
    expect(TestimonialUpdateSchema.safeParse(input).success).toBe(false);
  });
});

describe("TestimonialSchema and TestimonialListSchema", () => {
  const testimonial = { ...stored, ...kindWords };

  it("describe stored testimonials with the experience they belong to", () => {
    expect(TestimonialSchema.parse(testimonial)).toEqual(testimonial);
    expect(TestimonialListSchema.parse([testimonial])).toEqual([testimonial]);
    expect(TestimonialListSchema.parse([])).toEqual([]);
  });

  it("rejects a testimonial without an experience", () => {
    expect(TestimonialSchema.safeParse({ ...testimonial, experience: null }).success).toBe(false);
  });

  it("is part of the experience it belongs to, beside its organization", () => {
    const experience = {
      ...stored,
      slug: "northwind-lead",
      title: "Lead Engineer",
      kind: "main_job",
      startedOn: "2021-03-01",
      endedOn: null,
      summary: "Led a fictional logistics platform.",
      responsibilities: [],
      inCv: true,
      organization: {
        ...stored,
        slug: "northwind",
        name: "Northwind Example",
        website: null,
        description: null,
      },
      technologies: [],
      projects: [],
      testimonials: [testimonial, { ...testimonial, slug: "lee-on-fleet", position: 2 }],
    };
    expect(ExperienceSchema.parse(experience)).toEqual(experience);
    expect(ExperienceSchema.safeParse({ ...experience, testimonials: undefined }).success).toBe(
      false,
    );
  });
});
