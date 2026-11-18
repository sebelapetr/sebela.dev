// Attended events, private to the roadmap module: events with their shared topics and the
// attendance time logged on them. An event is not a resource; its days show in the diary without
// adding time.
import type {
  RoadmapEvent,
  RoadmapEventCreate,
  RoadmapEventList,
  RoadmapEventUpdate,
} from "@sebela/contracts";
import type {
  RoadmapEventFields,
  RoadmapEventRecord,
  RoadmapEventRelations,
  RoadmapEventWriteFailure,
  RoadmapPersistence,
} from "@sebela/db";

import { DomainError } from "../../errors.js";

/**
 * The attended events. Reads derive each event's attendance time from the time entries logged on
 * it; its date range alone adds nothing. Expected refusals are `DomainError`s: `not_found`,
 * `conflict` for a taken slug, a date edit that would leave attendance outside the event (naming
 * those days) or deleting an event with attendance, and `validation_failed` naming `topics` (an
 * unknown or repeated topic) or `endsOn` (before the start).
 */
export interface EventCalendar {
  /** Every event, newest start first, then latest end, then slug. */
  listEvents(): Promise<RoadmapEventList>;
  getEvent(slug: string): Promise<RoadmapEvent>;
  createEvent(input: RoadmapEventCreate): Promise<RoadmapEvent>;
  /**
   * Changes only the given fields; `null` clears an optional one and given `topics` replace all.
   * A refused write changes nothing.
   */
  updateEvent(slug: string, changes: RoadmapEventUpdate): Promise<RoadmapEvent>;
  /** Removes the event; refused with `conflict` while attendance is logged on it. */
  deleteEvent(slug: string): Promise<void>;
}

const missing = (slug: string) => new DomainError("not_found", `There is no event "${slug}".`);

const invalid = (path: string, message: string) =>
  new DomainError("validation_failed", message, [{ path, message }]);

/** Why an event write was refused, as a `validation_failed` naming the field. */
function eventRefusal(failure: RoadmapEventWriteFailure): DomainError {
  switch (failure.reason) {
    case "unknown_topics":
      return invalid("topics", `There is no topic ${failure.slugs.join(", ")}; create it first.`);
    case "repeated_topics":
      return invalid("topics", "List each topic once.");
    case "invalid_period":
      return invalid("endsOn", "The end cannot be before the start.");
  }
}

function toEvent(record: RoadmapEventRecord): RoadmapEvent {
  return {
    id: record.id,
    slug: record.slug,
    name: record.name,
    kind: record.kind,
    organizer: record.organizer,
    startsOn: record.startsOn,
    endsOn: record.endsOn,
    place: record.place,
    online: record.online,
    link: record.link,
    takeaways: record.takeaways,
    topics: record.topics.map((topic) => ({
      ...topic,
      createdAt: topic.createdAt.toISOString(),
      updatedAt: topic.updatedAt.toISOString(),
    })),
    attendanceSeconds: record.attendanceSeconds,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

/**
 * The event operations over the roadmap persistence. The database decides slug uniqueness, topic
 * references, the ordered period and whether attendance would be stranded, while the event is
 * locked, so a racing write is judged on the row that results.
 */
export function createEventCalendar(persistence: RoadmapPersistence): EventCalendar {
  return {
    async listEvents() {
      return (await persistence.listRoadmapEvents()).map(toEvent);
    },
    async getEvent(slug) {
      const record = await persistence.findRoadmapEvent(slug);
      if (!record) throw missing(slug);
      return toEvent(record);
    },
    async createEvent(input) {
      const result = await persistence.createRoadmapEvent(input);
      if (result.ok) return toEvent(result.event);
      if (result.reason === "conflict") {
        throw new DomainError("conflict", `An event with the slug "${input.slug}" already exists.`);
      }
      throw eventRefusal(result);
    },
    async updateEvent(slug, changes) {
      const defined = Object.fromEntries(
        Object.entries(changes).filter(([, value]) => value !== undefined),
      ) as Partial<RoadmapEventFields & RoadmapEventRelations>;
      const result = await persistence.updateRoadmapEvent(slug, defined);
      if (result.ok) return toEvent(result.event);
      switch (result.reason) {
        case "not_found":
          throw missing(slug);
        case "strands_attendance":
          throw new DomainError(
            "conflict",
            `Attendance is logged on ${result.dates.join(", ")}, outside the new dates of the ` +
              `event "${slug}"; move or delete that time first.`,
          );
        default:
          throw eventRefusal(result);
      }
    },
    async deleteEvent(slug) {
      const result = await persistence.deleteRoadmapEvent(slug);
      if (result.ok) return;
      if (result.reason === "not_found") throw missing(slug);
      throw new DomainError(
        "conflict",
        `Attendance is logged on the event "${slug}"; move or delete that time first.`,
      );
    },
  };
}
