import type { RoadmapBook, RoadmapBookStatus } from "@sebela/api-client";

import { anchorHref, bookshelfHref, formatDate } from "../../_shared";
import type {
  ImageMedia,
  RoadmapBookContent,
  RoadmapBookshelfContent,
  RoadmapShelfBook,
} from "../../profile";
import type { RoadmapCrumb } from "./detail";
import { formatStudyTime } from "./diary";
import { ROADMAP_PATH } from "./overview";

/** The bookshelf's name, as its pages and titles name it. */
export const BOOKSHELF_NAME = "Bookshelf";

/** A book as the bookshelf lists it. */
export interface ShelfBookRow {
  readonly slug: string;
  /** Its place on the shelf in the API's order, two digits: `01`. */
  readonly number: string;
  readonly title: string;
  /** The book's own page. */
  readonly href: string;
  readonly author: string | null;
  /** Markdown, or null. */
  readonly description: string | null;
  readonly status: RoadmapBookStatus;
  readonly statusLabel: string;
  readonly cover: ImageMedia | null;
}

export interface BookshelfPage {
  readonly books: readonly ShelfBookRow[];
  /** The overview, then the bookshelf (the current page, last). */
  readonly breadcrumbs: readonly RoadmapCrumb[];
}

/** A calendar day in words and as the API gave it, for `<time dateTime>`. */
export interface BookDate {
  readonly text: string;
  readonly dateTime: string;
}

/** A book's own page. */
export interface BookPage extends Omit<ShelfBookRow, "number"> {
  /** Its page count, year and ISBN in words; each one it lacks is left out. */
  readonly facts: readonly string[];
  readonly started: BookDate | null;
  readonly completed: BookDate | null;
  /** The reading time logged on its resource, or null without a resource. */
  readonly timeLogged: string | null;
  /** The resource that reads it, on its module's page, or null. */
  readonly resource: { readonly name: string; readonly href: string } | null;
  /** Markdown, or null. */
  readonly summary: string | null;
  /** The overview, the bookshelf, then the book (the current page, last). */
  readonly breadcrumbs: readonly RoadmapCrumb[];
}

/** What the bookshelf's metadata, structured data and preview image rest on. */
export interface BookshelfPageFacts {
  readonly name: string;
  readonly kind: "bookshelf";
  readonly breadcrumbs: readonly RoadmapCrumb[];
  readonly summary: null;
  readonly books: readonly {
    readonly title: string;
    readonly author: string | null;
    readonly href: string;
    readonly description: string | null;
  }[];
}

/** What a book's page metadata, structured data and preview image rest on. */
export interface BookPageFacts {
  readonly name: string;
  readonly kind: "book";
  readonly breadcrumbs: readonly RoadmapCrumb[];
  /** The book's Markdown description, or null. */
  readonly summary: string | null;
  readonly book: {
    readonly title: string;
    readonly author: string | null;
    readonly isbn: string | null;
    readonly pages: number | null;
    readonly year: number | null;
    /** The cover's site path, or null. */
    readonly image: string | null;
  };
}

const STATUS_LABELS: Record<RoadmapBookStatus, string> = {
  "to-read": "To read",
  reading: "Reading",
  completed: "Completed",
};

const OVERVIEW_CRUMB: RoadmapCrumb = { name: "AI Engineering Roadmap", href: ROADMAP_PATH };
const BOOKSHELF_CRUMB: RoadmapCrumb = { name: BOOKSHELF_NAME, href: bookshelfHref() };

/**
 * The bookshelf: every book in the API's shelf order, numbered by its place on the shelf, with its
 * status as the API derived it, and the way from the overview. Empty without books.
 */
export function toBookshelfPage(books: readonly RoadmapShelfBook[]): BookshelfPage {
  return {
    books: books.map((shelfBook, index) => ({
      number: String(index + 1).padStart(2, "0"),
      ...bookRow(shelfBook),
    })),
    breadcrumbs: [OVERVIEW_CRUMB, BOOKSHELF_CRUMB],
  };
}

/**
 * A book's own page: its facts, reading dates and logged time, the resource that reads it and its
 * summary. Whatever the book lacks is left out, never invented; the logged time is shown only for
 * a book a resource reads, since time is logged on the resource alone.
 */
export function toBookPage(content: RoadmapShelfBook): BookPage {
  const { book } = content;
  const row = bookRow(content);
  return {
    ...row,
    facts: bookFacts(book),
    started: bookDate(book.startedOn),
    completed: bookDate(book.endedOn),
    timeLogged: book.resource === null ? null : formatStudyTime(book.readingSeconds),
    resource:
      book.resource === null
        ? null
        : {
            name: book.resource.name,
            href: anchorHref({ kind: "roadmap-resource", ...book.resource }),
          },
    summary: book.summary,
    breadcrumbs: [OVERVIEW_CRUMB, BOOKSHELF_CRUMB, { name: book.title, href: row.href }],
  };
}

/** What the bookshelf's metadata rests on: its books in shelf order. */
export function bookshelfPageFacts(content: RoadmapBookshelfContent): BookshelfPageFacts {
  return {
    name: content.name,
    kind: "bookshelf",
    breadcrumbs: [OVERVIEW_CRUMB, BOOKSHELF_CRUMB],
    summary: null,
    books: content.books.map(({ book }) => ({
      title: book.title,
      author: book.author,
      href: bookshelfHref(book.slug),
      description: book.description,
    })),
  };
}

/** What a book's page metadata rests on: its description, its facts and its cover. */
export function bookPageFacts(content: RoadmapBookContent): BookPageFacts {
  const { book } = content;
  return {
    name: content.name,
    kind: "book",
    breadcrumbs: [
      OVERVIEW_CRUMB,
      BOOKSHELF_CRUMB,
      { name: book.title, href: bookshelfHref(book.slug) },
    ],
    summary: book.description,
    book: {
      title: book.title,
      author: book.author,
      isbn: book.isbn,
      pages: book.pages,
      year: book.year,
      image: content.cover?.url ?? null,
    },
  };
}

function bookRow({ book, cover }: RoadmapShelfBook): Omit<ShelfBookRow, "number"> {
  return {
    slug: book.slug,
    title: book.title,
    href: bookshelfHref(book.slug),
    author: book.author,
    description: book.description,
    status: book.status,
    statusLabel: STATUS_LABELS[book.status],
    cover,
  };
}

function bookFacts(book: RoadmapBook): string[] {
  const facts: string[] = [];
  if (book.pages !== null) facts.push(book.pages === 1 ? "1 page" : `${String(book.pages)} pages`);
  if (book.year !== null) facts.push(`Published ${String(book.year)}`);
  if (book.isbn !== null) facts.push(`ISBN ${book.isbn}`);
  return facts;
}

function bookDate(date: string | null): BookDate | null {
  return date === null ? null : { text: formatDate(date), dateTime: date };
}
