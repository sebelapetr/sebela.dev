// The bookshelf, private to the roadmap module: books with their cover, derived status, linking
// resource and the time logged on it.
import type {
  Media,
  RoadmapBook,
  RoadmapBookCreate,
  RoadmapBookList,
  RoadmapBookStatus,
  RoadmapBookUpdate,
} from "@sebela/contracts";
import type {
  MediaRecord,
  RoadmapBookFields,
  RoadmapBookRecord,
  RoadmapBookWriteFailure,
  RoadmapPersistence,
} from "@sebela/db";

import { DomainError } from "../../errors.js";
import { mediaRefused, type MediaAddress } from "../profile/index.js";

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

const missing = (slug: string) =>
  new DomainError("not_found", `There is no book "${slug}" on the bookshelf.`);

/** Why a book write was refused, as a `validation_failed` naming the field. */
function bookRefusal(failure: RoadmapBookWriteFailure): DomainError {
  if (failure.reason === "invalid_period") {
    const message = "The end cannot be before the start.";
    return new DomainError("validation_failed", message, [{ path: "endedOn", message }]);
  }
  return mediaRefused(failure);
}

/** The status the dates imply: the end decides before the start. */
function bookStatus(record: RoadmapBookRecord): RoadmapBookStatus {
  if (record.endedOn !== null) return "completed";
  if (record.startedOn !== null) return "reading";
  return "to-read";
}

function toCover(record: MediaRecord, address: MediaAddress): Media {
  return {
    id: record.id,
    key: record.key,
    mediaType: record.mediaType,
    byteSize: record.byteSize,
    width: record.width,
    height: record.height,
    altText: record.altText,
    url: address(record.key),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function toBook(record: RoadmapBookRecord, address: MediaAddress): RoadmapBook {
  return {
    id: record.id,
    slug: record.slug,
    title: record.title,
    author: record.author,
    description: record.description,
    pages: record.pages,
    year: record.year,
    isbn: record.isbn,
    priority: record.priority,
    startedOn: record.startedOn,
    endedOn: record.endedOn,
    summary: record.summary,
    coverId: record.coverId,
    cover: record.cover === null ? null : toCover(record.cover, address),
    status: bookStatus(record),
    resource: record.resource === null ? null : { ...record.resource },
    readingSeconds: record.readingSeconds,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

/**
 * The bookshelf over its persistence; covers are addressed with `mediaAddress`. The database
 * decides slug uniqueness, cover references, the ordered period and links, so a racing write is
 * judged on the row that results.
 */
export function createBookshelf(
  persistence: RoadmapPersistence,
  mediaAddress: MediaAddress,
): Bookshelf {
  return {
    async listBooks() {
      const records = await persistence.listRoadmapBooks();
      return records.map((record) => toBook(record, mediaAddress));
    },
    async getBook(slug) {
      const record = await persistence.findRoadmapBook(slug);
      if (!record) throw missing(slug);
      return toBook(record, mediaAddress);
    },
    async createBook(input) {
      const result = await persistence.createRoadmapBook(input);
      if (result.ok) return toBook(result.book, mediaAddress);
      if (result.reason === "conflict") {
        throw new DomainError("conflict", `A book with the slug "${input.slug}" already exists.`);
      }
      throw bookRefusal(result);
    },
    async updateBook(slug, changes) {
      const defined = Object.fromEntries(
        Object.entries(changes).filter(([, value]) => value !== undefined),
      ) as Partial<RoadmapBookFields>;
      const result = await persistence.updateRoadmapBook(slug, defined);
      if (result.ok) return toBook(result.book, mediaAddress);
      if (result.reason === "not_found") throw missing(slug);
      throw bookRefusal(result);
    },
    async deleteBook(slug) {
      const result = await persistence.deleteRoadmapBook(slug);
      if (result.ok) return;
      if (result.reason === "not_found") throw missing(slug);
      throw new DomainError(
        "conflict",
        `A resource still reads the book "${slug}"; clear its book link first.`,
      );
    },
  };
}
