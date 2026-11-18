import type { RoadmapEventList } from "@sebela/api-client";

import { ROADMAP_PATH } from "./overview";

/** One event as the events page shows it. */
export interface EventRow {
  readonly slug: string;
  readonly name: string;
  readonly kindLabel: string;
  readonly period: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly details: string | null;
  readonly href: string | null;
  readonly takeaways: string | null;
  readonly topics: readonly string[];
  readonly attendance: string | null;
  readonly diaryHref: string;
}

export interface EventYear {
  readonly year: string;
  readonly events: readonly EventRow[];
}

export interface EventsPage {
  readonly years: readonly EventYear[];
}

export const EVENTS_PATH = `${ROADMAP_PATH}/events`;

export function toEventsPage(events: RoadmapEventList): EventsPage {
  throw new Error(`not implemented: ${String(events.length)}`);
}
