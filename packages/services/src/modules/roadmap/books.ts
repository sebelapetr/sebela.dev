// The bookshelf, private to the roadmap module: books with their cover, derived status, linking
// resource and the time logged on it.
import type {
  RoadmapBook,
  RoadmapBookCreate,
  RoadmapBookList,
  RoadmapBookUpdate,
} from "@sebela/contracts";
import type { RoadmapPersistence } from "@sebela/db";

import type { MediaAddress } from "../profile/index.js";

/**
 * The bookshelf. Reads derive each book's status from its dates (`completed` once it ended,
 * otherwise `reading` once it started, otherwise `to-read`) and its reading time from the time
 * entries of the resource that links it. Expected refusals are `DomainError`s: `not_found`,
 * `conflict` for a taken slug or a book a resource still links, and `validation_failed` naming
 * `coverId` (no such media, or not an image) or `endedOn` (before the start).
 */
export interface Bookshelf {
  /** Every book by ascending priority, then slug. */
  listBooks(): Promise<RoadmapBookList>;
  getBook(slug: string): Promise<RoadmapBook>;
  createBook(input: RoadmapBookCreate): Promise<RoadmapBook>;
  /** Changes only the given fields; `null` clears an optional one. */
  updateBook(slug: string, changes: RoadmapBookUpdate): Promise<RoadmapBook>;
  /** Removes the book and keeps its cover media; refused with `conflict` while a resource links it. */
  deleteBook(slug: string): Promise<void>;
}

const notImplemented = () => Promise.reject(new Error("Not implemented."));

export function createBookshelf(
  persistence: RoadmapPersistence,
  mediaAddress: MediaAddress,
): Bookshelf {
  return {
    // A stub until the bookshelf is implemented: it reads no book and addresses no cover.
    async listBooks() {
      const records = await persistence.listRoadmapBooks();
      return records.length > 0 && mediaAddress("") !== null ? notImplemented() : [];
    },
    getBook: notImplemented,
    createBook: notImplemented,
    updateBook: notImplemented,
    deleteBook: notImplemented,
  };
}
