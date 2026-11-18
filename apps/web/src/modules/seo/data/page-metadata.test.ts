import { describe, expect, it } from "vitest";

import { pageMetadata } from "./page-metadata";

const ORIGIN = "https://site.example.test";
const FACTS = { name: "Robin Example", headline: "Fictional engineer for tests" };

describe("pageMetadata", () => {
  it("titles the homepage with the name and headline", () => {
    expect(pageMetadata(ORIGIN, "home", FACTS).title).toBe(
      "Robin Example — Fictional engineer for tests",
    );
  });

  it.each([
    ["experience", "Experience — Robin Example"],
    ["services", "Services — Robin Example"],
    ["cv", "CV — Robin Example"],
  ] as const)("titles the %s page with its name and the person's", (page, title) => {
    expect(pageMetadata(ORIGIN, page, FACTS).title).toBe(title);
  });

  it("describes a page with its summary as plain text", () => {
    const metadata = pageMetadata(ORIGIN, "home", {
      ...FACTS,
      summary: "Robin is **made up** for [the tests](https://example.test).\n\nMore later.",
    });
    expect(metadata.description).toBe("Robin is made up for the tests.");
  });

  it("falls back to the headline without a summary or with an empty one", () => {
    expect(pageMetadata(ORIGIN, "services", { ...FACTS, summary: null }).description).toBe(
      FACTS.headline,
    );
    expect(pageMetadata(ORIGIN, "services", { ...FACTS, summary: " ** ** " }).description).toBe(
      FACTS.headline,
    );
  });

  it("keeps a long description short enough for a search result", () => {
    const summary = Array.from({ length: 80 }, (_, i) => `word${String(i)}`).join(" ");
    const description = pageMetadata(ORIGIN, "home", { ...FACTS, summary }).description ?? "";
    expect(description.length).toBeLessThanOrEqual(160);
    expect(description.endsWith("…")).toBe(true);
  });

  it.each([
    ["home", "https://site.example.test/"],
    ["experience", "https://site.example.test/experience"],
    ["services", "https://site.example.test/services"],
    ["cv", "https://site.example.test/cv"],
  ] as const)("gives the %s page its canonical address on the configured origin", (page, url) => {
    const metadata = pageMetadata(ORIGIN, page, FACTS);
    expect(metadata.alternates?.canonical).toBe(url);
    expect(metadata.openGraph).toMatchObject({ url });
  });

  it("follows another configured origin, never a fixed host", () => {
    const metadata = pageMetadata("http://other.example.test", "cv", FACTS);
    expect(metadata.alternates?.canonical).toBe("http://other.example.test/cv");
  });

  it("gives Open Graph the same title and description and the person as the site's name", () => {
    expect(pageMetadata(ORIGIN, "experience", FACTS).openGraph).toEqual({
      type: "website",
      url: "https://site.example.test/experience",
      title: "Experience — Robin Example",
      description: FACTS.headline,
      siteName: "Robin Example",
      images: [
        {
          url: "https://site.example.test/og/experience",
          width: 1200,
          height: 630,
          type: "image/png",
          alt: "Experience — Robin Example",
        },
      ],
    });
  });

  it.each([
    ["home", "https://site.example.test/og/home"],
    ["experience", "https://site.example.test/og/experience"],
    ["services", "https://site.example.test/og/services"],
    ["cv", "https://site.example.test/og/cv"],
  ] as const)("gives the %s page its own preview image on the configured origin", (page, url) => {
    const metadata = pageMetadata(ORIGIN, page, FACTS);
    expect(metadata.openGraph?.images).toEqual([expect.objectContaining({ url })]);
  });

  it("offers the preview image as a large card to every reader of Twitter cards", () => {
    expect(pageMetadata(ORIGIN, "cv", FACTS).twitter).toEqual({
      card: "summary_large_image",
      title: "CV — Robin Example",
      description: FACTS.headline,
      images: ["https://site.example.test/og/cv"],
    });
  });

  it("keeps markup in the facts as plain characters for Next to escape", () => {
    const metadata = pageMetadata(ORIGIN, "home", {
      name: "</title><script>alert(1)</script>",
      headline: "A & B",
    });
    expect(metadata.title).toBe("</title><script>alert(1)</script> — A & B");
  });
});
