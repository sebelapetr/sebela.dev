import type { RoadmapStatistics } from "@sebela/api-client";

import type { RoadmapCrumb } from "./detail";

/** A figure with its name, for example `Total time` and `3h 5m`. */
export interface StatisticsFigure {
  readonly label: string;
  readonly value: string;
}

/** One of the three kinds of logged time and its share of all of it. */
export interface StatisticsCategory {
  readonly label: string;
  readonly value: string;
  /** Its share of all logged time in words, for example `61.5%`. */
  readonly share: string;
}

/** A row with a duration and a bar: its share of the whole the section measures. */
export interface StatisticsBarRow {
  readonly slug: string;
  readonly name: string;
  /** The row's own page, or null when it has none. */
  readonly href: string | null;
  readonly value: string;
  /** Its share in words, for example `48.6%`. */
  readonly share: string;
  /** Its share as a number from 0 to 100, for the bar's width. */
  readonly percent: number;
}

/** An area's study time and its modules', each as a share of all study time. */
export interface StatisticsArea extends StatisticsBarRow {
  readonly modules: readonly StatisticsBarRow[];
}

/** A day, week or month with the time logged in it. */
export interface StatisticsPeriod {
  /** Its first calendar day (a day or a week) or its month (`YYYY-MM`), for `<time dateTime>`. */
  readonly key: string;
  readonly label: string;
  /** The diary's page of the day, or null for a week or month. */
  readonly href: string | null;
  readonly value: string;
  /** The three kinds of time in it, for example `1h resources · 30 min events`, or null on none. */
  readonly split: string | null;
}

/** A resource with logged time and the pages that show where the time went. */
export interface StatisticsResource {
  readonly slug: string;
  readonly name: string;
  /** The resource on its module's page. */
  readonly href: string;
  readonly typeLabel: string;
  /** `Resource` or `Book`: which kind of time it counts as. */
  readonly categoryLabel: string;
  /** Its module and area, for example `Signal basics · Orbit foundations`. */
  readonly place: string;
  /** The book it reads on the bookshelf, or null when it links none. */
  readonly book: { readonly title: string; readonly href: string } | null;
  readonly value: string;
}

/** An event with logged attendance. */
export interface StatisticsEvent {
  readonly slug: string;
  readonly name: string;
  readonly kindLabel: string;
  readonly period: string;
  readonly startsOn: string;
  /** The diary's page of its first day. */
  readonly diaryHref: string;
  readonly value: string;
}

/** The learning statistics page. */
export interface StatisticsPage {
  /** True when no time has been logged at all. */
  readonly empty: boolean;
  /** Total time, study days and the average per study day. */
  readonly figures: readonly StatisticsFigure[];
  /** Resources, books and events, which together make the total. */
  readonly categories: readonly StatisticsCategory[];
  /** Study time (resources and books) in words; event attendance is never part of it. */
  readonly studyTime: string;
  readonly areas: readonly StatisticsArea[];
  /** The most recent days with time, newest first. */
  readonly recentDays: readonly StatisticsPeriod[];
  /** The most recent weeks, newest first. */
  readonly weeks: readonly StatisticsPeriod[];
  /** Every month, newest first. */
  readonly months: readonly StatisticsPeriod[];
  readonly resources: readonly StatisticsResource[];
  readonly events: readonly StatisticsEvent[];
  readonly breadcrumbs: readonly RoadmapCrumb[];
}

/** The statistics page's name, as its page and title name it. */
export const STATISTICS_NAME = "Learning Statistics";

/** The statistics page's own address. */
export const STATISTICS_PATH = "/ai-roadmap/diary/stats";

export function toStatisticsPage(statistics: RoadmapStatistics): StatisticsPage {
  throw new Error("not implemented", { cause: statistics });
}
