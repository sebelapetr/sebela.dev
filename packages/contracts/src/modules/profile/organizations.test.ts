import { describe, expect, it } from "vitest";

import {
  OrganizationCreateSchema,
  OrganizationListSchema,
  OrganizationSchema,
  OrganizationUpdateSchema,
} from "./index.js";

const stored = {
  id: "0b8f5c2e-1d4a-4f6b-9c3e-2a7d8e9f0a1b",
  createdAt: "2026-01-01T10:00:00.000Z",
  updatedAt: "2026-01-02T10:00:00.000Z",
};

const northwind = {
  slug: "northwind",
  name: "Northwind Example",
  website: "https://northwind.example.com/",
  description: "A **fictional** logistics company.",
};

describe("OrganizationCreateSchema", () => {
  it("accepts an organization with a website and a description", () => {
    expect(OrganizationCreateSchema.parse(northwind)).toEqual(northwind);
  });

  it("fills an unset website and description with null", () => {
    expect(OrganizationCreateSchema.parse({ slug: "acme", name: "Acme" })).toEqual({
      slug: "acme",
      name: "Acme",
      website: null,
      description: null,
    });
  });

  it("trims the name and the description", () => {
    expect(
      OrganizationCreateSchema.parse({ ...northwind, name: "  Northwind ", description: " x " }),
    ).toMatchObject({ name: "Northwind", description: "x" });
  });

  it.each([
    ["a missing slug", { name: "Acme" }],
    ["an invalid slug", { ...northwind, slug: "North Wind" }],
    ["a missing name", { slug: "acme" }],
    ["an empty name", { ...northwind, name: "   " }],
    ["a name that is too long", { ...northwind, name: "x".repeat(201) }],
    ["a description that is too long", { ...northwind, description: "x".repeat(5001) }],
    ["an empty description", { ...northwind, description: " " }],
    ["a website that is not a URL", { ...northwind, website: "northwind" }],
    ["a website that is not http(s)", { ...northwind, website: "ftp://northwind.example.com" }],
    ["a website with a script scheme", { ...northwind, website: "javascript:alert(1)" }],
    ["a website without a domain host", { ...northwind, website: "https://northwind/" }],
    [
      "a website that is too long",
      { ...northwind, website: `https://northwind.example.com/${"x".repeat(2048)}` },
    ],
    ["a logo reference before media exists", { ...northwind, logo: "northwind.png" }],
    ["a logo media identifier", { ...northwind, logoMediaId: stored.id }],
    ["an unexpected field", { ...northwind, position: 1 }],
  ])("rejects %s", (_, input) => {
    expect(OrganizationCreateSchema.safeParse(input).success).toBe(false);
  });

  it("names the offending field", () => {
    const result = OrganizationCreateSchema.safeParse({ ...northwind, website: "northwind" });
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([["website"]]);
  });
});

describe("OrganizationUpdateSchema", () => {
  it("accepts a partial change without filling other fields", () => {
    expect(OrganizationUpdateSchema.parse({ name: "Northwind" })).toEqual({ name: "Northwind" });
  });

  it("accepts clearing the website and the description", () => {
    expect(OrganizationUpdateSchema.parse({ website: null, description: null })).toEqual({
      website: null,
      description: null,
    });
  });

  it.each([
    ["an empty change", {}],
    ["a change of the slug", { slug: "renamed" }],
    ["clearing the name", { name: null }],
    ["an invalid website", { website: "mailto:office@northwind.example.com" }],
    ["a logo reference", { logo: "northwind.png" }],
  ])("rejects %s", (_, input) => {
    expect(OrganizationUpdateSchema.safeParse(input).success).toBe(false);
  });
});

describe("OrganizationSchema and OrganizationListSchema", () => {
  it("describe stored organizations with identifiers and timestamps", () => {
    const organization = { ...stored, ...northwind };
    expect(OrganizationSchema.parse(organization)).toEqual(organization);
    expect(OrganizationListSchema.parse([organization])).toEqual([organization]);
    expect(OrganizationListSchema.parse([])).toEqual([]);
  });
});
