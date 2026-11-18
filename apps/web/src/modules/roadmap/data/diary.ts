import type { Diary, DiaryDay } from "@sebela/api-client";

import type { RoadmapDiaryAreaName } from "../../profile";
import type { RoadmapCrumb } from "./detail";

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

/** A diary day's own page. */
export interface DiaryDayPage {
  readonly date: string;
  readonly title: string;
  readonly total: string | null;
  readonly sessions: string | null;
  readonly notes: string | null;
  readonly areas: readonly DiaryAreaGroup[];
  readonly breadcrumbs: readonly RoadmapCrumb[];
}

export function formatDiaryDate(date: string): string {
  throw new Error("not implemented", { cause: date });
}

export function formatStudyTime(seconds: number): string {
  throw new Error("not implemented", { cause: seconds });
}

export function diaryDayHref(date: string): string {
  throw new Error("not implemented", { cause: date });
}

export function toDiaryList(diary: Diary): DiaryList {
  throw new Error("not implemented", { cause: diary });
}

export function toDiaryDayPage(
  day: DiaryDay,
  areas: readonly RoadmapDiaryAreaName[],
): DiaryDayPage {
  throw new Error("not implemented", { cause: [day, areas] });
}
