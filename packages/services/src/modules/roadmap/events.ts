// Attended events, private to the roadmap module: events with their shared topics and the
// attendance time logged on them. An event is not a resource; its days show in the diary without
// adding time.
import type {
  RoadmapEvent,
  RoadmapEventCreate,
  RoadmapEventList,
  RoadmapEventUpdate,
} from "@sebela/contracts";

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
  /** Changes only the given fields; `null` clears an optional one and given `topics` replace all. */
  updateEvent(slug: string, changes: RoadmapEventUpdate): Promise<RoadmapEvent>;
  /** Removes the event; refused with `conflict` while attendance is logged on it. */
  deleteEvent(slug: string): Promise<void>;
}

/** The event operations over the roadmap persistence. */
export function createEventCalendar(): EventCalendar {
  const pending = () => Promise.reject(new Error("Not implemented yet."));
  return {
    listEvents: pending,
    getEvent: pending,
    createEvent: pending,
    updateEvent: pending,
    deleteEvent: pending,
  };
}
