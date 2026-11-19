import type { RoadmapEvent, RoadmapEventList } from "@sebela/api-client";

import { roadmapRoutes } from "../../_shared";
import { diaryDayHref, formatStudyTime } from "./diary";
import { eventKindLabel, formatEventPeriod } from "./event-format";
import { safeLink } from "./overview";

/** One event as the events page shows it. */
export interface EventRow {
  readonly slug: string;
  readonly name: string;
  /** Its kind in words, for example `Conference`. */
  readonly kindLabel: string;
  /** Its date range in words, for example `February 26–28, 2025`. */
  readonly period: string;
  /** Its first and last calendar day, for `<time dateTime>`. */
  readonly startsOn: string;
  readonly endsOn: string;
  /** Organizer, place and `Online` where known, joined by ` · `, or null when none is. */
  readonly details: string | null;
  /** A safe absolute `http(s)` address, or null. */
  readonly href: string | null;
  /** Its Markdown takeaways, or null. */
  readonly takeaways: string | null;
  /** Its topics' names, in their order. */
  readonly topics: readonly string[];
  /** The time logged at it for display, or null when none is. */
  readonly attendance: string | null;
  /** The diary's page of its first day. */
  readonly diaryHref: string;
}

/** The events that start in one year. */
export interface EventYear {
  readonly year: string;
  readonly events: readonly EventRow[];
}

/** The events page: its events by the year they start in, newest first. */
export interface EventsPage {
  readonly years: readonly EventYear[];
}

/** The events section's own address. */
export const EVENTS_PATH = roadmapRoutes.events;

/** The events section's name, as its page and title name it. */
export const EVENTS_NAME = "Events";

/**
 * The events page as it shows the API's events: grouped by the year each starts in, in the API's
 * order (newest first), each with its kind and period in words, what is known of its organizer,
 * place and whether it was online, a link only when it is safe, its Markdown takeaways, its topics,
 * the time logged at it (none when nothing is) and the diary's page of its first day.
 */
export function toEventsPage(events: RoadmapEventList): EventsPage {
  const years: { year: string; events: EventRow[] }[] = [];
  for (const event of events) {
    const year = event.startsOn.slice(0, 4);
    const last = years.at(-1);
    if (last?.year === year) last.events.push(toRow(event));
    else years.push({ year, events: [toRow(event)] });
  }
  return { years };
}

function toRow(event: RoadmapEvent): EventRow {
  const details = [event.organizer, event.place, event.online ? "Online" : null].filter(
    (part): part is string => part !== null && part !== "",
  );
  return {
    slug: event.slug,
    name: event.name,
    kindLabel: eventKindLabel(event.kind),
    period: formatEventPeriod(event.startsOn, event.endsOn),
    startsOn: event.startsOn,
    endsOn: event.endsOn,
    details: details.length === 0 ? null : details.join(" · "),
    href: safeLink(event.link),
    takeaways: event.takeaways,
    topics: event.topics.map((topic) => topic.name),
    attendance: event.attendanceSeconds > 0 ? formatStudyTime(event.attendanceSeconds) : null,
    diaryHref: diaryDayHref(event.startsOn),
  };
}
