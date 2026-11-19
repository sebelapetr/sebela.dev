// Bookshelf persistence, private to the roadmap module: books with their cover, the resource that
// links each of them and the time logged on that resource. The book never stores its resource;
// the resource's `book_id` is the one link.
import { asc, eq, inArray, sql, type SQL } from "drizzle-orm";

import type { Database } from "../../database.js";
import {
  checkMediaReferences,
  type Executor,
  media,
  mediaColumns,
  type MediaRecord,
  refusingMedia,
  WriteRefused,
} from "../profile/index.js";
import { breaksCheck } from "./database-errors.js";
import { areas, BOOK_PERIOD_CHECK, books, modules, resources, timeEntries } from "./schema.js";
import type {
  RoadmapBookRecord,
  RoadmapBookResourceRecord,
  RoadmapBookWriteFailure,
  RoadmapPersistence,
} from "./types.js";

type BookPersistence = Pick<
  RoadmapPersistence,
  "listRoadmapBooks" | "findRoadmapBook" | "createRoadmapBook" | "updateRoadmapBook"
>;

/** `clock_timestamp()`, not `now()`: it advances also within one transaction. */
const now = sql`clock_timestamp()`;

/**
 * The elapsed seconds of every time entry of the resource that links the book. Summed over the
 * entries alone, so topic links can never repeat an entry.
 */
// Drizzle leaves columns unqualified in a single-table select, so the correlated subqueries name
// their tables by alias and the outer row by its qualified table.
const readingSeconds = sql<number>`(
  SELECT coalesce(sum(extract(epoch FROM entry.ended_at - entry.started_at)), 0)
  FROM ${timeEntries} AS entry
  INNER JOIN ${resources} AS reader ON reader.id = entry.resource_id
  WHERE reader.book_id = ${books}.id
)`.mapWith(Number);

const bookColumns = {
  id: books.id,
  slug: books.slug,
  title: books.title,
  author: books.author,
  description: books.description,
  pages: books.pages,
  year: books.year,
  isbn: books.isbn,
  priority: books.priority,
  startedOn: books.startedOn,
  endedOn: books.endedOn,
  summary: books.summary,
  coverId: books.coverId,
  readingSeconds,
  createdAt: books.createdAt,
  updatedAt: books.updatedAt,
};

/** Books with their cover and linking resource, by priority, then slug. */
async function loadBooks(db: Executor, where: SQL | undefined): Promise<RoadmapBookRecord[]> {
  const rows = await db
    .select(bookColumns)
    .from(books)
    .where(where)
    .orderBy(asc(books.priority), asc(books.slug));
  if (rows.length === 0) return [];

  const coverIds = rows.flatMap((row) => (row.coverId === null ? [] : [row.coverId]));
  const covers = new Map<string, MediaRecord>();
  if (coverIds.length > 0) {
    const found = await db.select(mediaColumns).from(media).where(inArray(media.id, coverIds));
    for (const cover of found) covers.set(cover.id, cover);
  }

  const links = await db
    .select({
      bookId: resources.bookId,
      resource: {
        slug: resources.slug,
        name: resources.name,
        module: modules.slug,
        area: areas.slug,
      },
    })
    .from(resources)
    .innerJoin(modules, eq(resources.moduleId, modules.id))
    .innerJoin(areas, eq(modules.areaId, areas.id))
    .where(
      inArray(
        resources.bookId,
        rows.map((row) => row.id),
      ),
    );
  const linked = new Map<string, RoadmapBookResourceRecord>();
  for (const { bookId, resource } of links) if (bookId !== null) linked.set(bookId, resource);

  return rows.map((row) => ({
    ...row,
    cover: row.coverId === null ? null : (covers.get(row.coverId) ?? null),
    resource: linked.get(row.id) ?? null,
  }));
}

async function loadBook(db: Executor, id: string): Promise<RoadmapBookRecord> {
  const [row] = await loadBooks(db, eq(books.id, id));
  if (!row) throw new Error("The written roadmap book is missing.");
  return row;
}

/** Runs a book write; a media refusal or an end before the start becomes its failure. */
async function refusableBook<T>(write: () => Promise<T>): Promise<T | RoadmapBookWriteFailure> {
  try {
    return await refusingMedia(write);
  } catch (error) {
    if (breaksCheck(error, BOOK_PERIOD_CHECK)) return { ok: false, reason: "invalid_period" };
    throw error;
  }
}

/**
 * The id of the book with the slug, locked against a concurrent delete; `null` clears the link.
 * Refuses an unknown book by throwing `WriteRefused` inside the caller's transaction.
 */
export async function bookId(tx: Executor, slug: string | null): Promise<string | null> {
  if (slug === null) return null;
  const [row] = await tx
    .select({ id: books.id })
    .from(books)
    .where(eq(books.slug, slug))
    .for("key share");
  if (!row) throw new WriteRefused({ ok: false, reason: "unknown_book" });
  return row.id;
}

/**
 * The book's slug for a resource row, read in the same query as the resource; `null` when it
 * links none.
 */
export const linkedBookSlug = sql<string | null>`(
  SELECT linked.slug FROM ${books} AS linked WHERE linked.id = ${resources}.book_id
)`;

/** Every bookshelf operation over one connection or transaction. */
export function createBookPersistence(db: Database): BookPersistence {
  return {
    listRoadmapBooks() {
      return db.transaction((tx) => loadBooks(tx, undefined), {
        isolationLevel: "repeatable read",
        accessMode: "read only",
      });
    },
    async findRoadmapBook(slug) {
      const [row] = await loadBooks(db, eq(books.slug, slug));
      return row ?? null;
    },
    createRoadmapBook(fields) {
      return refusableBook(() =>
        db.transaction(async (tx) => {
          await checkMediaReferences(tx, [{ field: "coverId", id: fields.coverId, kind: "image" }]);
          const [row] = await tx
            .insert(books)
            .values(fields)
            .onConflictDoNothing({ target: books.slug })
            .returning({ id: books.id });
          if (!row) return { ok: false, reason: "conflict" } as const;
          return { ok: true, book: await loadBook(tx, row.id) } as const;
        }),
      );
    },
    updateRoadmapBook(slug, changes) {
      return refusableBook(() =>
        db.transaction(async (tx) => {
          const [current] = await tx
            .select({ id: books.id })
            .from(books)
            .where(eq(books.slug, slug))
            .for("update");
          if (!current) return { ok: false, reason: "not_found" } as const;
          await checkMediaReferences(tx, [
            { field: "coverId", id: changes.coverId, kind: "image" },
          ]);
          await tx
            .update(books)
            .set({ ...changes, updatedAt: now })
            .where(eq(books.id, current.id));
          return { ok: true, book: await loadBook(tx, current.id) } as const;
        }),
      );
    },
  };
}
