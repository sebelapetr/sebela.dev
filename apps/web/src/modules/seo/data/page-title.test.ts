import { describe, expect, it } from "vitest";

import { homepageTitle, pageTitle, TITLE_MAX } from "./page-title";

const NAME = "Robin Example";

/** Length as a reader counts it: one per character, never per UTF-16 unit. */
function length(text: string): number {
  return Array.from(text).length;
}

describe("pageTitle", () => {
  it("names the page, then the site's person, joined by a middle dot", () => {
    expect(pageTitle(NAME, "Experience")).toBe("Experience · Robin Example");
  });

  it("names the page's parent between the page and the person when there is room", () => {
    expect(pageTitle(NAME, "Signal basics", "Signal area")).toBe(
      "Signal basics · Signal area · Robin Example",
    );
  });

  it("drops the parent rather than go over the limit", () => {
    const page = "A fictional module with a rather long name";
    expect(pageTitle(NAME, page, "A fictional area")).toBe(`${page} · Robin Example`);
  });

  it("shortens a long page name at a word, never the person's name", () => {
    const page = "A fictional module whose name goes on and on far past any limit a title has";
    const title = pageTitle(NAME, page, "Signal area");
    expect(length(title)).toBeLessThanOrEqual(TITLE_MAX);
    expect(title).toBe("A fictional module whose name goes on and… · Robin Example");
  });

  it("shortens a page name of one long word inside the word", () => {
    const title = pageTitle(NAME, "x".repeat(80));
    expect(length(title)).toBe(TITLE_MAX);
    expect(title.endsWith("… · Robin Example")).toBe(true);
  });

  it("counts characters, so a title of wide characters is not cut short", () => {
    const page = "😀".repeat(50);
    const title = pageTitle(NAME, page);
    expect(length(title)).toBe(TITLE_MAX);
    // No half of a surrogate pair is left behind.
    expect(title).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it("keeps the person's name whole even when it alone is long", () => {
    const name = "Robin Alexandra Montgomery-Example of the Fictional Valley";
    const title = pageTitle(name, "Experience");
    expect(title.endsWith(` · ${name}`)).toBe(true);
    expect(title.startsWith("Experience")).toBe(true);
  });

  it("keeps markup as plain characters for Next to escape", () => {
    expect(pageTitle("</title><script>", "CV")).toBe("CV · </title><script>");
  });
});

describe("homepageTitle", () => {
  it("names the person with the headline as a short descriptor", () => {
    expect(homepageTitle(NAME, "Fictional engineer for tests")).toBe(
      "Robin Example · Fictional engineer for tests",
    );
  });

  it("shortens a long headline at a word, keeping the name whole", () => {
    const title = homepageTitle(
      NAME,
      "Fictional engineer who builds calm software for logistics and health care",
    );
    expect(length(title)).toBeLessThanOrEqual(TITLE_MAX);
    expect(title).toBe("Robin Example · Fictional engineer who builds calm software…");
  });

  it("is only the name when no descriptor of any use fits beside it", () => {
    const name = "Robin Alexandra Montgomery-Example of the Fictional Valley";
    expect(homepageTitle(name, "Fictional engineer for tests")).toBe(name);
  });
});
