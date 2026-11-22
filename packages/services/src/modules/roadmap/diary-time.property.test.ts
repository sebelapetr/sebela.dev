import fc from "fast-check";
import { describe, it } from "vitest";

import { elapsedSeconds, splitIntoDiaryDays, totalSeconds } from "./diary-time.js";

/** Fixed, so a run is as long on every machine; a failure prints the seed that reproduces it. */
const numRuns = 300;

const SECOND = 1000;
const HOUR = 3600 * SECOND;
const DAY = 24 * HOUR;

/**
 * The properties' own reading of the Prague calendar date, independent of the module's
 * `diaryDateOf`, so a module that read dates in another time zone fails them.
 */
const pragueCalendar = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Prague",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The Prague calendar date of the instant, `YYYY-MM-DD`. */
function pragueDateOf(instant: number): string {
  const parts = pragueCalendar.formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/**
 * The Prague midnight that starts the instant's Prague date. Prague is one or two hours ahead
 * of UTC and never changes its offset at midnight, so exactly one of the two candidates is the
 * first second of that date.
 */
function pragueMidnightOf(instant: number): number {
  const date = pragueDateOf(instant);
  const midnight = ["+01:00", "+02:00"]
    .map((offset) => Date.parse(`${date}T00:00:00${offset}`))
    .find(
      (candidate) => pragueDateOf(candidate) === date && pragueDateOf(candidate - SECOND) !== date,
    );
  if (midnight === undefined) throw new Error(`no Prague midnight found for ${date}`);
  return midnight;
}

/** The instant of the last Sunday of the month at 01:00 UTC, when Prague changes its offset. */
function lastSundayAtOne(year: number, month: number): number {
  const lastDay = new Date(Date.UTC(year, month + 1, 0));
  return Date.UTC(year, month, lastDay.getUTCDate() - lastDay.getUTCDay(), 1);
}

/**
 * Whole seconds, as the diary refuses a fraction of a second before it splits a session; to the
 * millisecond, the seconds of the pieces would not always sum exactly in floating point.
 */
function wholeSeconds(min: number, max: number) {
  return fc.integer({ min: min / SECOND, max: max / SECOND }).map((seconds) => seconds * SECOND);
}

/** Any instant from 2000 to 2100. */
const anyInstant = wholeSeconds(Date.UTC(2000, 0, 1), Date.UTC(2100, 0, 1));

/** An instant within two days of a change between winter and summer time, either way. */
const nearOffsetChange = fc
  .record({
    year: fc.integer({ min: 2000, max: 2099 }),
    month: fc.constantFrom(2, 9),
    shift: wholeSeconds(-2 * DAY, 2 * DAY),
  })
  .map(({ year, month, shift }) => lastSundayAtOne(year, month) + shift);

/** An instant within two hours of a Prague midnight, on either side, in winter and in summer. */
const nearMidnight = anyInstant.chain((instant) => {
  const midnight = pragueMidnightOf(instant);
  return wholeSeconds(midnight - 2 * HOUR, midnight + 2 * HOUR);
});

/** A session: a start, then a length of nothing up to ten days, short ones drawn often. */
const anySession = fc
  .record({
    start: fc.oneof(anyInstant, nearOffsetChange, nearMidnight),
    length: fc.oneof(
      fc.constant(0),
      wholeSeconds(SECOND, 3 * HOUR),
      wholeSeconds(SECOND, 10 * DAY),
    ),
  })
  .map(({ start, length }) => ({ startedAt: new Date(start), endedAt: new Date(start + length) }));

/** The `YYYY-MM-DD` date after the date. */
function nextDate(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + DAY).toISOString().slice(0, 10);
}

describe("splitIntoDiaryDays (properties)", () => {
  it("the pieces tile the session: same start and end, no gap or overlap, no time lost or added", () => {
    fc.assert(
      fc.property(anySession, ({ startedAt, endedAt }) => {
        const pieces = splitIntoDiaryDays(startedAt, endedAt);
        if (startedAt.getTime() === endedAt.getTime()) return pieces.length === 0;
        const contiguous = pieces.every(
          (piece, index) =>
            piece.startedAt < piece.endedAt &&
            (index === 0 || pieces[index - 1]?.endedAt.getTime() === piece.startedAt.getTime()),
        );
        return (
          contiguous &&
          pieces[0]?.startedAt.getTime() === startedAt.getTime() &&
          pieces.at(-1)?.endedAt.getTime() === endedAt.getTime() &&
          totalSeconds(pieces) === elapsedSeconds({ startedAt, endedAt })
        );
      }),
      { numRuns },
    );
  });

  it("each piece lies within its own Prague date, and the dates follow day after day", () => {
    fc.assert(
      fc.property(anySession, ({ startedAt, endedAt }) => {
        const pieces = splitIntoDiaryDays(startedAt, endedAt);
        return pieces.every(
          (piece, index) =>
            pragueDateOf(piece.startedAt.getTime()) === piece.date &&
            pragueDateOf(piece.endedAt.getTime() - 1) === piece.date &&
            (index === 0 || nextDate(pieces[index - 1]?.date ?? "") === piece.date),
        );
      }),
      { numRuns },
    );
  });

  it("a piece ends before the session's end only at a Prague midnight", () => {
    fc.assert(
      fc.property(anySession, ({ startedAt, endedAt }) => {
        const pieces = splitIntoDiaryDays(startedAt, endedAt);
        return pieces
          .slice(0, -1)
          .every(
            (piece) =>
              pragueDateOf(piece.endedAt.getTime()) === nextDate(piece.date) &&
              pragueDateOf(piece.endedAt.getTime() - 1) === piece.date,
          );
      }),
      { numRuns },
    );
  });
});
