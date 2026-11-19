// The learning diary's HTTP routes, private to the roadmap module and part of its routes: public
// reads of the diary and of one Prague calendar day, and authenticated writes of a day's notes and
// of time entries on a resource or an event. Each write reports every diary day it changed, so the
// website refreshes the old and the new day; a time-entry write is audited per time entry.
import {
  DiaryDateParamsSchema,
  DiaryDaySchema,
  DiaryNotesWriteSchema,
  DiarySchema,
  TimeEntryCreateSchema,
  TimeEntryIdParamsSchema,
  TimeEntryUpdateSchema,
  TimeEntryWriteSchema,
  type TimeEntryWrite,
} from "@sebela/contracts";
import type { RoadmapService } from "@sebela/services";

import { defineRoute, type RouteDefinition } from "../../routing.js";

const DIARY = "/v1/roadmap/diary";
const DAY = "/v1/roadmap/diary/:date";
const TIME_ENTRIES = "/v1/roadmap/time-entries";
const TIME_ENTRY = "/v1/roadmap/time-entries/:id";

const SESSION_RULES =
  "Give both endpoints as absolute instants with an offset, in whole seconds, the end after the " +
  "start; an offset tells a repeated local hour apart. The target is exactly one `resource` " +
  "(study time) or `event` (attendance), and attendance must fall on the event's days. The " +
  "session is split at each Europe/Prague midnight into one entry per diary day without changing " +
  "its elapsed time. It must not overlap any logged interval on any resource or event, also one " +
  "written at the same time (`409`); adjacent intervals are allowed. An unknown `resource` or " +
  "`event`, or attendance outside the event, is refused naming the field.";

/** The diary days in a write result. */
const changedDays = ({ result }: { readonly result: { readonly dates: readonly string[] } }) =>
  result.dates;

/** A time-entry write is audited per time entry: the one its path names and each one it wrote. */
const TIME_ENTRY_AUDIT = "roadmap-time-entry";
const addressedEntry = (params: { readonly id: string }) => [params.id];
const writtenEntries = (result: TimeEntryWrite) => result.entries.map((entry) => entry.id);
/** The diary days a time-entry write wrote to or left. */
const writtenDays = ({ result }: { readonly result: TimeEntryWrite }) => result.dates;

/** The routes of the learning diary over the roadmap service. */
export function diaryRoutes(roadmap: RoadmapService): RouteDefinition[] {
  return [
    defineRoute({
      operationId: "getRoadmapDiary",
      method: "GET",
      path: DIARY,
      access: "public",
      summary: "Read the learning diary",
      description:
        "Every Europe/Prague calendar day with notes, time entries or an event covering it, newest " +
        "first, each with its entries in time order and their resource or event, and the events " +
        "whose dates cover it. An event's days add no time. Durations and day totals are derived from the " +
        "stored endpoints on every read, in actual elapsed seconds and before any rounding. An " +
        "empty diary is the valid empty `days` list.",
      response: { status: 200, description: "The diary days.", schema: DiarySchema },
      errors: [],
      handle: () => roadmap.getDiary(),
    }),
    defineRoute({
      operationId: "getRoadmapDiaryDay",
      method: "GET",
      path: DAY,
      access: "public",
      summary: "Read one day of the learning diary",
      description:
        "The day's notes, its time entries, their derived total and the events covering it, as in " +
        "the whole diary. A day without notes, time entries or a covering event is not found.",
      params: DiaryDateParamsSchema,
      response: { status: 200, description: "The diary day.", schema: DiaryDaySchema },
      errors: ["not_found"],
      handle: ({ params }) => roadmap.getDiaryDay(params.date),
    }),
    defineRoute({
      operationId: "writeRoadmapDiaryNotes",
      method: "PATCH",
      content: "roadmap-diary",
      path: DAY,
      access: "private",
      summary: "Write a diary day's notes",
      description:
        "Creates the day or replaces its Markdown notes, one entry per calendar day; the day's " +
        "time entries stay.",
      params: DiaryDateParamsSchema,
      body: DiaryNotesWriteSchema,
      response: { status: 200, description: "The diary day.", schema: DiaryDaySchema },
      errors: [],
      handle: ({ params, body }) => roadmap.writeDiaryNotes(params.date, body),
      records: ({ params }) => [params.date],
    }),
    defineRoute({
      operationId: "deleteRoadmapDiaryNotes",
      method: "DELETE",
      content: "roadmap-diary",
      path: DAY,
      access: "private",
      summary: "Delete a diary day's notes",
      description:
        "Clears the notes and keeps the day's time entries; a day without notes is not found.",
      params: DiaryDateParamsSchema,
      response: { status: 204, description: "The notes were deleted." },
      errors: ["not_found"],
      handle: async ({ params }) => {
        await roadmap.deleteDiaryNotes(params.date);
        return undefined;
      },
      records: ({ params }) => [params.date],
    }),
    defineRoute({
      operationId: "createRoadmapTimeEntry",
      method: "POST",
      content: "roadmap-diary",
      path: TIME_ENTRIES,
      access: "private",
      summary: "Log a study session",
      description: `${SESSION_RULES} All of its entries are written or none.`,
      body: TimeEntryCreateSchema,
      response: {
        status: 201,
        description: "The written entries and the diary days they belong to.",
        schema: TimeEntryWriteSchema,
      },
      errors: ["conflict"],
      handle: ({ body }) => roadmap.createTimeEntry(body),
      records: writtenDays,
      audit: { entity: TIME_ENTRY_AUDIT, records: () => [], recordsOf: writtenEntries },
    }),
    defineRoute({
      operationId: "updateRoadmapTimeEntry",
      method: "PATCH",
      content: "roadmap-diary",
      path: TIME_ENTRY,
      access: "private",
      summary: "Update a time entry",
      description:
        `Changes only the fields sent and judges the merged interval by the same rules. ` +
        `${SESSION_RULES} The first entry keeps the identifier; the result names the old and the ` +
        "new days, whose notes stay.",
      params: TimeEntryIdParamsSchema,
      body: TimeEntryUpdateSchema,
      response: {
        status: 200,
        description: "The written entries and every diary day the change touched.",
        schema: TimeEntryWriteSchema,
      },
      errors: ["not_found", "conflict"],
      handle: ({ params, body }) => roadmap.updateTimeEntry(params.id, body),
      records: writtenDays,
      audit: { entity: TIME_ENTRY_AUDIT, records: addressedEntry, recordsOf: writtenEntries },
    }),
    defineRoute({
      operationId: "deleteRoadmapTimeEntry",
      method: "DELETE",
      content: "roadmap-diary",
      path: TIME_ENTRY,
      access: "private",
      summary: "Delete a time entry",
      description: "Deletes one entry; the notes of its day stay.",
      params: TimeEntryIdParamsSchema,
      response: { status: 204, description: "The time entry was deleted." },
      errors: ["not_found"],
      handle: ({ params }) => roadmap.deleteTimeEntry(params.id),
      records: changedDays,
      audit: { entity: TIME_ENTRY_AUDIT, records: addressedEntry },
    }),
  ];
}
