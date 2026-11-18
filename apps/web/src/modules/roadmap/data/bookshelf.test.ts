import { describe, expect, it } from "vitest";

import type { RoadmapBook } from "@sebela/api-client";

import {
  BOOKSHELF_NAME,
  bookPageFacts,
  bookshelfPageFacts,
  toBookPage,
  toBookshelfPage,
} from "./bookshelf";

const STAMP = "2026-01-01T00:00:00.000Z";

const COVER = { url: "/media/cover.png", altText: "A fictional cover.", width: 400, height: 600 };

function book(slug: string, overrides: Partial<RoadmapBook> = {}): RoadmapBook {
  return {
    id: "6b7c8d9e-0f1a-4b2c-8d3e-4f5a6b7c8d9e",
    slug,
    title: `The ${slug}`,
    author: null,
    description: null,
    pages: null,
    year: null,
    isbn: null,
    priority: 0,
    startedOn: null,
    endedOn: null,
    summary: null,
    coverId: null,
    cover: null,
    status: "to-read",
    resource: null,
    readingSeconds: 0,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  };
}

const full = book("quiet-orbit", {
  title: "The Quiet Orbit",
  author: "Ada Example",
  description: "A **fictional** book.",
  pages: 240,
  year: 2021,
  isbn: "9780000000002",
  priority: 7,
  startedOn: "2026-03-05",
  endedOn: "2026-04-01",
  summary: "Learnt *much*.",
  status: "completed",
  resource: {
    slug: "orbit-reading",
    name: "Reading The Quiet Orbit",
    module: "signal-basics",
    area: "signal-area",
  },
  readingSeconds: 5400,
});

const bare = book("bare-book");

describe("toBookshelfPage", () => {
  it("numbers the books by their place on the shelf, in the API's order", () => {
    const page = toBookshelfPage([
      { book: full, cover: COVER },
      { book: bare, cover: null },
    ]);

    expect(page.books).toEqual([
      {
        slug: "quiet-orbit",
        number: "01",
        title: "The Quiet Orbit",
        href: "/ai-roadmap/bookshelf/quiet-orbit",
        author: "Ada Example",
        description: "A **fictional** book.",
        status: "completed",
        statusLabel: "Completed",
        cover: COVER,
      },
      {
        slug: "bare-book",
        number: "02",
        title: "The bare-book",
        href: "/ai-roadmap/bookshelf/bare-book",
        author: null,
        description: null,
        status: "to-read",
        statusLabel: "To read",
        cover: null,
      },
    ]);
  });

  it("names each status as the API derived it", () => {
    const page = toBookshelfPage(
      (["to-read", "reading", "completed"] as const).map((status) => ({
        book: book(status, { status }),
        cover: null,
      })),
    );

    expect(page.books.map((row) => row.statusLabel)).toEqual(["To read", "Reading", "Completed"]);
  });

  it("keeps a book's slug inside its own path segment", () => {
    expect(toBookshelfPage([{ book: book("../cv"), cover: null }]).books[0]?.href).toBe(
      "/ai-roadmap/bookshelf/..%2Fcv",
    );
  });

  it("leads from the overview to the bookshelf", () => {
    expect(toBookshelfPage([]).breadcrumbs).toEqual([
      { name: "AI Engineering Roadmap", href: "/ai-roadmap" },
      { name: BOOKSHELF_NAME, href: "/ai-roadmap/bookshelf" },
    ]);
  });

  it("is empty, never invented, without books", () => {
    expect(toBookshelfPage([]).books).toEqual([]);
  });
});

describe("toBookPage", () => {
  it("gives a book's facts, its progress, its time and the way to its resource", () => {
    expect(toBookPage({ book: full, cover: COVER })).toEqual({
      slug: "quiet-orbit",
      title: "The Quiet Orbit",
      href: "/ai-roadmap/bookshelf/quiet-orbit",
      author: "Ada Example",
      description: "A **fictional** book.",
      status: "completed",
      statusLabel: "Completed",
      cover: COVER,
      facts: ["240 pages", "Published 2021", "ISBN 9780000000002"],
      started: { text: "March 5th, 2026", dateTime: "2026-03-05" },
      completed: { text: "April 1st, 2026", dateTime: "2026-04-01" },
      timeLogged: "1h 30m",
      resource: {
        name: "Reading The Quiet Orbit",
        href: "/ai-roadmap/signal-area/signal-basics#resource-orbit-reading",
      },
      summary: "Learnt *much*.",
      breadcrumbs: [
        { name: "AI Engineering Roadmap", href: "/ai-roadmap" },
        { name: "Bookshelf", href: "/ai-roadmap/bookshelf" },
        { name: "The Quiet Orbit", href: "/ai-roadmap/bookshelf/quiet-orbit" },
      ],
    });
  });

  it("leaves out every fact, date and time a book does not have, inventing none", () => {
    expect(toBookPage({ book: bare, cover: null })).toMatchObject({
      author: null,
      description: null,
      cover: null,
      facts: [],
      started: null,
      completed: null,
      timeLogged: null,
      resource: null,
      summary: null,
    });
  });

  it("names a single page and a reading book's start without an end", () => {
    expect(
      toBookPage({
        book: book("short", { pages: 1, startedOn: "2025-12-31", status: "reading" }),
        cover: null,
      }),
    ).toMatchObject({
      facts: ["1 page"],
      started: { text: "December 31st, 2025", dateTime: "2025-12-31" },
      completed: null,
      statusLabel: "Reading",
    });
  });

  it("shows the time of a book's resource even when none is logged yet", () => {
    const linked = book("linked", { resource: full.resource, readingSeconds: 0 });

    expect(toBookPage({ book: linked, cover: null }).timeLogged).toBe("0 min");
  });

  it("keeps the resource's area and module inside their own path segments", () => {
    const odd = book("odd", {
      resource: { slug: "odd-reading", name: "Odd", module: "m/n", area: "a?b" },
    });

    expect(toBookPage({ book: odd, cover: null }).resource?.href).toBe(
      "/ai-roadmap/a%3Fb/m%2Fn#resource-odd-reading",
    );
  });
});

describe("the bookshelf's and a book's page facts", () => {
  it("rests the bookshelf's metadata on its books in order", () => {
    expect(
      bookshelfPageFacts({
        name: "Robin Example",
        headline: "Fictional engineer for tests",
        books: [
          { book: full, cover: COVER },
          { book: bare, cover: null },
        ],
      }),
    ).toEqual({
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
          description: "A **fictional** book.",
        },
        {
          title: "The bare-book",
          author: null,
          href: "/ai-roadmap/bookshelf/bare-book",
          description: null,
        },
      ],
    });
  });

  it("rests a book's metadata on its own facts and cover", () => {
    expect(
      bookPageFacts({
        name: "Robin Example",
        headline: "Fictional engineer for tests",
        book: full,
        cover: COVER,
      }),
    ).toEqual({
      name: "Robin Example",
      kind: "book",
      breadcrumbs: [
        { name: "AI Engineering Roadmap", href: "/ai-roadmap" },
        { name: "Bookshelf", href: "/ai-roadmap/bookshelf" },
        { name: "The Quiet Orbit", href: "/ai-roadmap/bookshelf/quiet-orbit" },
      ],
      summary: "A **fictional** book.",
      book: {
        title: "The Quiet Orbit",
        author: "Ada Example",
        isbn: "9780000000002",
        pages: 240,
        year: 2021,
        image: "/media/cover.png",
      },
    });
  });

  it("gives a book without a cover no image", () => {
    expect(
      bookPageFacts({ name: "Robin Example", headline: "x", book: bare, cover: null }).book.image,
    ).toBeNull();
  });
});
