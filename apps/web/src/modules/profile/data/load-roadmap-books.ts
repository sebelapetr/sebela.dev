import type { ApiClient, RoadmapBook } from "@sebela/api-client";

import { imageFromMedia, type ImageMedia } from "./image";

/** A book of the bookshelf with its cover as the site's image, or null when it has none. */
export interface RoadmapShelfBook {
  /** The book exactly as the API answered it: status and reading time are the API's. */
  readonly book: RoadmapBook;
  readonly cover: ImageMedia | null;
}

/** The content of the bookshelf, all of it from the API. */
export interface RoadmapBookshelfContent {
  readonly name: string;
  readonly headline: string;
  /** Every book in the API's shelf order; empty when there are none. */
  readonly books: readonly RoadmapShelfBook[];
}

/** The content of one book's page, all of it from the API. */
export interface RoadmapBookContent extends RoadmapShelfBook {
  readonly name: string;
  readonly headline: string;
}

/** What the bookshelf can show: its content, no profile yet, or content not readable now. */
export type RoadmapBookshelfResult =
  | { readonly status: "ready"; readonly content: RoadmapBookshelfContent }
  | { readonly status: "missing" }
  | { readonly status: "unavailable" };

/** What a book's page can show: its content, no such book, or content not readable now. */
export type RoadmapBookResult =
  | { readonly status: "ready"; readonly content: RoadmapBookContent }
  | { readonly status: "missing" }
  | { readonly status: "unavailable" };

export interface LoadRoadmapBooksOptions {
  /** The public base the API's media addresses start with; covers outside it are not shown. */
  readonly mediaBaseUrl: string;
  /** How long each request may take; 5 seconds by default. */
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * Reads the bookshelf from the API's public routes: the person and every book in the API's shelf
 * order, uncached and limited in time. Each book keeps the API's derived status and reading time;
 * its embedded cover becomes the site's image, or none when it cannot be shown. A person that does
 * not exist makes the page missing; an empty shelf is ready with no books; any other failed read
 * makes it unavailable, never empty.
 */
export async function loadRoadmapBookshelf(
  client: ApiClient,
  options: LoadRoadmapBooksOptions,
): Promise<RoadmapBookshelfResult> {
  const init = requestInit(options);
  try {
    const [personRead, booksRead] = await Promise.all([
      client.GET("/v1/person", init()),
      client.GET("/v1/roadmap/books", init()),
    ]);
    if (personRead.data === undefined) return failedPersonRead(personRead.response);
    if (booksRead.data === undefined) return { status: "unavailable" };
    return {
      status: "ready",
      content: {
        name: personRead.data.name,
        headline: personRead.data.headline,
        books: booksRead.data.map((book) => shelfBook(book, options.mediaBaseUrl)),
      },
    };
  } catch {
    return { status: "unavailable" };
  }
}

/**
 * Reads one book's page from the API's public routes: the person and the book, uncached and limited
 * in time. A book that does not exist, an address that is not a slug or a person that does not
 * exist makes the page missing; any other failed read makes it unavailable, never missing.
 */
export async function loadRoadmapBook(
  client: ApiClient,
  slug: string,
  options: LoadRoadmapBooksOptions,
): Promise<RoadmapBookResult> {
  const init = requestInit(options);
  try {
    const [personRead, bookRead] = await Promise.all([
      client.GET("/v1/person", init()),
      client.GET("/v1/roadmap/books/{slug}", { params: { path: { slug } }, ...init() }),
    ]);
    if (personRead.data === undefined) return failedPersonRead(personRead.response);
    if (bookRead.data === undefined) {
      const { status } = bookRead.response;
      return status === 404 || status === 400 ? { status: "missing" } : { status: "unavailable" };
    }
    return {
      status: "ready",
      content: {
        name: personRead.data.name,
        headline: personRead.data.headline,
        ...shelfBook(bookRead.data, options.mediaBaseUrl),
      },
    };
  } catch {
    return { status: "unavailable" };
  }
}

function shelfBook(book: RoadmapBook, mediaBaseUrl: string): RoadmapShelfBook {
  return { book, cover: book.cover === null ? null : imageFromMedia(book.cover, mediaBaseUrl) };
}

function requestInit(options: LoadRoadmapBooksOptions) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return () => ({ cache: "no-store" as const, signal: AbortSignal.timeout(timeoutMs) });
}

/** A profile that does not exist yet is missing; any other failed read is unavailable. */
function failedPersonRead(response: Response): { readonly status: "missing" | "unavailable" } {
  return response.status === 404 ? { status: "missing" } : { status: "unavailable" };
}
