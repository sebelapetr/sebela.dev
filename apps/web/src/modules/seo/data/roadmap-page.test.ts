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

type BookshelfFacts = Extract<RoadmapPageFacts, { kind: "bookshelf" }>;
type BookFacts = Extract<RoadmapPageFacts, { kind: "book" }>;

const BOOKSHELF: BookshelfFacts = {
  name: "Robin Example",
  kind: "bookshelf",
  breadcrumbs: [
    { name: "AI Engineering Roadmap", href: "/ai-roadmap" },
    { name: "Bookshelf", href: "/ai-roadmap/bookshelf" },
  ],
  summary: null,
  books: [
    {
      title: "The Quiet Orbit",
      author: "Ada Example",
      href: "/ai-roadmap/bookshelf/quiet-orbit",
      description: "A **fictional** book.\n\nMore later.",
    },
    {
      title: "Untitled Notes",
      author: null,
      href: "/ai-roadmap/bookshelf/notes",
      description: null,
    },
  ],
};

const BOOK: BookFacts = {
  name: "Robin Example",
  kind: "book",
  breadcrumbs: [
    ...BOOKSHELF.breadcrumbs,
    { name: "The Quiet Orbit", href: "/ai-roadmap/bookshelf/quiet-orbit" },
  ],
  summary: "A **fictional** book about [signals](https://example.test).",
  book: {
    title: "The Quiet Orbit",
    author: "Ada Example",
    isbn: "9780000000002",
    pages: 240,
    year: 2021,
    image: "/media/cover.png",
  },
};

const SPARSE_BOOK: BookFacts = {
  ...BOOK,
  summary: null,
  book: {
    title: "The Quiet Orbit",
    author: null,
    isbn: null,
    pages: null,
    year: null,
    image: null,
  },
};

describe("the bookshelf's and a book's metadata", () => {
  it("titles the bookshelf and a book by the way to them", () => {
    expect(roadmapPageMetadata(ORIGIN, BOOKSHELF).title).toBe(
      "Bookshelf — AI Engineering Roadmap — Robin Example",
    );
    expect(roadmapPageMetadata(ORIGIN, BOOK).title).toBe(
      "The Quiet Orbit — Bookshelf — AI Engineering Roadmap — Robin Example",
    );
  });

  it("describes the bookshelf by what it is, never by a fact of its own", () => {
    expect(roadmapPageMetadata(ORIGIN, BOOKSHELF).description).toBe(
      "Bookshelf on Robin Example's AI Engineering Roadmap.",
    );
  });

  it("describes a book by its title, its author and its description as plain text", () => {
    expect(roadmapPageMetadata(ORIGIN, BOOK).description).toBe(
      "The Quiet Orbit by Ada Example. A fictional book about signals.",
    );
  });

  it("keeps a book's description within a search result's length", () => {
    const description = roadmapPageMetadata(ORIGIN, {
      ...BOOK,
      summary: "word ".repeat(80),
    }).description;
    expect(description?.length).toBeLessThanOrEqual(160);
    expect(description?.startsWith("The Quiet Orbit by Ada Example. word")).toBe(true);
    expect(description?.endsWith("…")).toBe(true);
  });

  it("describes a book without an author or a description by what it is, inventing nothing", () => {
    expect(roadmapPageMetadata(ORIGIN, SPARSE_BOOK).description).toBe(
      "The Quiet Orbit, part of Bookshelf on Robin Example's AI Engineering Roadmap.",
    );
    expect(
      roadmapPageMetadata(ORIGIN, { ...SPARSE_BOOK, summary: "Notes **only**." }).description,
    ).toBe("The Quiet Orbit. Notes only.");
  });

  it("gives a book its canonical address and its own preview image, out of search results", () => {
    const metadata = roadmapPageMetadata(ORIGIN, BOOK);
    expect(metadata.alternates?.canonical).toBe(
      "https://site.example.test/ai-roadmap/bookshelf/quiet-orbit",
    );
    expect(roadmapOpenGraphImageUrl(ORIGIN, BOOK)).toBe(
      "https://site.example.test/og/ai-roadmap/bookshelf/quiet-orbit",
    );
    expect(metadata.robots).toEqual({ index: false });
  });
});

describe("the bookshelf's and a book's preview cards", () => {
  it("names the bookshelf and whose roadmap it is on", () => {
    expect(roadmapOpenGraphCard(ORIGIN, BOOKSHELF)).toEqual({
      site: "site.example.test",
      label: "Bookshelf",
      title: "Bookshelf",
      subtitle: "Robin Example's AI Engineering Roadmap",
    });
  });

  it("names a book with its author, or only the roadmap without one", () => {
    expect(roadmapOpenGraphCard(ORIGIN, BOOK)).toEqual({
      site: "site.example.test",
      label: "Book",
      title: "The Quiet Orbit",
      subtitle: "By Ada Example, on Robin Example's AI Engineering Roadmap",
    });
    expect(roadmapOpenGraphCard(ORIGIN, SPARSE_BOOK).subtitle).toBe(
      "Robin Example's AI Engineering Roadmap",
    );
  });
});

describe("the bookshelf's and a book's structured data", () => {
  function graph(facts: RoadmapPageFacts): object[] {
    return (roadmapStructuredData(ORIGIN, facts) as { "@graph": object[] })["@graph"];
  }

  it("lists the bookshelf's books in its order, each by its title, author and page", () => {
    expect(graph(BOOKSHELF)).toContainEqual({
      "@type": "ItemList",
      "@id": "https://site.example.test/ai-roadmap/bookshelf#books",
      name: "Bookshelf",
      numberOfItems: 2,
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "The Quiet Orbit by Ada Example",
          url: "https://site.example.test/ai-roadmap/bookshelf/quiet-orbit",
          description: "A fictional book.",
        },
        {
          "@type": "ListItem",
          position: 2,
          name: "Untitled Notes",
          url: "https://site.example.test/ai-roadmap/bookshelf/notes",
        },
      ],
    });
    expect(graph(BOOKSHELF)).not.toContainEqual(expect.objectContaining({ "@type": "Course" }));
  });

  it("describes a book with every fact it has, its cover on the origin", () => {
    expect(graph(BOOK)).toContainEqual({
      "@type": "Book",
      "@id": "https://site.example.test/ai-roadmap/bookshelf/quiet-orbit#book",
      url: "https://site.example.test/ai-roadmap/bookshelf/quiet-orbit",
      name: "The Quiet Orbit",
      description: "The Quiet Orbit by Ada Example. A fictional book about signals.",
      author: { "@type": "Person", name: "Ada Example" },
      isbn: "9780000000002",
      numberOfPages: 240,
      datePublished: "2021",
      image: "https://site.example.test/media/cover.png",
      mainEntityOfPage: {
        "@id": "https://site.example.test/ai-roadmap/bookshelf/quiet-orbit#webpage",
      },
    });
  });

  it("leaves out every fact a book does not have, never inventing one", () => {
    expect(graph(SPARSE_BOOK)).toContainEqual({
      "@type": "Book",
      "@id": "https://site.example.test/ai-roadmap/bookshelf/quiet-orbit#book",
      url: "https://site.example.test/ai-roadmap/bookshelf/quiet-orbit",
      name: "The Quiet Orbit",
      description: "The Quiet Orbit, part of Bookshelf on Robin Example's AI Engineering Roadmap.",
      mainEntityOfPage: {
        "@id": "https://site.example.test/ai-roadmap/bookshelf/quiet-orbit#webpage",
      },
    });
  });

  it("serializes a book's title with markup so it can never close the script element", () => {
    const title = "</script><script>alert(1)</script>";
    const json = serializeJsonLd(
      roadmapStructuredData(ORIGIN, { ...SPARSE_BOOK, book: { ...SPARSE_BOOK.book, title } }),
    );
    expect(json).not.toContain("</script>");
    expect((JSON.parse(json) as { "@graph": object[] })["@graph"]).toContainEqual(
      expect.objectContaining({ "@type": "Book", name: title }),
    );
  });
});
