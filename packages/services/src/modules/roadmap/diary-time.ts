// Diary time arithmetic, private to the roadmap module: which Prague calendar day an instant
// belongs to, where a session is split at local midnight, and elapsed seconds. Everything works on
// absolute instants and asks Intl for the Prague offset, so the process time zone never matters.
import { diaryTimeZone } from "@sebela/contracts";

/** An interval between two absolute instants. */
export interface Interval {
  readonly startedAt: Date;
  readonly endedAt: Date;
}

/** One piece of a session within one diary day. */
export interface DiaryPiece extends Interval {
  readonly date: string;
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const wallClock = new Intl.DateTimeFormat("en-CA", {
  timeZone: diaryTimeZone,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** The Prague wall-clock reading of the instant, as if it were UTC, in milliseconds. */
function localTime(instant: number): number {
  const parts: Record<string, number> = {};
  for (const part of wallClock.formatToParts(instant)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  const field = (name: string) => parts[name] ?? 0;
  return Date.UTC(
    field("year"),
    field("month") - 1,
    field("day"),
    field("hour"),
    field("minute"),
    field("second"),
  );
}

/** How far Prague is ahead of UTC at the instant, in milliseconds. */
function offsetAt(instant: number): number {
  return localTime(instant - (instant % 1000)) - (instant - (instant % 1000));
}

/** The Prague calendar date of the instant, `YYYY-MM-DD`. */
export function diaryDateOf(instant: Date): string {
  return new Date(localTime(instant.getTime())).toISOString().slice(0, 10);
}

/**
 * The instant of Prague midnight that starts the date. Prague changes its offset at 02:00 or
 * 03:00, never around midnight, so the offset found from a first guess is the midnight's own.
 */
function midnightOf(date: string): number {
  const local = Date.parse(`${date}T00:00:00Z`);
  const guess = local - offsetAt(local);
  return local - offsetAt(guess);
}

/** The date after the `YYYY-MM-DD` date. */
function nextDate(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + DAY).toISOString().slice(0, 10);
}

/** The session split at each Prague midnight it crosses, in order; no time is lost or added. */
export function splitIntoDiaryDays(startedAt: Date, endedAt: Date): DiaryPiece[] {
  const pieces: DiaryPiece[] = [];
  let start = startedAt.getTime();
  const end = endedAt.getTime();
  while (start < end) {
    const date = diaryDateOf(new Date(start));
    const midnight = midnightOf(nextDate(date));
    const pieceEnd = Math.min(end, midnight);
    pieces.push({ date, startedAt: new Date(start), endedAt: new Date(pieceEnd) });
    start = pieceEnd;
  }
  return pieces;
}

/** The actual elapsed seconds of the interval. */
export function elapsedSeconds(interval: Interval): number {
  return (interval.endedAt.getTime() - interval.startedAt.getTime()) / 1000;
}

/** The sum of the intervals' elapsed seconds, before any display rounding. */
export function totalSeconds(intervals: readonly Interval[]): number {
  return intervals.reduce((sum, interval) => sum + elapsedSeconds(interval), 0);
}
