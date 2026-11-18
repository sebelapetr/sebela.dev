// Attended-event persistence, private to the roadmap module: events with their ordered topic links
// and the attendance time logged on them. A date edit is judged against the event's attendance
// while the event is locked, so it can never leave a time entry outside the event's days.
import { and, asc, desc, eq, gt, inArray, lt, or, sql, type SQL } from "drizzle-orm";

import type { Database } from "../../database.js";
import {
  type Executor,
  topicColumns,
  topicIds,
  topics,
  type TopicRecord,
  WriteRefused,
} from "../profile/index.js";
import { breaksCheck } from "./database-errors.js";
import { EVENT_PERIOD_CHECK, events, eventTopics, timeEntries } from "./schema.js";
import type {
  RoadmapEventFields,
  RoadmapEventRecord,
  RoadmapEventRelations,
  RoadmapEventWriteFailure,
  RoadmapPersistence,
  UpdateRoadmapEventResult,
} from "./types.js";

type EventPersistence = Pick<
  RoadmapPersistence,
  "listRoadmapEvents" | "findRoadmapEvent" | "createRoadmapEvent" | "updateRoadmapEvent"
>;

type StrandedAttendance = Extract<UpdateRoadmapEventResult, { reason: "strands_attendance" }>;

/** `clock_timestamp()`, not `now()`: it advances also within one transaction. */
const now = sql`clock_timestamp()`;

/**
 * The elapsed seconds of the event's time entries, summed over the entries alone so that topic
 * links can never repeat one. The date range itself contributes nothing.
 */
// Drizzle leaves columns unqualified in a single-table select, so the correlated subquery names its
// table by alias and the outer row by its qualified table.
const attendanceSeconds = sql<number>`(
  SELECT coalesce(sum(extract(epoch FROM entry.ended_at - entry.started_at)), 0)
  FROM ${timeEntries} AS entry
  WHERE entry.event_id = ${events}.id
)`.mapWith(Number);

const eventColumns = {
  id: events.id,
  slug: events.slug,
  name: events.name,
  kind: events.kind,
  organizer: events.organizer,
  startsOn: events.startsOn,
  endsOn: events.endsOn,
  place: events.place,
  online: events.online,
  link: events.link,
  takeaways: events.takeaways,
  attendanceSeconds,
  createdAt: events.createdAt,
  updatedAt: events.updatedAt,
};

/** Events with their topics in link order: newest start first, then latest end, then slug. */
async function loadEvents(db: Executor, where: SQL | undefined): Promise<RoadmapEventRecord[]> {
  const rows = await db
    .select(eventColumns)
    .from(events)
    .where(where)
    .orderBy(desc(events.startsOn), desc(events.endsOn), asc(events.slug));
  if (rows.length === 0) return [];

  const links = await db
    .select({ eventId: eventTopics.eventId, topic: topicColumns })
    .from(eventTopics)
    .innerJoin(topics, eq(eventTopics.topicId, topics.id))
    .where(
      inArray(
        eventTopics.eventId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(asc(eventTopics.eventId), asc(eventTopics.position));
  return rows.map((row) => ({
    ...row,
    topics: links.filter((link) => link.eventId === row.id).map((link): TopicRecord => link.topic),
  }));
}

async function loadEvent(db: Executor, id: string): Promise<RoadmapEventRecord> {
  const [row] = await loadEvents(db, eq(events.id, id));
  if (!row) throw new Error("The written roadmap event is missing.");
  return row;
}

/** Replaces the topic links of the event with the given slugs in their order. */
async function linkTopics(tx: Executor, eventId: string, slugs: string[]) {
  const ids = await topicIds(tx, slugs);
  await tx.delete(eventTopics).where(eq(eventTopics.eventId, eventId));
  if (ids.length === 0) return;
  await tx
    .insert(eventTopics)
    .values(ids.map((topicId, position) => ({ eventId, topicId, position })));
}

/**
 * Refuses the event's new dates while any of its time entries falls outside them, listing those
 * diary days ascending. Runs after the update inside its transaction, so a refusal rolls it back.
 */
async function refuseStrandedAttendance(tx: Executor, eventId: string) {
  const [event] = await tx
    .select({ startsOn: events.startsOn, endsOn: events.endsOn })
    .from(events)
    .where(eq(events.id, eventId));
  if (!event) throw new Error("The updated roadmap event is missing.");
  const stranded = await tx
    .select({ date: timeEntries.diaryDate })
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.eventId, eventId),
        or(lt(timeEntries.diaryDate, event.startsOn), gt(timeEntries.diaryDate, event.endsOn)),
      ),
    )
    .groupBy(timeEntries.diaryDate)
    .orderBy(asc(timeEntries.diaryDate));
  if (stranded.length > 0) {
    throw new WriteRefused<StrandedAttendance>({
      ok: false,
      reason: "strands_attendance",
      dates: stranded.map((row) => row.date),
    });
  }
}

/** Runs an event write; a refusal or a reversed period rolls it back and becomes its failure. */
async function refusableEvent<T, Failure = RoadmapEventWriteFailure>(
  write: () => Promise<T>,
): Promise<T | Failure> {
  try {
    return await write();
  } catch (error) {
    // Every refusal thrown by an event write is a failure of that write.
    if (error instanceof WriteRefused) return error.failure as Failure;
    if (breaksCheck(error, EVENT_PERIOD_CHECK)) {
      return { ok: false, reason: "invalid_period" } as Failure;
    }
    throw error;
  }
}

/** Event field changes without the topics, which are written separately. */
function eventScalars(
  changes: Partial<RoadmapEventFields & RoadmapEventRelations>,
): Partial<RoadmapEventFields> {
  const fields: Partial<RoadmapEventFields & RoadmapEventRelations> = { ...changes };
  delete fields.topics;
  return fields;
}

/** Every event operation but deletion over one connection or transaction. */
export function createEventPersistence(db: Database): EventPersistence {
  return {
    listRoadmapEvents() {
      return db.transaction((tx) => loadEvents(tx, undefined), {
        isolationLevel: "repeatable read",
        accessMode: "read only",
      });
    },
    findRoadmapEvent(slug) {
      return db.transaction(
        async (tx) => (await loadEvents(tx, eq(events.slug, slug)))[0] ?? null,
        {
          isolationLevel: "repeatable read",
          accessMode: "read only",
        },
      );
    },
    createRoadmapEvent({ topics: topicSlugs, ...fields }) {
      return refusableEvent(() =>
        db.transaction(async (tx) => {
          const [row] = await tx
            .insert(events)
            .values(fields)
            .onConflictDoNothing({ target: events.slug })
            .returning({ id: events.id });
          if (!row) return { ok: false, reason: "conflict" } as const;
          await linkTopics(tx, row.id, topicSlugs);
          return { ok: true, event: await loadEvent(tx, row.id) } as const;
        }),
      );
    },
    updateRoadmapEvent(slug, changes) {
      return refusableEvent<UpdateRoadmapEventResult, UpdateRoadmapEventResult>(() =>
        db.transaction(async (tx) => {
          // The lock waits for attendance being logged on the event and holds new attendance
          // back until the new dates are committed.
          const [current] = await tx
            .select({ id: events.id })
            .from(events)
            .where(eq(events.slug, slug))
            .for("update");
          if (!current) return { ok: false, reason: "not_found" } as const;
          await tx
            .update(events)
            .set({ ...eventScalars(changes), updatedAt: now })
            .where(eq(events.id, current.id));
          if (changes.startsOn !== undefined || changes.endsOn !== undefined) {
            await refuseStrandedAttendance(tx, current.id);
          }
          if (changes.topics !== undefined) await linkTopics(tx, current.id, changes.topics);
          return { ok: true, event: await loadEvent(tx, current.id) } as const;
        }),
      );
    },
  };
}
