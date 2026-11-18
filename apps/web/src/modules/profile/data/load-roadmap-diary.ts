import type { ApiClient, Diary, DiaryDay } from "@sebela/api-client";

/** The content of the learning diary's list, all of it from the API. */
export interface RoadmapDiaryContent {
  readonly name: string;
  readonly headline: string;
  /** Every diary day, newest first, exactly as the API answered it; `{ days: [] }` when empty. */
  readonly diary: Diary;
}

/** A module of the roadmap by its slug and name. */
export interface RoadmapDiaryModuleName {
  readonly slug: string;
  readonly name: string;
}

/** An area of the roadmap by its slug and name, with its modules, in the API's order. */
export interface RoadmapDiaryAreaName {
  readonly slug: string;
  readonly name: string;
  readonly modules: readonly RoadmapDiaryModuleName[];
}

/** A resource of the roadmap that reads a book: both by their slugs. */
export interface RoadmapDiaryBookLink {
  readonly resource: string;
  readonly book: string;
}

/** The content of one diary day's page, all of it from the API. */
export interface RoadmapDiaryDayContent {
  readonly name: string;
  readonly headline: string;
  /** The day with its notes, time entries and derived total, exactly as the API answered it. */
  readonly day: DiaryDay;
  /** The roadmap's areas and their modules in the API's order, for the entries' grouping. */
  readonly areas: readonly RoadmapDiaryAreaName[];
  /** Every resource of the roadmap that reads a book, for its sessions' links to the book. */
  readonly books: readonly RoadmapDiaryBookLink[];
}

/** What the diary's list can show: its content, no profile yet, or content not readable now. */
export type RoadmapDiaryResult =
  | { readonly status: "ready"; readonly content: RoadmapDiaryContent }
  | { readonly status: "missing" }
  | { readonly status: "unavailable" };

/** What a diary day's page can show: its content, no such day, or content not readable now. */
export type RoadmapDiaryDayResult =
  | { readonly status: "ready"; readonly content: RoadmapDiaryDayContent }
  | { readonly status: "missing" }
  | { readonly status: "unavailable" };

export interface LoadRoadmapDiaryOptions {
  /** How long each request may take; 5 seconds by default. */
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * Reads the learning diary's list from the API's public routes: the person and every diary day,
 * uncached and limited in time. A person that does not exist makes the page missing; an empty
 * diary is ready with no days; any other failed read makes it unavailable, never empty. The diary
 * is returned as the API answered it: its order and totals are the API's, never recounted.
 */
export async function loadRoadmapDiary(
  client: ApiClient,
  options: LoadRoadmapDiaryOptions = {},
): Promise<RoadmapDiaryResult> {
  const init = requestInit(options);
  try {
    const [personRead, diaryRead] = await Promise.all([
      client.GET("/v1/person", init()),
      client.GET("/v1/roadmap/diary", init()),
    ]);
    if (personRead.data === undefined) return failedPersonRead(personRead.response);
    if (diaryRead.data === undefined) return { status: "unavailable" };
    return {
      status: "ready",
      content: {
        name: personRead.data.name,
        headline: personRead.data.headline,
        diary: diaryRead.data,
      },
    };
  } catch {
    return { status: "unavailable" };
  }
}

/**
 * Reads a diary day's page from the API's public routes: the person, the day with its notes, time
 * entries and derived total, and the roadmap's areas and modules in order (slug and name, for the
 * entries' grouping), uncached and limited in time. A day without a diary record, an address that
 * is not a calendar day or a person that does not exist makes the page missing; any other failed
 * read, the roadmap's included, makes it unavailable, never missing.
 */
export async function loadRoadmapDiaryDay(
  client: ApiClient,
  date: string,
  options: LoadRoadmapDiaryOptions = {},
): Promise<RoadmapDiaryDayResult> {
  const init = requestInit(options);
  try {
    const [personRead, dayRead, treeRead] = await Promise.all([
      client.GET("/v1/person", init()),
      client.GET("/v1/roadmap/diary/{date}", { params: { path: { date } }, ...init() }),
      client.GET("/v1/roadmap", init()),
    ]);
    if (personRead.data === undefined) return failedPersonRead(personRead.response);
    if (dayRead.data === undefined) {
      const { status } = dayRead.response;
      return status === 404 || status === 400 ? { status: "missing" } : { status: "unavailable" };
    }
    if (treeRead.data === undefined) return { status: "unavailable" };
    return {
      status: "ready",
      content: {
        name: personRead.data.name,
        headline: personRead.data.headline,
        day: dayRead.data,
        areas: treeRead.data.areas.map((area) => ({
          slug: area.slug,
          name: area.name,
          modules: area.modules.map(({ slug, name }) => ({ slug, name })),
        })),
        books: [],
      },
    };
  } catch {
    return { status: "unavailable" };
  }
}

function requestInit(options: LoadRoadmapDiaryOptions) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return () => ({ cache: "no-store" as const, signal: AbortSignal.timeout(timeoutMs) });
}

/** A profile that does not exist yet is missing; any other failed read is unavailable. */
function failedPersonRead(response: Response): { readonly status: "missing" | "unavailable" } {
  return response.status === 404 ? { status: "missing" } : { status: "unavailable" };
}
