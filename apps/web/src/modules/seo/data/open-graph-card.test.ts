import { describe, expect, it } from "vitest";

import { isPreviewPage, openGraphCard, openGraphImageUrl } from "./open-graph-card";

const ORIGIN = "https://site.example.test";
const FACTS = { name: "Robin Example", headline: "Fictional engineer for tests" };

describe("isPreviewPage", () => {
  it.each(["home", "experience", "services", "cv"])("knows the indexed page %s", (page) => {
    expect(isPreviewPage(page)).toBe(true);
  });

  it.each(["ask", "ai-roadmap", "", "HOME", "home.png", "../cv", "toString", "__proto__"])(
    "refuses %j",
    (page) => {
      expect(isPreviewPage(page)).toBe(false);
    },
  );
});

describe("openGraphImageUrl", () => {
  it("addresses each page's preview image on the configured origin", () => {
    expect(openGraphImageUrl(ORIGIN, "home")).toBe("https://site.example.test/og/home");
    expect(openGraphImageUrl("http://other.example.test", "cv")).toBe(
      "http://other.example.test/og/cv",
    );
  });
});

describe("openGraphCard", () => {
  it("shows the person's name and headline on the homepage's card, without a page label", () => {
    expect(openGraphCard(ORIGIN, "home", FACTS)).toEqual({
      site: "site.example.test",
      label: null,
      title: "Robin Example",
      subtitle: "Fictional engineer for tests",
    });
  });

  it.each([
    ["experience", "Experience"],
    ["services", "Services"],
    ["cv", "CV"],
  ] as const)("labels the %s page's card with its page", (page, label) => {
    expect(openGraphCard(ORIGIN, page, FACTS)).toMatchObject({ label, title: FACTS.name });
  });

  it("falls back to the site's own card when the profile cannot be read", () => {
    expect(openGraphCard(ORIGIN, "experience", null)).toEqual({
      site: "site.example.test",
      label: "Experience",
      title: "site.example.test",
      subtitle: null,
    });
  });

  it("shortens a very long name or headline so it fits the card", () => {
    const card = openGraphCard(ORIGIN, "home", {
      name: "N".repeat(200),
      headline: "word ".repeat(100),
    });
    expect(card.title.length).toBeLessThanOrEqual(60);
    expect(card.title.endsWith("…")).toBe(true);
    expect(card.subtitle?.length).toBeLessThanOrEqual(120);
    expect(card.subtitle?.endsWith("…")).toBe(true);
  });

  it("keeps markup in the facts as plain text", () => {
    const card = openGraphCard(ORIGIN, "home", { name: "<b>A & B</b>", headline: "x" });
    expect(card.title).toBe("<b>A & B</b>");
  });
});
