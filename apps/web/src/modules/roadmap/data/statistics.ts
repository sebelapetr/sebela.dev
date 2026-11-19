import type {
  LearningTimeArea,
  LearningTimeDay,
  LearningTimeEvent,
  LearningTimeMonth,
  LearningTimeResource,
  LearningTimeWeek,
  RoadmapStatistics,
} from "@sebela/api-client";

import { anchorHref, bookshelfHref, roadmapHref, roadmapRoutes } from "../../_shared";
import type { RoadmapCrumb } from "./detail";
import { DIARY_NAME, DIARY_PATH, diaryDayHref, formatDiaryDate, formatStudyTime } from "./diary";
import { eventKindLabel, formatEventPeriod } from "./event-format";
import { resourceTypeLabel, ROADMAP_PATH } from "./overview";

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
  /** Total time, the days with time and the average per such day. */
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
export const STATISTICS_PATH = roadmapRoutes.statistics;

/** How many of the most recent days and weeks the page lists; every month is listed. */
const RECENT_DAYS = 10;
const RECENT_WEEKS = 12;

/** A part of a whole as a number from 0 to 100; none of nothing is 0. */
function percentOf(part: number, whole: number): number {
  return whole === 0 ? 0 : (part / whole) * 100;
}

/** A share in words with one decimal, for example `33.3%`. */
function formatShare(percent: number): string {
  return `${percent.toFixed(1)}%`;
}

type CategorySplit = Pick<
  LearningTimeDay,
  "totalSeconds" | "resourceSeconds" | "bookSeconds" | "eventSeconds"
>;

/** The three kinds of time in a period, the empty ones left out; null when it has none. */
function splitLabel(period: CategorySplit): string | null {
  const parts = [
    [period.resourceSeconds, "resources"],
    [period.bookSeconds, "books"],
    [period.eventSeconds, "events"],
  ] as const;
  const shown = parts
    .filter(([seconds]) => seconds > 0)
    .map(([seconds, label]) => `${formatStudyTime(seconds)} ${label}`);
  return shown.length === 0 ? null : shown.join(" · ");
}

const MONTH = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" });
const DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "long",
  day: "numeric",
  year: "numeric",
});

/** A calendar day (`YYYY-MM-DD`) or month (`YYYY-MM`) as its UTC midnight, or null. */
function calendarDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value);
  if (match === null) return null;
  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day ?? "1")));
}

function weekLabel(startsOn: string): string {
  const date = calendarDate(startsOn);
  return `Week of ${date === null ? startsOn : DAY.format(date)}`;
}

function monthLabel(month: string): string {
  const date = calendarDate(month);
  return date === null ? month : MONTH.format(date);
}

function toPeriod(
  key: string,
  label: string,
  href: string | null,
  period: CategorySplit,
): StatisticsPeriod {
  return {
    key,
    label,
    href,
    value: formatStudyTime(period.totalSeconds),
    split: splitLabel(period),
  };
}

/** The last `count` items, newest first, of a list ordered oldest first. */
function newestFirst<T>(items: readonly T[], count = items.length): T[] {
  return items.slice(Math.max(0, items.length - count)).reverse();
}

function toBarRow(
  slug: string,
  name: string,
  href: string,
  seconds: number,
  studySeconds: number,
): StatisticsBarRow {
  const percent = percentOf(seconds, studySeconds);
  return {
    slug,
    name,
    href,
    value: formatStudyTime(seconds),
    share: formatShare(percent),
    percent,
  };
}

function toArea(area: LearningTimeArea, studySeconds: number): StatisticsArea {
  return {
    ...toBarRow(
      area.slug,
      area.name,
      roadmapHref({ area: area.slug }),
      area.totalSeconds,
      studySeconds,
    ),
    modules: area.modules.map((module) =>
      toBarRow(
        module.slug,
        module.name,
        roadmapHref({ area: area.slug, module: module.slug }),
        module.totalSeconds,
        studySeconds,
      ),
    ),
  };
}

function toResource(resource: LearningTimeResource): StatisticsResource {
  return {
    slug: resource.slug,
    name: resource.name,
    href: anchorHref({
      kind: "roadmap-resource",
      area: resource.area.slug,
      module: resource.module.slug,
      slug: resource.slug,
    }),
    typeLabel: resourceTypeLabel(resource.type),
    categoryLabel: resource.category === "book" ? "Book" : "Resource",
    place: `${resource.module.name} · ${resource.area.name}`,
    book:
      resource.book === null
        ? null
        : { title: resource.book.title, href: bookshelfHref(resource.book.slug) },
    value: formatStudyTime(resource.totalSeconds),
  };
}

function toEvent(event: LearningTimeEvent): StatisticsEvent {
  return {
    slug: event.slug,
    name: event.name,
    kindLabel: eventKindLabel(event.kind),
    period: formatEventPeriod(event.startsOn, event.endsOn),
    startsOn: event.startsOn,
    diaryHref: diaryDayHref(event.startsOn),
    value: formatStudyTime(event.totalSeconds),
  };
}

const toDay = (day: LearningTimeDay) =>
  toPeriod(day.date, formatDiaryDate(day.date), diaryDayHref(day.date), day);
const toWeek = (week: LearningTimeWeek) =>
  toPeriod(week.startsOn, weekLabel(week.startsOn), null, week);
const toMonth = (month: LearningTimeMonth) =>
  toPeriod(month.month, monthLabel(month.month), null, month);

/**
 * The learning statistics page as it shows the API's aggregates, which it never recounts: the
 * total time, the days with time and the average per such day; the total split into resources,
 * books and events with each one's share; the areas and their modules in the API's order, each
 * measured against study time (resources and books) because event attendance belongs to no area;
 * the ten most recent days (each leading to its diary day), the twelve most recent weeks and every
 * month, newest first; the resources with time, each leading to its place on its module's page and
 * a book's resource also to the book; and the events with attendance, each leading to the diary's
 * page of its first day. Seconds are rounded only for display; shares are of the seconds.
 */
export function toStatisticsPage(statistics: RoadmapStatistics): StatisticsPage {
  const { totals } = statistics;
  const studySeconds = totals.resourceSeconds + totals.bookSeconds;
  const average = totals.activeDays === 0 ? 0 : totals.totalSeconds / totals.activeDays;
  const category = (label: string, seconds: number): StatisticsCategory => ({
    label,
    value: formatStudyTime(seconds),
    share: formatShare(percentOf(seconds, totals.totalSeconds)),
  });
  return {
    empty: totals.totalSeconds === 0,
    figures: [
      { label: "Total time", value: formatStudyTime(totals.totalSeconds) },
      { label: "Days with time", value: String(totals.activeDays) },
      { label: "Avg per day with time", value: formatStudyTime(average) },
    ],
    categories: [
      category("Resources", totals.resourceSeconds),
      category("Books", totals.bookSeconds),
      category("Events", totals.eventSeconds),
    ],
    studyTime: formatStudyTime(studySeconds),
    areas: statistics.areas.map((area) => toArea(area, studySeconds)),
    recentDays: newestFirst(statistics.days, RECENT_DAYS).map(toDay),
    weeks: newestFirst(statistics.weeks, RECENT_WEEKS).map(toWeek),
    months: newestFirst(statistics.months).map(toMonth),
    resources: statistics.resources.map(toResource),
    events: statistics.events.map(toEvent),
    breadcrumbs: [
      { name: "AI Engineering Roadmap", href: ROADMAP_PATH },
      { name: DIARY_NAME, href: DIARY_PATH },
      { name: STATISTICS_NAME, href: STATISTICS_PATH },
    ],
  };
}
