import type { RoadmapEventKind } from "@sebela/api-client";

// Formatting shared by the events page and the diary's event days. Event dates are calendar days
// (`YYYY-MM-DD`, Prague's), formatted as the days themselves so no time zone can move them.

const KIND_LABELS: Readonly<Record<RoadmapEventKind, string>> = {
  conference: "Conference",
  meetup: "Meetup",
  workshop: "Workshop",
  lecture: "Lecture",
};

/** An event's kind as the pages name it, for example `Conference`. */
export function eventKindLabel(kind: RoadmapEventKind): string {
  return KIND_LABELS[kind];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** A calendar day as its UTC midnight, or null when it is not one. */
function calendarDay(date: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match === null) return null;
  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

const FULL = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  year: "numeric",
  month: "long",
  day: "numeric",
});
const MONTH_DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "long",
  day: "numeric",
});

/**
 * An event's date range in words: `March 3, 2025` for one day, `February 26–28, 2025` within a
 * month, `February 26 – March 1, 2025` within a year and `December 30, 2024 – January 2, 2025`
 * across years. A date that is not a calendar day is kept as it is.
 */
export function formatEventPeriod(startsOn: string, endsOn: string): string {
  const start = calendarDay(startsOn);
  const end = calendarDay(endsOn);
  if (start === null || end === null) {
    return startsOn === endsOn ? startsOn : `${startsOn} – ${endsOn}`;
  }
  if (startsOn === endsOn) return FULL.format(start);
  if (start.getUTCFullYear() !== end.getUTCFullYear()) {
    return `${FULL.format(start)} – ${FULL.format(end)}`;
  }
  if (start.getUTCMonth() !== end.getUTCMonth()) {
    return `${MONTH_DAY.format(start)} – ${FULL.format(end)}`;
  }
  return `${MONTH_DAY.format(start)}–${String(end.getUTCDate())}, ${String(end.getUTCFullYear())}`;
}

/**
 * Which day of an event of several days `date` is, for example `Day 2 of 3`; null on an event of
 * one day or a date outside the event.
 */
export function eventDayOf(date: string, startsOn: string, endsOn: string): string | null {
  const day = calendarDay(date);
  const start = calendarDay(startsOn);
  const end = calendarDay(endsOn);
  if (day === null || start === null || end === null) return null;
  // UTC midnights are whole days apart; no summer time can stretch or shrink one.
  const count = Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;
  const index = Math.round((day.getTime() - start.getTime()) / DAY_MS) + 1;
  if (count < 2 || index < 1 || index > count) return null;
  return `Day ${String(index)} of ${String(count)}`;
}
