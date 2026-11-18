import { describe, expect, it } from "vitest";

import type { Technology } from "@sebela/api-client";

import { technologyGroupLabel, technologyGroupOf } from "./technology-group";

const STAMP = "2026-01-01T00:00:00.000Z";

function technology(tier: Technology["tier"], group: Technology["group"]): Technology {
  return {
    id: "4a5b6c7d-8e9f-4a0b-9c1d-2e3f4a5b6c7d",
    slug: "fictional",
    name: "Fictional technology",
    tier,
    group,
    logoKey: null,
    position: 0,
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

describe("technologyGroupOf", () => {
  it("puts a primary technology in its stored group", () => {
    expect(technologyGroupOf(technology("primary", "core"))).toBe("core");
    expect(technologyGroupOf(technology("primary", "ai_engineering_focus"))).toBe(
      "ai-engineering-focus",
    );
  });

  it("puts every secondary technology in the secondary group", () => {
    expect(technologyGroupOf(technology("secondary", null))).toBe("secondary");
    expect(technologyGroupOf(technology("secondary", "core"))).toBe("secondary");
  });

  it("puts a primary technology without a group in none", () => {
    expect(technologyGroupOf(technology("primary", null))).toBeNull();
  });
});

describe("technologyGroupLabel", () => {
  it("names each group as its heading does", () => {
    expect(technologyGroupLabel("core")).toBe("Core");
    expect(technologyGroupLabel("ai-engineering-focus")).toBe("AI engineering focus");
    expect(technologyGroupLabel("secondary")).toBe("Other technologies & tools");
  });
});
