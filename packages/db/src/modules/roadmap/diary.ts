// The learning diary's persistence, private to the roadmap module: diary days with their notes, the
// time entries logged in them and the events covering them. The overlap guarantee lives in the exclusion constraint of
// `time_entries`, so it holds for concurrent writes without a preflight read.
import { and, asc, eq, gte, inArray, isNotNull, lte, sql, type SQL } from "drizzle-orm";

import type { Database } from "../../database.js";
import { type Executor, WriteRefused } from "../profile/index.js";
import { breaksExclusion } from "./database-errors.js";
import {
  areas,
  diaryEntries,
  events,
  modules,
  resources,
  TIME_ENTRY_OVERLAP_EXCLUSION,
  timeEntries,
} from "./schema.js";
import type {
  DiaryDayRecord,
  DiaryEventRecord,
  DiaryResourceRecord,
  RoadmapPersistence,
  SessionNotes,
  TimeEntryPiece,
  TimeEntryRecord,
  TimeEntryTarget,
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
  resourceSlug: resources.slug,
  resourceName: resources.name,
  resourceType: resources.type,
  resourceLink: resources.link,
  module: modules.slug,
  area: areas.slug,
  eventSlug: events.slug,
  eventName: events.name,
  eventKind: events.kind,
  eventStartsOn: events.startsOn,
  eventEndsOn: events.endsOn,
  eventLink: events.link,
  startedAt: timeEntries.startedAt,
  endedAt: timeEntries.endedAt,
};

const diaryEventColumns = {
  slug: events.slug,
  name: events.name,
  kind: events.kind,
  startsOn: events.startsOn,
  endsOn: events.endsOn,
  link: events.link,
};

/**
 * Time entries with their resource, module and area or with their event, in start order. The
 * targets are built here because Drizzle does not turn a nested object of left-joined columns
 * from several tables into `null`.
 */
async function loadEntries(db: Executor, where: SQL | undefined): Promise<TimeEntryRecord[]> {
  const rows = await db
    .select(entryColumns)
    .from(timeEntries)
    .leftJoin(resources, eq(timeEntries.resourceId, resources.id))
    .leftJoin(modules, eq(resources.moduleId, modules.id))
    .leftJoin(areas, eq(modules.areaId, areas.id))
    .leftJoin(events, eq(timeEntries.eventId, events.id))
    .where(where)
    .orderBy(asc(timeEntries.startedAt));
  return rows.map((row): TimeEntryRecord => {
    const resource: DiaryResourceRecord | null =
      row.resourceSlug === null
        ? null
        : {
            slug: row.resourceSlug,
            name: row.resourceName ?? "",
            type: row.resourceType ?? "link",
            link: row.resourceLink,
            module: row.module ?? "",
            area: row.area ?? "",
          };
    const event: DiaryEventRecord | null =
      row.eventSlug === null
        ? null
        : {
            slug: row.eventSlug,
            name: row.eventName ?? "",
            kind: row.eventKind ?? "conference",
            startsOn: row.eventStartsOn ?? "",
            endsOn: row.eventEndsOn ?? "",
            link: row.eventLink,
          };
    return {
      id: row.id,
      date: row.date,
      resource,
      event,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
    };
  });
}

/** The calendar day after a `YYYY-MM-DD` date. */
function nextDate(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}

/**
 * The diary days, newest first: every day with notes or time entries and every day an event
 * covers, or only `date` when given. Event days are derived from the event dates, never stored.
 */
async function loadDays(db: Executor, date?: string): Promise<DiaryDayRecord[]> {
  const stored = await db
    .select({ date: diaryEntries.date, notes: diaryEntries.notes })
    .from(diaryEntries)
    .where(date === undefined ? undefined : eq(diaryEntries.date, date));
  const covering = await db
    .select(diaryEventColumns)
    .from(events)
    .where(
      date === undefined ? undefined : and(lte(events.startsOn, date), gte(events.endsOn, date)),
    )
    .orderBy(asc(events.startsOn), asc(events.slug));

  const days = new Map<string, DiaryDayRecord>();
  const day = (on: string) => {
    let found = days.get(on);
    if (!found) {
      found = { date: on, notes: null, entries: [], events: [] };
      days.set(on, found);
    }
    return found;
  };
  for (const row of stored) day(row.date).notes = row.notes;
  for (const event of covering) {
    if (date !== undefined) {
      day(date).events.push(event);
      continue;
    }
    for (let on = event.startsOn; on <= event.endsOn; on = nextDate(on)) day(on).events.push(event);
  }
  if (stored.length > 0) {
    const entries = await loadEntries(
      db,
      inArray(
        timeEntries.diaryDate,
        stored.map((row) => row.date),
      ),
    );
    for (const entry of entries) day(entry.date).entries.push(entry);
  }
  return [...days.values()]
    .filter((found) => found.notes !== null || found.entries.length > 0 || found.events.length > 0)
    .sort((left, right) => (left.date < right.date ? 1 : -1));
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
 * The id of the event with the slug, locked against a concurrent delete or date edit; refuses an
 * unknown event and a piece on a day outside its dates.
 */
async function eventId(tx: Executor, slug: string, pieces: TimeEntryPiece[]): Promise<string> {
  const [row] = await tx
    .select({ id: events.id, startsOn: events.startsOn, endsOn: events.endsOn })
    .from(events)
    .where(eq(events.slug, slug))
    .for("share");
  if (!row) throw new WriteRefused<TimeEntryWriteFailure>({ ok: false, reason: "unknown_event" });
  if (pieces.some((piece) => piece.date < row.startsOn || piece.date > row.endsOn)) {
    throw new WriteRefused<TimeEntryWriteFailure>({
      ok: false,
      reason: "outside_event",
      startsOn: row.startsOn,
      endsOn: row.endsOn,
    });
  }
  return row.id;
}

/**
 * Stores the pieces on the resource or event, creating missing days first in date order, so
 * concurrent writes into the same new day neither fail nor deadlock. The first piece may keep a
 * given id.
 */
async function insertPieces(
  tx: Executor,
  target: TimeEntryTarget,
  pieces: TimeEntryPiece[],
  firstId?: string,
): Promise<TimeEntryRecord[]> {
  if (pieces.length === 0) throw new Error("A time-entry write needs at least one piece.");
  const owner =
    "resource" in target
      ? { resourceId: await resourceId(tx, target.resource) }
      : { eventId: await eventId(tx, target.event, pieces) };
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
        ...owner,
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

/**
 * Appends text to a diary day's notes after a blank line, or starts them. One statement over the
 * row, so concurrent appends to the same day serialize on its lock and both stay.
 */
async function appendNotes(tx: Executor, notes: SessionNotes): Promise<void> {
  const rows = await tx
    .update(diaryEntries)
    .set({
      notes: sql`case when ${diaryEntries.notes} is null then ${notes.text} else ${diaryEntries.notes} || ${"\n\n"} || ${notes.text} end`,
      updatedAt: now,
    })
    .where(eq(diaryEntries.date, notes.date))
    .returning({ date: diaryEntries.date });
  if (rows.length === 0) throw new Error("The diary day of the session notes is missing.");
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
      return db.transaction((tx) => loadDays(tx), {
        isolationLevel: "repeatable read",
        accessMode: "read only",
      });
    },
    findDiaryDay(date) {
      return db.transaction(async (tx) => (await loadDays(tx, date))[0] ?? null, {
        isolationLevel: "repeatable read",
        accessMode: "read only",
      });
    },
    writeDiaryNotes(date, notes) {
      return db.transaction(async (tx) => {
        await tx
          .insert(diaryEntries)
          .values({ date, notes })
          .onConflictDoUpdate({ target: diaryEntries.date, set: { notes, updatedAt: now } });
        const [day] = await loadDays(tx, date);
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
    createTimeEntries(target, pieces, notes) {
      return refusable(() =>
        db.transaction(async (tx) => {
          const entries = await insertPieces(tx, target, pieces);
          if (notes !== undefined) await appendNotes(tx, notes);
          return { ok: true, entries } as const;
        }),
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
          const entries = await insertPieces(tx, replacement.target, replacement.pieces, id);
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
