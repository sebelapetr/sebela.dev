import type { RoadmapBookStatus } from "@sebela/api-client";

import type {
  ImageMedia,
  RoadmapBookContent,
  RoadmapBookshelfContent,
  RoadmapShelfBook,
} from "../../profile";
import type { RoadmapCrumb } from "./detail";

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

export function toBookshelfPage(books: readonly RoadmapShelfBook[]): BookshelfPage {
  throw new Error("not implemented", { cause: books });
}

export function toBookPage(content: RoadmapShelfBook): BookPage {
  throw new Error("not implemented", { cause: content });
}

export function bookshelfPageFacts(content: RoadmapBookshelfContent): BookshelfPageFacts {
  throw new Error("not implemented", { cause: content });
}

export function bookPageFacts(content: RoadmapBookContent): BookPageFacts {
  throw new Error("not implemented", { cause: content });
}
