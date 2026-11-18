import { describe, expect, it } from "vitest";

import { askRoute, currentNavigationHref, navigationItems } from "./navigation";

describe("navigationItems", () => {
  it("lists the agreed labels and addresses in the PRD's order", () => {
    expect(navigationItems).toEqual([
      { label: "Experience", href: "/experience" },
      { label: "Services", href: "/services" },
      { label: "AI Roadmap", href: "/ai-roadmap" },
      { label: "Contact", href: "/#contact" },
    ]);
  });

  it("leads Ask AI to the chat's address", () => {
    expect(askRoute).toBe("/ask");
  });
});

describe("currentNavigationHref", () => {
  it("marks the page an item leads to", () => {
    expect(currentNavigationHref("/experience")).toBe("/experience");
    expect(currentNavigationHref("/services")).toBe("/services");
    expect(currentNavigationHref("/ai-roadmap")).toBe("/ai-roadmap");
    expect(currentNavigationHref("/ask")).toBe("/ask");
  });

  it("marks the homepage through the name, never through Contact", () => {
    expect(currentNavigationHref("/")).toBe("/");
  });

  it("keeps an item current below its page and ignores a trailing slash", () => {
    expect(currentNavigationHref("/experience/")).toBe("/experience");
    expect(currentNavigationHref("/ai-roadmap/phase-1")).toBe("/ai-roadmap");
  });

  it("marks nothing on a page outside the navigation", () => {
    expect(currentNavigationHref("/cv")).toBeNull();
    expect(currentNavigationHref("/cv/pdf/unavailable")).toBeNull();
    expect(currentNavigationHref("/experiences")).toBeNull();
    expect(currentNavigationHref("/servicesx")).toBeNull();
    expect(currentNavigationHref("/missing")).toBeNull();
    expect(currentNavigationHref(null)).toBeNull();
  });
});
