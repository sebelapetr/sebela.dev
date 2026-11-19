import { diaryHref, roadmapRoutes } from "../../_shared";
import type {
  RoadmapContent,
  RoadmapDiaryContent,
  RoadmapDiaryDayContent,
  RoadmapEventsContent,
} from "../../profile";
import { BOOKSHELF_NAME } from "./bookshelf";
import type { RoadmapCrumb } from "./detail";
import { DIARY_NAME, formatDiaryDate } from "./diary";
import { EVENTS_NAME } from "./events";
import { areaHref, ROADMAP_PATH, roadmapLead, safeLink, toRoadmapOverview } from "./overview";
import {
  READING_GUIDE_NAME,
  READING_GUIDE_OPENING,
  READING_GUIDE_PATH,
  READING_GUIDE_SOURCE,
} from "./reading-guide";
import { STATISTICS_NAME } from "./statistics";

/** A page an overview or a list page leads to, as its structured data lists it. */
export interface ListedPageFacts {
  readonly name: string;
  readonly href: string;
  /** Markdown, or null. */
  readonly description: string | null;
}

interface PageFactsBase {
  /** The person's name. */
  readonly name: string;
  /** The way from the overview to the page, the page itself last. */
  readonly breadcrumbs: readonly RoadmapCrumb[];
  /** Markdown that describes the page, or null for the page's own fallback description. */
  readonly summary: string | null;
}

/** What the overview's metadata rests on: its lead and its areas in the roadmap's order. */
export interface OverviewPageFacts extends PageFactsBase {
  readonly kind: "overview";
  readonly areas: readonly ListedPageFacts[];
}

/** What the diary's metadata rests on: its days in the diary's order. */
export interface DiaryPageFacts extends PageFactsBase {
  readonly kind: "diary";
  readonly days: readonly ListedPageFacts[];
}

/** What a diary day's metadata rests on: its date; the summary is its notes. */
export interface DiaryDayPageFacts extends PageFactsBase {
  readonly kind: "diary-day";
  readonly date: string;
}

/** What the statistics' metadata rests on. */
export interface StatisticsPageFacts extends PageFactsBase {
  readonly kind: "statistics";
}

/** What the events page's metadata rests on: its events in the page's order. */
export interface EventsPageFacts extends PageFactsBase {
  readonly kind: "events";
  readonly events: readonly {
    readonly name: string;
    readonly startsOn: string;
    readonly endsOn: string;
    /** A safe absolute `http(s)` address, or null. */
    readonly href: string | null;
    readonly online: boolean;
    readonly place: string | null;
    readonly organizer: string | null;
  }[];
}

/** What the reading guide's metadata rests on: the talk it is based on; the summary is its opening. */
export interface ReadingGuidePageFacts extends PageFactsBase {
  readonly kind: "reading-guide";
  readonly basedOn: { readonly name: string; readonly url: string };
}

const OVERVIEW_CRUMB: RoadmapCrumb = { name: "AI Engineering Roadmap", href: ROADMAP_PATH };
const DIARY_CRUMB: RoadmapCrumb = { name: DIARY_NAME, href: roadmapRoutes.diary };

/** The overview's facts: its lead from the API's totals and its areas in the API's order. */
export function overviewPageFacts(content: RoadmapContent): OverviewPageFacts {
  return {
    name: content.name,
    kind: "overview",
    breadcrumbs: [OVERVIEW_CRUMB],
    summary: roadmapLead(toRoadmapOverview(content.roadmap).facts),
    areas: content.roadmap.areas.map((area) => ({
      name: area.name,
      href: areaHref(area.slug),
      description: area.description,
    })),
  };
}

/** The diary's facts: every day in the API's order with its date in words and its notes. */
export function diaryPageFacts(content: RoadmapDiaryContent): DiaryPageFacts {
  return {
    name: content.name,
    kind: "diary",
    breadcrumbs: [OVERVIEW_CRUMB, DIARY_CRUMB],
    summary: null,
    days: content.diary.days.map((day) => ({
      name: formatDiaryDate(day.date),
      href: diaryHref(day.date),
      description: day.notes,
    })),
  };
}

/** A diary day's facts: the day under the diary, its notes as the summary. */
export function diaryDayPageFacts(content: RoadmapDiaryDayContent): DiaryDayPageFacts {
  const { day } = content;
  return {
    name: content.name,
    kind: "diary-day",
    breadcrumbs: [
      OVERVIEW_CRUMB,
      DIARY_CRUMB,
      { name: formatDiaryDate(day.date), href: diaryHref(day.date) },
    ],
    summary: day.notes,
    date: day.date,
  };
}

/** The statistics' facts: the page under the diary. */
export function statisticsPageFacts(content: { readonly name: string }): StatisticsPageFacts {
  return {
    name: content.name,
    kind: "statistics",
    breadcrumbs: [
      OVERVIEW_CRUMB,
      DIARY_CRUMB,
      { name: STATISTICS_NAME, href: roadmapRoutes.statistics },
    ],
    summary: null,
  };
}

/** The events' facts: every event in the API's order, with a link only when it is safe. */
export function eventsPageFacts(content: RoadmapEventsContent): EventsPageFacts {
  return {
    name: content.name,
    kind: "events",
    breadcrumbs: [OVERVIEW_CRUMB, { name: EVENTS_NAME, href: roadmapRoutes.events }],
    summary: null,
    events: content.events.map((event) => ({
      name: event.name,
      startsOn: event.startsOn,
      endsOn: event.endsOn,
      href: safeLink(event.link),
      online: event.online,
      place: event.place,
      organizer: event.organizer,
    })),
  };
}

/** The reading guide's facts: the guide under the bookshelf, its opening and its source. */
export function readingGuidePageFacts(content: { readonly name: string }): ReadingGuidePageFacts {
  return {
    name: content.name,
    kind: "reading-guide",
    breadcrumbs: [
      OVERVIEW_CRUMB,
      { name: BOOKSHELF_NAME, href: roadmapRoutes.bookshelf },
      { name: READING_GUIDE_NAME, href: READING_GUIDE_PATH },
    ],
    summary: READING_GUIDE_OPENING,
    basedOn: { name: READING_GUIDE_SOURCE.name, url: READING_GUIDE_SOURCE.url },
  };
}
