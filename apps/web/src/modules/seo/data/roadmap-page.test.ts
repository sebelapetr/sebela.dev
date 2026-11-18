import { describe, expect, it } from "vitest";

import { serializeJsonLd } from "./structured-data";
import { roadmapPageMetadata, roadmapStructuredData, type RoadmapPageFacts } from "./roadmap-page";

const ORIGIN = "https://site.example.test";

const AREA: RoadmapPageFacts = {
  name: "Robin Example",
  breadcrumbs: [
    { name: "AI Engineering Roadmap", href: "/ai-roadmap" },
    { name: "Signal area", href: "/ai-roadmap/signal-area" },
  ],
  summary: "Learns **fictional** signals from [notes](https://example.test).\n\nMore later.",
};

const MODULE: RoadmapPageFacts = {
  name: "Robin Example",
  breadcrumbs: [
    ...AREA.breadcrumbs,
    { name: "Signal basics", href: "/ai-roadmap/signal-area/signal-basics" },
  ],
  summary: null,
};

describe("roadmapPageMetadata", () => {
  it("titles a page by the way to it, from the page up to the person", () => {
    expect(roadmapPageMetadata(ORIGIN, AREA).title).toBe(
      "Signal area — AI Engineering Roadmap — Robin Example",
    );
    expect(roadmapPageMetadata(ORIGIN, MODULE).title).toBe(
      "Signal basics — Signal area — AI Engineering Roadmap — Robin Example",
    );
  });

  it("describes a page with its summary's first paragraph as plain text", () => {
    expect(roadmapPageMetadata(ORIGIN, AREA).description).toBe(
      "Learns fictional signals from notes.",
    );
  });

  it("describes a page without a summary by what it is, never by a fact of its own", () => {
    expect(roadmapPageMetadata(ORIGIN, MODULE).description).toBe(
      "Signal basics, part of Signal area on Robin Example's AI Engineering Roadmap.",
    );
    expect(roadmapPageMetadata(ORIGIN, { ...AREA, summary: " ** " }).description).toBe(
      "Signal area on Robin Example's AI Engineering Roadmap.",
    );
  });

  it("gives the page its canonical address on the configured origin and Open Graph basics", () => {
    const metadata = roadmapPageMetadata(ORIGIN, MODULE);
    const url = "https://site.example.test/ai-roadmap/signal-area/signal-basics";
    expect(metadata.alternates?.canonical).toBe(url);
    expect(metadata.openGraph).toEqual({
      type: "website",
      url,
      title: "Signal basics — Signal area — AI Engineering Roadmap — Robin Example",
      description: "Signal basics, part of Signal area on Robin Example's AI Engineering Roadmap.",
      siteName: "Robin Example",
    });
    expect(metadata.twitter).toEqual({
      card: "summary",
      title: "Signal basics — Signal area — AI Engineering Roadmap — Robin Example",
      description: "Signal basics, part of Signal area on Robin Example's AI Engineering Roadmap.",
    });
  });

  it("follows another configured origin, never a fixed host", () => {
    expect(roadmapPageMetadata("http://other.example.test", AREA).alternates?.canonical).toBe(
      "http://other.example.test/ai-roadmap/signal-area",
    );
  });

  it("keeps the page out of search results until the roadmap is indexed as a whole", () => {
    expect(roadmapPageMetadata(ORIGIN, AREA).robots).toEqual({ index: false });
  });
});

describe("roadmapStructuredData", () => {
  it("describes the page as part of the website, with its breadcrumbs on the origin", () => {
    expect(roadmapStructuredData(ORIGIN, MODULE)).toEqual({
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "WebPage",
          "@id": "https://site.example.test/ai-roadmap/signal-area/signal-basics#webpage",
          url: "https://site.example.test/ai-roadmap/signal-area/signal-basics",
          name: "Signal basics — Signal area — AI Engineering Roadmap — Robin Example",
          description:
            "Signal basics, part of Signal area on Robin Example's AI Engineering Roadmap.",
          inLanguage: "en",
          isPartOf: { "@id": "https://site.example.test/#website" },
          breadcrumb: {
            "@id": "https://site.example.test/ai-roadmap/signal-area/signal-basics#breadcrumb",
          },
        },
        {
          "@type": "BreadcrumbList",
          "@id": "https://site.example.test/ai-roadmap/signal-area/signal-basics#breadcrumb",
          itemListElement: [
            {
              "@type": "ListItem",
              position: 1,
              name: "AI Engineering Roadmap",
              item: "https://site.example.test/ai-roadmap",
            },
            {
              "@type": "ListItem",
              position: 2,
              name: "Signal area",
              item: "https://site.example.test/ai-roadmap/signal-area",
            },
            {
              "@type": "ListItem",
              position: 3,
              name: "Signal basics",
              item: "https://site.example.test/ai-roadmap/signal-area/signal-basics",
            },
          ],
        },
      ],
    });
  });

  it("serializes a name with markup so it can never close the script element", () => {
    const json = serializeJsonLd(
      roadmapStructuredData(ORIGIN, {
        ...AREA,
        breadcrumbs: [
          { name: "AI Engineering Roadmap", href: "/ai-roadmap" },
          { name: "</script><script>alert(1)</script>", href: "/ai-roadmap/odd" },
        ],
      }),
    );
    expect(json).not.toContain("</script>");
    expect(JSON.parse(json)).toMatchObject({
      "@graph": [
        { name: "</script><script>alert(1)</script> — AI Engineering Roadmap — Robin Example" },
      ],
    });
  });
});
