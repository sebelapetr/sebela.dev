import type { RoadmapEventKind } from "@sebela/api-client";

/** An event's kind as the pages name it, for example `Conference`. */
export function eventKindLabel(kind: RoadmapEventKind): string {
  throw new Error(`not implemented: ${kind}`);
}

/** An event's date range in words. */
export function formatEventPeriod(startsOn: string, endsOn: string): string {
  throw new Error(`not implemented: ${startsOn} ${endsOn}`);
}

/** Which day of an event of several days `date` is, or null. */
export function eventDayOf(date: string, startsOn: string, endsOn: string): string | null {
  throw new Error(`not implemented: ${date} ${startsOn} ${endsOn}`);
}
