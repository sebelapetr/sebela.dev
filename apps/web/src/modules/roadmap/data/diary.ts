import type { Diary, DiaryDay, TimeEntry } from "@sebela/api-client";

import { bookshelfHref, roadmapHref } from "../../_shared";
import type { RoadmapDiaryAreaName, RoadmapDiaryBookLink } from "../../profile";
import type { RoadmapCrumb } from "./detail";
import { resourceTypeLabel, ROADMAP_PATH, safeLink } from "./overview";

/** One day as the diary's list shows it. */
export interface DiaryListDay {
  readonly date: string;
  /** The calendar day in words, for example `Monday, March 2, 2026`. */
  readonly title: string;
  readonly href: string;
  /** The day's study time for display, or null on a day with notes only. */
  readonly total: string | null;
  /** How many sessions the day holds in words, or null on a day with notes only. */
  readonly sessions: string | null;
  /** The day's Markdown notes, or null. */
  readonly notes: string | null;
  /** The events whose date range covers the day, in the API's order. */
  readonly events: readonly DiaryListEvent[];
}

/** An event covering a day, as the diary's list names it. */
export interface DiaryListEvent {
  readonly slug: string;
  readonly name: string;
  readonly kindLabel: string;
  /** Which day of the event this is, for example `Day 2 of 3`, or null on an event of one day. */
  readonly dayOf: string | null;
}

export interface DiaryList {
  readonly days: readonly DiaryListDay[];
}

/** A study session on its day's page. */
export interface DiarySession {
  readonly id: string;
  /** Its start and end as Prague wall-clock times, `HH:mm`. */
  readonly start: string;
  readonly end: string;
  /** Its start and end as the API's instants, for `<time dateTime>`. */
  readonly startedAt: string;
  readonly endedAt: string;
  readonly duration: string;
  readonly resource: {
    readonly name: string;
    readonly typeLabel: string;
    /** A safe absolute `http(s)` address, or null. */
    readonly href: string | null;
    /** The page of the book the resource reads, on the bookshelf, or null. */
    readonly bookHref: string | null;
  };
}

export interface DiaryModuleGroup {
  readonly slug: string;
  readonly name: string;
  /** The module's page, or null when the roadmap does not name it. */
  readonly href: string | null;
  readonly entries: readonly DiarySession[];
}

export interface DiaryAreaGroup {
  readonly slug: string;
  readonly name: string;
  /** The area's page, or null when the roadmap does not name it. */
  readonly href: string | null;
  readonly modules: readonly DiaryModuleGroup[];
}

/** Time spent at an event on its day's page. */
export interface DiaryAttendance {
  readonly id: string;
  /** Its start and end as Prague wall-clock times, `HH:mm`. */
  readonly start: string;
  readonly end: string;
  /** Its start and end as the API's instants, for `<time dateTime>`. */
  readonly startedAt: string;
  readonly endedAt: string;
  readonly duration: string;
}

/** An event on a diary day's page, with the time spent at it that day. */
export interface DiaryEventGroup extends DiaryListEvent {
  /** The event's whole date range in words. */
  readonly period: string;
  /** A safe absolute `http(s)` address, or null. */
  readonly href: string | null;
  readonly sessions: readonly DiaryAttendance[];
}

/** A diary day's own page. */
export interface DiaryDayPage {
  readonly date: string;
  readonly title: string;
  readonly total: string | null;
  readonly sessions: string | null;
  readonly notes: string | null;
  readonly areas: readonly DiaryAreaGroup[];
  readonly events: readonly DiaryEventGroup[];
  readonly breadcrumbs: readonly RoadmapCrumb[];
}

/** The learning diary's own address. */
export const DIARY_PATH = `${ROADMAP_PATH}/diary`;

/** The diary's name, as its pages and titles name it. */
export const DIARY_NAME = "Learning Diary";

/** The address of a diary day's page; the date stays inside its own path segment. */
export function diaryDayHref(date: string): string {
  return `${DIARY_PATH}/${encodeURIComponent(date)}`;
}

const DIARY_DATE = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
});

/**
 * A diary day (`YYYY-MM-DD`, already a Prague calendar day) in words, for example `Monday, March 2,
 * 2026`. It is formatted as the calendar day itself, so no time zone can move it to another day.
 */
export function formatDiaryDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match === null) return date;
  const [, year, month, day] = match;
  return DIARY_DATE.format(new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))));
}

const PRAGUE_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Prague",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** An instant as Prague's wall-clock time, `HH:mm`, whatever the server's or browser's zone. */
function pragueTime(iso: string): string {
  return PRAGUE_TIME.format(new Date(iso));
}

/**
 * Study time for display, rounded to whole minutes only here: `45 min` under an hour, `2h` for
 * whole hours, `1h 30m` otherwise, and `<1 min` for a few seconds that round to none.
 */
export function formatStudyTime(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes === 0) return seconds > 0 ? "<1 min" : "0 min";
  if (minutes < 60) return `${String(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${String(hours)}h` : `${String(hours)}h ${String(rest)}m`;
}

function sessionCount(entries: readonly TimeEntry[]): string | null {
  if (entries.length === 0) return null;
  return `${String(entries.length)} session${entries.length === 1 ? "" : "s"}`;
}

function totalLabel(day: DiaryDay): string | null {
  return day.entries.length === 0 ? null : formatStudyTime(day.totalSeconds);
}

/**
 * The diary's list as the page shows it: every day in the API's order (newest first), its date in
 * words and the way to its page, its study time and sessions (none on a day with notes only) and
 * its Markdown notes. Totals are the API's derived seconds, rounded only for display.
 */
export function toDiaryList(diary: Diary): DiaryList {
  return {
    days: diary.days.map((day) => ({
      date: day.date,
      title: formatDiaryDate(day.date),
      href: diaryDayHref(day.date),
      total: totalLabel(day),
      sessions: sessionCount(day.entries),
      notes: day.notes,
      events: [],
    })),
  };
}

/**
 * A diary day's own page: its date in words, study time, sessions and Markdown notes, the way from
 * the overview through the diary, and its sessions grouped by area, then module, in the roadmap's
 * order (`areas`), each group's sessions by their start. Times are Prague's wall-clock times; a
 * resource's link is kept only when it is safe. An area or module the roadmap does not name keeps
 * its slug as its name, has no link and follows the named ones in the order it first appears. A
 * session on a resource that reads a book (`books`) links to the book's page on the bookshelf.
 * Attendance at an event is counted in the day's total and sessions but has no area group.
 */
export function toDiaryDayPage(
  day: DiaryDay,
  areas: readonly RoadmapDiaryAreaName[],
  books: readonly RoadmapDiaryBookLink[] = [],
): DiaryDayPage {
  const bookOf = new Map(books.map((link) => [link.resource, link.book]));
  const title = formatDiaryDate(day.date);
  return {
    date: day.date,
    title,
    total: totalLabel(day),
    sessions: sessionCount(day.entries),
    notes: day.notes,
    areas: groupSessions(day.entries, areas, bookOf),
    events: [],
    breadcrumbs: [
      { name: "AI Engineering Roadmap", href: ROADMAP_PATH },
      { name: DIARY_NAME, href: DIARY_PATH },
      { name: title, href: diaryDayHref(day.date) },
    ],
  };
}

/** A time entry on a resource; attendance at an event has no area or module to group under. */
type ResourceEntry = TimeEntry & { readonly resource: NonNullable<TimeEntry["resource"]> };

function onResource(entry: TimeEntry): entry is ResourceEntry {
  return entry.resource !== null;
}

function toSession(entry: ResourceEntry, bookOf: ReadonlyMap<string, string>): DiarySession {
  const book = bookOf.get(entry.resource.slug);
  return {
    id: entry.id,
    start: pragueTime(entry.startedAt),
    end: pragueTime(entry.endedAt),
    startedAt: entry.startedAt,
    endedAt: entry.endedAt,
    duration: formatStudyTime(entry.durationSeconds),
    resource: {
      name: entry.resource.name,
      typeLabel: resourceTypeLabel(entry.resource.type),
      href: safeLink(entry.resource.link),
      bookHref: book === undefined ? null : bookshelfHref(book),
    },
  };
}

/** Where a slug stands in the roadmap's order; unnamed ones after all named ones. */
function rank(slugs: readonly string[], slug: string): number {
  const index = slugs.indexOf(slug);
  return index === -1 ? slugs.length : index;
}

function groupSessions(
  entries: readonly TimeEntry[],
  areas: readonly RoadmapDiaryAreaName[],
  bookOf: ReadonlyMap<string, string>,
): DiaryAreaGroup[] {
  const byArea = new Map<string, Map<string, ResourceEntry[]>>();
  for (const entry of entries.filter(onResource)) {
    const { area, module } = entry.resource;
    const modules = byArea.get(area) ?? new Map<string, ResourceEntry[]>();
    byArea.set(area, modules);
    modules.set(module, [...(modules.get(module) ?? []), entry]);
  }
  const areaSlugs = areas.map((area) => area.slug);
  // A stable sort keeps unnamed areas and modules in the order they first appear.
  return [...byArea.entries()]
    .sort(([a], [b]) => rank(areaSlugs, a) - rank(areaSlugs, b))
    .map(([areaSlug, modules]) => {
      const named = areas.find((area) => area.slug === areaSlug);
      const moduleSlugs = named?.modules.map((module) => module.slug) ?? [];
      return {
        slug: areaSlug,
        name: named?.name ?? areaSlug,
        href: named === undefined ? null : roadmapHref({ area: areaSlug }),
        modules: [...modules.entries()]
          .sort(([a], [b]) => rank(moduleSlugs, a) - rank(moduleSlugs, b))
          .map(([moduleSlug, sessions]) => {
            const namedModule = named?.modules.find((candidate) => candidate.slug === moduleSlug);
            return {
              slug: moduleSlug,
              name: namedModule?.name ?? moduleSlug,
              href:
                namedModule === undefined
                  ? null
                  : roadmapHref({ area: areaSlug, module: moduleSlug }),
              entries: [...sessions]
                .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
                .map((entry) => toSession(entry, bookOf)),
            };
          }),
      };
    });
}
