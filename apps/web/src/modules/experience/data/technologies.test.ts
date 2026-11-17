import { describe, expect, it } from "vitest";

import type { Technology } from "@sebela/api-client";

import { toTechnologyGroups } from "./technologies";

const STAMP = "2026-01-01T00:00:00.000Z";

function technology(
  slug: string,
  tier: Technology["tier"],
  group: Technology["group"],
  logoKey: string | null = null,
): Technology {
  return {
    id: "4a5b6c7d-8e9f-4a0b-9c1d-2e3f4a5b6c7d",
    slug,
    name: slug.toUpperCase(),
    tier,
    group,
    logoKey,
    position: 0,
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

const logos = new Set(["typescript", "postgresql"]);

describe("toTechnologyGroups", () => {
  it("groups core, AI engineering focus and secondary technologies in that order", () => {
    const groups = toTechnologyGroups(
      [
        technology("typescript", "primary", "core", "typescript"),
        technology("llms", "primary", "ai_engineering_focus"),
        technology("php", "secondary", null),
      ],
      logos,
    );

    expect(groups.map((group) => [group.key, group.anchor, group.label])).toEqual([
      ["core", "technology-group-core", "Core"],
      ["ai-engineering-focus", "technology-group-ai-engineering-focus", "AI engineering focus"],
      ["secondary", "technology-group-secondary", "Other technologies & tools"],
    ]);
  });

  it("keeps the API's order within each group", () => {
    const groups = toTechnologyGroups(
      [
        technology("typescript", "primary", "core"),
        technology("react", "primary", "core"),
        technology("mcp", "primary", "ai_engineering_focus"),
        technology("rag", "primary", "ai_engineering_focus"),
        technology("php", "secondary", null),
        technology("bash", "secondary", null),
      ],
      logos,
    );

    expect(groups.map((group) => group.technologies.map(({ slug }) => slug))).toEqual([
      ["typescript", "react"],
      ["mcp", "rag"],
      ["php", "bash"],
    ]);
  });

  it("shows a core technology's logo only when the website has that static logo", () => {
    const [core] = toTechnologyGroups(
      [
        technology("typescript", "primary", "core", "typescript"),
        technology("zig", "primary", "core", "zig"),
        technology("react", "primary", "core", null),
      ],
      logos,
    );

    expect(core?.technologies).toEqual([
      { slug: "typescript", name: "TYPESCRIPT", logoKey: "typescript" },
      { slug: "zig", name: "ZIG", logoKey: null },
      { slug: "react", name: "REACT", logoKey: null },
    ]);
  });

  it("never shows a logo for the AI engineering focus or a secondary technology", () => {
    const groups = toTechnologyGroups(
      [
        technology("llms", "primary", "ai_engineering_focus", "typescript"),
        technology("postgres", "secondary", null, "postgresql"),
      ],
      logos,
    );

    expect(groups.flatMap((group) => group.technologies.map(({ logoKey }) => logoKey))).toEqual([
      null,
      null,
    ]);
  });

  it("leaves out a group without technologies", () => {
    const groups = toTechnologyGroups([technology("php", "secondary", null)], logos);

    expect(groups.map((group) => group.key)).toEqual(["secondary"]);
  });

  it("is empty without technologies", () => {
    expect(toTechnologyGroups([], logos)).toEqual([]);
  });
});
