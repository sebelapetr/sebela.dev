import type { ApiClient, RoadmapBook } from "@sebela/api-client";

import type { ImageMedia } from "./image";

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

export function loadRoadmapBookshelf(
  client: ApiClient,
  options: LoadRoadmapBooksOptions,
): Promise<RoadmapBookshelfResult> {
  throw new Error("not implemented", { cause: { client, options } });
}

export function loadRoadmapBook(
  client: ApiClient,
  slug: string,
  options: LoadRoadmapBooksOptions,
): Promise<RoadmapBookResult> {
  throw new Error("not implemented", { cause: { client, slug, options } });
}
