// The learning diary contracts, private to the roadmap module and re-exported by its entry: one
// notes entry per calendar date and the time entries of what was studied when. Dates are calendar
// days in `diaryTimeZone`; instants are absolute, so a repeated local time is never ambiguous.
import { z } from "zod";

import { SlugParamsSchema } from "../profile/index.js";
import { roadmapResourceTypes } from "./catalogs.js";
import { DiaryEventSchema } from "./events.js";

/** The time zone in which the diary groups and shows its days, whatever the server's or browser's. */
export const diaryTimeZone = "Europe/Prague";

const ORDER_RULE = "The end must be after the start.";
const NO_TARGET = "Name the resource that was studied or the event that was attended.";
const BOTH_TARGETS = "Name a resource or an event, not both.";
const NON_EMPTY = { message: "Change at least one field." };

const SlugSchema = SlugParamsSchema.shape.slug;

/** A calendar date of the diary in `diaryTimeZone`, `YYYY-MM-DD`. */
export const DiaryDateSchema = z.iso
  .date()
  .meta({ id: "DiaryDate", description: "A calendar day in Europe/Prague, `YYYY-MM-DD`." });

/** Path parameters naming one diary day. */
export const DiaryDateParamsSchema = z.strictObject({ date: DiaryDateSchema });

/** Path parameters naming one time entry. */
export const TimeEntryIdParamsSchema = z.strictObject({ id: z.uuid() });

/** A written instant: it must carry `Z` or an offset, so no local time is ambiguous. */
const WrittenInstantSchema = z.iso.datetime({ offset: true }).meta({
  description:
    "An absolute instant with `Z` or a UTC offset, for example `2026-03-02T23:30:00+01:00`. A " +
    "local time without an offset is refused.",
});

/** A read instant, always UTC. */
const InstantSchema = z.iso.datetime();

/**
 * The end of a written interval lies after its start, compared as instants. An instant that is
 * already refused is not compared, so a missing offset is reported once.
 */
function endFollowsStart(
  value: { startedAt?: string | undefined; endedAt?: string | undefined },
  context: z.core.$RefinementCtx,
) {
  const { startedAt, endedAt } = value;
  const written = (instant: string | undefined): instant is string =>
    WrittenInstantSchema.safeParse(instant).success;
  if (!written(startedAt) || !written(endedAt)) return;
  if (Date.parse(endedAt) <= Date.parse(startedAt)) {
    context.addIssue({ code: "custom", path: ["endedAt"], message: ORDER_RULE });
  }
}

/** A write names at most one target; `required` also refuses naming none. */
function oneTarget(required: boolean) {
  return (
    value: { resource?: string | undefined; event?: string | undefined },
    context: z.core.$RefinementCtx,
  ) => {
    if (value.resource !== undefined && value.event !== undefined) {
      context.addIssue({ code: "custom", path: ["event"], message: BOTH_TARGETS });
    } else if (required && value.resource === undefined && value.event === undefined) {
      context.addIssue({ code: "custom", path: ["resource"], message: NO_TARGET });
    }
  };
}

const timeEntryFields = {
  resource: SlugSchema.meta({
    description: "The slug of the resource that was studied; not sent with `event`.",
  }),
  event: SlugSchema.meta({
    description:
      "The slug of the event that was attended; not sent with `resource`. Every piece of the " +
      "session must fall on a day of the event.",
  }),
  startedAt: WrittenInstantSchema,
  endedAt: WrittenInstantSchema,
};

/**
 * Body of logging a study session on one resource or attendance at one event: exactly one of
 * `resource` and `event`. A session across local midnight is split into one time entry per
 * affected diary day; it may not overlap any other logged interval of either kind, while adjacent
 * intervals are allowed.
 */
export const TimeEntryCreateSchema = z
  .strictObject({
    ...timeEntryFields,
    resource: timeEntryFields.resource.optional(),
    event: timeEntryFields.event.optional(),
  })
  .superRefine(oneTarget(true))
  .superRefine(endFollowsStart)
  .meta({ id: "TimeEntryCreate" });

/**
 * Body of changing a time entry: at least one field. Sending `resource` or `event` (never both)
 * moves the entry to that target. The changed session is split at local midnight again and its
 * old and new days both change; their notes stay.
 */
export const TimeEntryUpdateSchema = z
  .strictObject(timeEntryFields)
  .partial()
  .refine((change) => Object.keys(change).length > 0, NON_EMPTY)
  .superRefine(oneTarget(false))
  .superRefine(endFollowsStart)
  .meta({ id: "TimeEntryUpdate" });

/** Body of writing a day's notes; it replaces the notes and keeps the day's time entries. */
export const DiaryNotesWriteSchema = z
  .strictObject({
    notes: z.string().trim().min(1).max(50_000).meta({ description: "Markdown." }),
  })
  .meta({ id: "DiaryNotesWrite" });

/** The resource a time entry belongs to, with where it lies in the roadmap. */
export const DiaryResourceSchema = z
  .object({
    slug: SlugSchema,
    name: z.string(),
    type: z.enum(roadmapResourceTypes),
    link: z.string().nullable().meta({ description: "`null` when the resource has no link." }),
    module: SlugSchema.meta({ description: "The slug of its module." }),
    area: SlugSchema.meta({ description: "The slug of its module's area." }),
  })
  .meta({ id: "DiaryResource" });

/** One logged interval within one diary day, on exactly one resource or event. */
export const TimeEntrySchema = z
  .object({
    id: z.uuid(),
    date: DiaryDateSchema,
    resource: DiaryResourceSchema.nullable().meta({
      description: "The resource studied; `null` for attendance at an event.",
    }),
    event: DiaryEventSchema.nullable().meta({
      description: "The event attended; `null` for a study session on a resource.",
    }),
    startedAt: InstantSchema,
    endedAt: InstantSchema,
    durationSeconds: z.int().positive().meta({
      description: "The actual elapsed seconds between the endpoints, derived on read.",
    }),
  })
  .refine((entry) => (entry.resource === null) !== (entry.event === null), {
    message: "A time entry belongs to exactly one resource or event.",
    path: ["event"],
  })
  .meta({ id: "TimeEntry" });

/**
 * One diary day: its notes, its time entries in start order and the events whose date range
 * covers it. A day may show only events; an event's dates add no time.
 */
export const DiaryDaySchema = z
  .object({
    date: DiaryDateSchema,
    notes: z.string().nullable().meta({ description: "Markdown; `null` when there are none." }),
    entries: z.array(TimeEntrySchema),
    events: z.array(DiaryEventSchema).meta({
      description:
        "The events whose inclusive date range covers the day, by start date, then slug; they " +
        "add no time.",
    }),
    totalSeconds: z.int().min(0).meta({
      description: "The sum of the entries' elapsed seconds, derived on read and never rounded.",
    }),
  })
  .meta({ id: "DiaryDay" });

/** The whole diary: every day with notes, time entries or a covering event, newest first. */
export const DiarySchema = z.object({ days: z.array(DiaryDaySchema) }).meta({ id: "Diary" });

/** The result of a time-entry write: the entries it wrote and every diary day it changed. */
export const TimeEntryWriteSchema = z
  .object({
    entries: z.array(TimeEntrySchema),
    dates: z.array(DiaryDateSchema).meta({
      description: "Every changed day, old and new, in ascending order.",
    }),
  })
  .meta({ id: "TimeEntryWrite" });

export type DiaryDateParams = z.infer<typeof DiaryDateParamsSchema>;
export type TimeEntryIdParams = z.infer<typeof TimeEntryIdParamsSchema>;
export type TimeEntryCreate = z.output<typeof TimeEntryCreateSchema>;
export type TimeEntryUpdate = z.output<typeof TimeEntryUpdateSchema>;
export type DiaryNotesWrite = z.output<typeof DiaryNotesWriteSchema>;
export type DiaryResource = z.infer<typeof DiaryResourceSchema>;
export type TimeEntry = z.infer<typeof TimeEntrySchema>;
export type DiaryDay = z.infer<typeof DiaryDaySchema>;
export type Diary = z.infer<typeof DiarySchema>;
export type TimeEntryWrite = z.infer<typeof TimeEntryWriteSchema>;
