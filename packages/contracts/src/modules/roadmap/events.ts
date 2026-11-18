// The event contracts, private to the roadmap module and re-exported by its entry: attended events
// as written and as read, and the short form a diary day shows. An event is not a resource and has
// no module; its dates are inclusive calendar dates in Europe/Prague and its attendance time comes
// only from the time entries logged on it.
import { z } from "zod";

import { SlugParamsSchema, TopicSchema } from "../profile/index.js";

/** The kinds of attended event. */
export const roadmapEventKinds = ["conference", "meetup", "workshop", "lecture"] as const;

const PERIOD_RULE = "The end cannot be before the start.";
const UNIQUE_TOPICS = "List each topic once.";
const NON_EMPTY = { message: "Change at least one field." };

/** Trimmed, non-empty text of at most `max` characters. */
const text = (max: number) => z.string().trim().min(1).max(max);

const SlugSchema = SlugParamsSchema.shape.slug;

const InstantSchema = z.iso.datetime();

const KindSchema = z.enum(roadmapEventKinds);

const StartsOnSchema = z.iso.date().meta({
  description: "The first day of the event, `YYYY-MM-DD` in Europe/Prague, inclusive.",
});

const EndsOnSchema = z.iso.date().meta({
  description:
    "The last day of the event, `YYYY-MM-DD` in Europe/Prague, inclusive and not before " +
    "`startsOn`; equal to it for a single-day event.",
});

const LinkSchema = z
  .url({ protocol: /^https?$/, hostname: z.regexes.domain })
  .max(2048)
  .nullable()
  .meta({ description: "An absolute `http` or `https` address; `null` when there is none." });

/** Scalar fields of an event, the same when written and when read. */
const eventFields = {
  name: text(300),
  kind: KindSchema,
  organizer: text(300).nullable().meta({ description: "Who organised it; `null` when unknown." }),
  startsOn: StartsOnSchema,
  endsOn: EndsOnSchema,
  place: text(300)
    .nullable()
    .meta({ description: "Where it took place; `null` for an online event or when unknown." }),
  online: z.boolean().meta({ description: "Whether it was attended online." }),
  link: LinkSchema,
  takeaways: text(50_000)
    .nullable()
    .meta({ description: "What was taken away, in Markdown; `null` when there is nothing yet." }),
};

const TopicSlugsSchema = z
  .array(SlugSchema)
  .max(50)
  .meta({
    description:
      "Slugs of existing shared topics, each once, in their intended order. On an update the " +
      "list replaces every link; an omitted list leaves them unchanged.",
  });

/** The end is not before the start, checked when both are in the same body. */
function endFollowsStart(
  value: { startsOn?: string | undefined; endsOn?: string | undefined },
  context: z.core.$RefinementCtx,
) {
  const { startsOn, endsOn } = value;
  if (startsOn === undefined || endsOn === undefined) return;
  // ISO dates of the same format compare chronologically as strings.
  if (endsOn < startsOn) {
    context.addIssue({ code: "custom", path: ["endsOn"], message: PERIOD_RULE });
  }
}

/** Every topic slug of a write appears once. */
function topicsAreUnique(value: { topics?: string[] | undefined }, context: z.core.$RefinementCtx) {
  const { topics } = value;
  if (topics !== undefined && new Set(topics).size !== topics.length) {
    context.addIssue({ code: "custom", path: ["topics"], message: UNIQUE_TOPICS });
  }
}

/** An attended event with its shared topics and the attendance time logged on it. */
export const RoadmapEventSchema = z
  .object({
    id: z.uuid(),
    slug: SlugSchema,
    ...eventFields,
    topics: z.array(TopicSchema).meta({ description: "The linked topics, in their order." }),
    attendanceSeconds: z
      .int()
      .min(0)
      .meta({
        description:
          "The elapsed seconds of the time entries logged on the event, derived on read. The " +
          "date range alone contributes nothing.",
      }),
    createdAt: InstantSchema,
    updatedAt: InstantSchema,
  })
  .meta({ id: "RoadmapEvent" });

/** Every event, newest first. */
export const RoadmapEventListSchema = z.array(RoadmapEventSchema).meta({
  id: "RoadmapEventList",
  description: "Ordered by start date, newest first, then by end date (newest first) and slug.",
});

/** The event a diary day shows: one whose date range covers the day. */
export const DiaryEventSchema = z
  .object({
    slug: SlugSchema,
    name: z.string(),
    kind: KindSchema,
    startsOn: StartsOnSchema,
    endsOn: EndsOnSchema,
    link: z.string().nullable().meta({ description: "`null` when the event has no link." }),
  })
  .meta({ id: "DiaryEvent" });

/** Body of creating an event. Omitted optional fields mean none, in person and without topics. */
export const RoadmapEventCreateSchema = z
  .strictObject({
    slug: SlugSchema,
    ...eventFields,
    organizer: eventFields.organizer.default(null),
    place: eventFields.place.default(null),
    online: eventFields.online.default(false),
    link: eventFields.link.default(null),
    takeaways: eventFields.takeaways.default(null),
    topics: TopicSlugsSchema.default([]),
  })
  .superRefine(endFollowsStart)
  .superRefine(topicsAreUnique)
  .meta({ id: "RoadmapEventCreate" });

/**
 * Body of updating an event: at least one field; the slug cannot change and `null` clears an
 * optional field. The dates may not end up reversed or exclude logged attendance.
 */
export const RoadmapEventUpdateSchema = z
  .strictObject({ ...eventFields, topics: TopicSlugsSchema })
  .partial()
  .refine((change) => Object.keys(change).length > 0, NON_EMPTY)
  .superRefine(endFollowsStart)
  .superRefine(topicsAreUnique)
  .meta({ id: "RoadmapEventUpdate" });

export type RoadmapEventKind = (typeof roadmapEventKinds)[number];
export type RoadmapEvent = z.infer<typeof RoadmapEventSchema>;
export type RoadmapEventList = z.infer<typeof RoadmapEventListSchema>;
export type DiaryEvent = z.infer<typeof DiaryEventSchema>;
export type RoadmapEventCreate = z.output<typeof RoadmapEventCreateSchema>;
export type RoadmapEventUpdate = z.output<typeof RoadmapEventUpdateSchema>;
