import { describe, expect, it } from "vitest";

import { serializeJsonLd } from "./structured-data";
import {
  roadmapOpenGraphCard,
  roadmapOpenGraphImageUrl,
  roadmapPageMetadata,
  roadmapStructuredData,
  type RoadmapPageFacts,
} from "./roadmap-page";

const ORIGIN = "https://site.example.test";

const AREA: RoadmapPageFacts = {
  name: "Robin Example",
  kind: "area",
  estimatedMinutes: 0,
  breadcrumbs: [
    { name: "AI Engineering Roadmap", href: "/ai-roadmap" },
    { name: "Signal area", href: "/ai-roadmap/signal-area" },
  ],
  summary: "Learns **fictional** signals from [notes](https://example.test).\n\nMore later.",
};

const MODULE: RoadmapPageFacts = {
  name: "Robin Example",
  kind: "module",
  estimatedMinutes: 90,
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

  it("gives the page its canonical address, Open Graph basics and its own preview image", () => {
    const metadata = roadmapPageMetadata(ORIGIN, MODULE);
    const url = "https://site.example.test/ai-roadmap/signal-area/signal-basics";
    const image = "https://site.example.test/og/ai-roadmap/signal-area/signal-basics";
    const title = "Signal basics — Signal area — AI Engineering Roadmap — Robin Example";
    const description =
      "Signal basics, part of Signal area on Robin Example's AI Engineering Roadmap.";
    expect(metadata.alternates?.canonical).toBe(url);
    expect(metadata.openGraph).toEqual({
      type: "website",
      url,
      title,
      description,
      siteName: "Robin Example",
      images: [{ url: image, width: 1200, height: 630, type: "image/png", alt: title }],
    });
    expect(metadata.twitter).toEqual({
      card: "summary_large_image",
      title,
      description,
      images: [image],
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

describe("roadmapOpenGraphImageUrl", () => {
  it("addresses the page's preview image below /og on the configured origin, as the page's path", () => {
    expect(roadmapOpenGraphImageUrl(ORIGIN, AREA)).toBe(
      "https://site.example.test/og/ai-roadmap/signal-area",
    );
    expect(
      roadmapOpenGraphImageUrl("http://other.example.test", {
        ...AREA,
        breadcrumbs: [
          { name: "AI Engineering Roadmap", href: "/ai-roadmap" },
          { name: "Odd", href: "/ai-roadmap/odd%2Fslug" },
        ],
      }),
    ).toBe("http://other.example.test/og/ai-roadmap/odd%2Fslug");
  });
});

describe("roadmapOpenGraphCard", () => {
  it("names an area's page, its kind and whose roadmap it is on", () => {
    expect(roadmapOpenGraphCard(ORIGIN, AREA)).toEqual({
      site: "site.example.test",
      label: "Learning area",
      title: "Signal area",
      subtitle: "Robin Example's AI Engineering Roadmap",
    });
  });

  it("names a module's page with the area it is part of", () => {
    expect(roadmapOpenGraphCard(ORIGIN, MODULE)).toEqual({
      site: "site.example.test",
      label: "Learning module",
      title: "Signal basics",
      subtitle: "Part of Signal area on Robin Example's AI Engineering Roadmap",
    });
  });

  it("shortens a long name so it fits the card", () => {
    const long = "A".repeat(80);
    const card = roadmapOpenGraphCard(ORIGIN, {
      ...AREA,
      breadcrumbs: [...AREA.breadcrumbs.slice(0, 1), { name: long, href: "/ai-roadmap/long" }],
    });
    expect(card.title).toHaveLength(60);
    expect(card.title.endsWith("…")).toBe(true);
  });

  it("shows the site's own card when the page cannot be read", () => {
    expect(roadmapOpenGraphCard(ORIGIN, null)).toEqual({
      site: "site.example.test",
      label: "AI Engineering Roadmap",
      title: "site.example.test",
      subtitle: null,
    });
  });
});

describe("roadmapStructuredData", () => {
  it("describes an area as a course with the person as its provider and no estimate when none", () => {
    const graph = (roadmapStructuredData(ORIGIN, AREA) as { "@graph": object[] })["@graph"];
    expect(graph).toContainEqual({
      "@type": "Course",
      "@id": "https://site.example.test/ai-roadmap/signal-area#course",
      url: "https://site.example.test/ai-roadmap/signal-area",
      name: "Signal area",
      description: "Learns fictional signals from notes.",
      inLanguage: "en",
      provider: {
        "@type": "Person",
        "@id": "https://site.example.test/#person",
        name: "Robin Example",
      },
      mainEntityOfPage: { "@id": "https://site.example.test/ai-roadmap/signal-area#webpage" },
    });
  });

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
        {
          "@type": "Course",
          "@id": "https://site.example.test/ai-roadmap/signal-area/signal-basics#course",
          url: "https://site.example.test/ai-roadmap/signal-area/signal-basics",
          name: "Signal basics",
          description:
            "Signal basics, part of Signal area on Robin Example's AI Engineering Roadmap.",
          inLanguage: "en",
          provider: {
            "@type": "Person",
            "@id": "https://site.example.test/#person",
            name: "Robin Example",
          },
          mainEntityOfPage: {
            "@id": "https://site.example.test/ai-roadmap/signal-area/signal-basics#webpage",
          },
          timeRequired: "PT90M",
          isPartOf: {
            "@type": "Course",
            "@id": "https://site.example.test/ai-roadmap/signal-area#course",
            name: "Signal area",
            url: "https://site.example.test/ai-roadmap/signal-area",
          },
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
        { itemListElement: [{}, { name: "</script><script>alert(1)</script>" }] },
        { name: "</script><script>alert(1)</script>" },
      ],
    });
  });
});
