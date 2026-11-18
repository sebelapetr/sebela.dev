// The learning diary's persistence, private to the roadmap module: diary days with their notes and
// the time entries logged in them. The overlap guarantee lives in the exclusion constraint of
// `time_entries`, so it holds for concurrent writes without a preflight read.
import { and, asc, desc, eq, inArray, isNotNull, sql, type SQL } from "drizzle-orm";

import type { Database } from "../../database.js";
import { type Executor, WriteRefused } from "../profile/index.js";
import { breaksExclusion } from "./database-errors.js";
import {
  areas,
  diaryEntries,
  modules,
  resources,
  TIME_ENTRY_OVERLAP_EXCLUSION,
  timeEntries,
} from "./schema.js";
import type {
  DiaryDayRecord,
  RoadmapPersistence,
  TimeEntryPiece,
  TimeEntryRecord,
  TimeEntryWriteFailure,
} from "./types.js";

type DiaryPersistence = Pick<
  RoadmapPersistence,
  | "loadDiary"
  | "findDiaryDay"
  | "writeDiaryNotes"
  | "clearDiaryNotes"
  | "findTimeEntry"
  | "createTimeEntries"
  | "replaceTimeEntry"
  | "deleteTimeEntry"
>;

/** `clock_timestamp()`, not `now()`: it advances also within one transaction. */
const now = sql`clock_timestamp()`;

const entryColumns = {
  id: timeEntries.id,
  date: timeEntries.diaryDate,
  resource: {
    slug: resources.slug,
    name: resources.name,
    type: resources.type,
    link: resources.link,
    module: modules.slug,
    area: areas.slug,
  },
  startedAt: timeEntries.startedAt,
  endedAt: timeEntries.endedAt,
};

/** Time entries with their resource, module and area, in start order. */
function loadEntries(db: Executor, where: SQL | undefined): Promise<TimeEntryRecord[]> {
  return db
    .select(entryColumns)
    .from(timeEntries)
    .innerJoin(resources, eq(timeEntries.resourceId, resources.id))
    .innerJoin(modules, eq(resources.moduleId, modules.id))
    .innerJoin(areas, eq(modules.areaId, areas.id))
    .where(where)
    .orderBy(asc(timeEntries.startedAt));
}

/** The days matching `where`, newest first, without the ones that have neither notes nor entries. */
async function loadDays(db: Executor, where: SQL | undefined): Promise<DiaryDayRecord[]> {
  const days = await db
    .select({ date: diaryEntries.date, notes: diaryEntries.notes })
    .from(diaryEntries)
    .where(where)
    .orderBy(desc(diaryEntries.date));
  if (days.length === 0) return [];
  const entries = await loadEntries(
    db,
    inArray(
      timeEntries.diaryDate,
      days.map((day) => day.date),
    ),
  );
  return days
    .map((day) => ({ ...day, entries: entries.filter((entry) => entry.date === day.date) }))
    .filter((day) => day.notes !== null || day.entries.length > 0);
}

/** The id of the resource with the slug, locked against a concurrent delete; refuses an unknown one. */
async function resourceId(tx: Executor, slug: string): Promise<string> {
  const [row] = await tx
    .select({ id: resources.id })
    .from(resources)
    .where(eq(resources.slug, slug))
    .for("key share");
  if (!row) {
    throw new WriteRefused<TimeEntryWriteFailure>({ ok: false, reason: "unknown_resource" });
  }
  return row.id;
}

/**
 * Stores the pieces on the resource, creating missing days first in date order, so concurrent
 * writes into the same new day neither fail nor deadlock. The first piece may keep a given id.
 */
async function insertPieces(
  tx: Executor,
  resource: string,
  pieces: TimeEntryPiece[],
  firstId?: string,
): Promise<TimeEntryRecord[]> {
  if (pieces.length === 0) throw new Error("A time-entry write needs at least one piece.");
  const id = await resourceId(tx, resource);
  const dates = [...new Set(pieces.map((piece) => piece.date))].sort();
  await tx
    .insert(diaryEntries)
    .values(dates.map((date) => ({ date })))
    .onConflictDoNothing({ target: diaryEntries.date });
  const rows = await tx
    .insert(timeEntries)
    .values(
      pieces.map((piece, index) => ({
        ...(index === 0 && firstId !== undefined ? { id: firstId } : {}),
        diaryDate: piece.date,
        resourceId: id,
        startedAt: piece.startedAt,
        endedAt: piece.endedAt,
      })),
    )
    .returning({ id: timeEntries.id });
  return loadEntries(
    tx,
    inArray(
      timeEntries.id,
      rows.map((row) => row.id),
    ),
  );
}

/** Runs a write; a refusal or an overlap rolls it back and becomes its failure. */
async function refusable<T, Failure>(write: () => Promise<T>): Promise<T | Failure> {
  try {
    return await write();
  } catch (error) {
    // Every refusal thrown by a diary write is a failure of that write.
    if (error instanceof WriteRefused) return error.failure as Failure;
    if (breaksExclusion(error, TIME_ENTRY_OVERLAP_EXCLUSION)) {
      return { ok: false, reason: "overlap" } as Failure;
    }
    throw error;
  }
}

/** The diary operations over one connection or transaction. */
export function createDiaryPersistence(db: Database): DiaryPersistence {
  return {
    loadDiary() {
      return db.transaction((tx) => loadDays(tx, undefined), {
        isolationLevel: "repeatable read",
        accessMode: "read only",
      });
    },
    findDiaryDay(date) {
      return db.transaction(
        async (tx) => (await loadDays(tx, eq(diaryEntries.date, date)))[0] ?? null,
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    },
    writeDiaryNotes(date, notes) {
      return db.transaction(async (tx) => {
        await tx
          .insert(diaryEntries)
          .values({ date, notes })
          .onConflictDoUpdate({ target: diaryEntries.date, set: { notes, updatedAt: now } });
        const [day] = await loadDays(tx, eq(diaryEntries.date, date));
        if (!day) throw new Error("The written diary day is missing.");
        return day;
      });
    },
    async clearDiaryNotes(date) {
      const rows = await db
        .update(diaryEntries)
        .set({ notes: null, updatedAt: now })
        .where(and(eq(diaryEntries.date, date), isNotNull(diaryEntries.notes)))
        .returning({ date: diaryEntries.date });
      return rows.length > 0 ? { ok: true } : { ok: false, reason: "not_found" };
    },

    async findTimeEntry(id) {
      const [entry] = await loadEntries(db, eq(timeEntries.id, id));
      return entry ?? null;
    },
    createTimeEntries(resource, pieces) {
      return refusable(() =>
        db.transaction(
          async (tx) => ({ ok: true, entries: await insertPieces(tx, resource, pieces) }) as const,
        ),
      );
    },
    replaceTimeEntry(id, plan) {
      return refusable(() =>
        db.transaction(async (tx) => {
          const [locked] = await tx
            .select({ id: timeEntries.id })
            .from(timeEntries)
            .where(eq(timeEntries.id, id))
            .for("update");
          const [current] = locked ? await loadEntries(tx, eq(timeEntries.id, id)) : [];
          if (!current) return { ok: false, reason: "not_found" } as const;
          const replacement = plan(current);
          if ("ok" in replacement) return replacement;
          await tx.delete(timeEntries).where(eq(timeEntries.id, id));
          const entries = await insertPieces(tx, replacement.resource, replacement.pieces, id);
          return { ok: true, entries, previousDate: current.date } as const;
        }),
      );
    },
    async deleteTimeEntry(id) {
      const [row] = await db
        .delete(timeEntries)
        .where(eq(timeEntries.id, id))
        .returning({ date: timeEntries.diaryDate });
      return row ? { ok: true, date: row.date } : { ok: false, reason: "not_found" };
    },
  };
}
