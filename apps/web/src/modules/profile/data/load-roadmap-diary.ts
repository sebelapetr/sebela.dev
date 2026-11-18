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

/** The content of one diary day's page, all of it from the API. */
export interface RoadmapDiaryDayContent {
  readonly name: string;
  readonly headline: string;
  /** The day with its notes, time entries and derived total, exactly as the API answered it. */
  readonly day: DiaryDay;
  /** The roadmap's areas and their modules in the API's order, for the entries' grouping. */
  readonly areas: readonly RoadmapDiaryAreaName[];
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

export function loadRoadmapDiary(
  client: ApiClient,
  options: LoadRoadmapDiaryOptions = {},
): Promise<RoadmapDiaryResult> {
  throw new Error("not implemented", { cause: [client, options] });
}

export function loadRoadmapDiaryDay(
  client: ApiClient,
  date: string,
  options: LoadRoadmapDiaryOptions = {},
): Promise<RoadmapDiaryDayResult> {
  throw new Error("not implemented", { cause: [client, date, options] });
}
