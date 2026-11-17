import { z } from "zod";

import { PositionSchema, TopicSchema } from "./catalogs.js";
import { HttpUrlSchema, SlugSchema, text, timestamps, topicsAreUnique } from "./fields.js";

/** Scalar fields of a focus entry, the same when written and when read. */
const scalarFields = {
  title: text(200).meta({ description: "What is being worked on or learned now." }),
  description: text(5000).meta({ description: "Markdown." }),
  link: HttpUrlSchema.nullable().meta({
    description:
      "An absolute `http` or `https` address with more about the focus; `null` when there is none.",
  }),
  position: PositionSchema,
};

/** Relations of a focus entry as written: the slugs of existing records. */
const relationFields = {
  project: SlugSchema.nullable().meta({
    description:
      "The slug of an existing project the focus is about, or `null` for none. On an update a " +
      "slug replaces the project, `null` removes it and an omitted field keeps it.",
  }),
  topics: z
    .array(SlugSchema)
    .max(50)
    .meta({
      description:
        "Slugs of existing topics, each once, in their intended order. On an update the list " +
        "replaces every link (an empty list removes them); an omitted list leaves them unchanged.",
    }),
};

/** The project a focus entry is about, with what a page needs to link to it. */
const FocusProjectSchema = z
  .object({
    slug: SlugSchema,
    name: z.string(),
    experience: SlugSchema.meta({ description: "The slug of the experience it belongs to." }),
  })
  .meta({ id: "CurrentFocusProject" });

/**
 * A current-focus entry: work or learning the person is focused on now, with its optional project
 * and its topics resolved.
 */
export const CurrentFocusSchema = z
  .object({
    id: z.uuid(),
    slug: SlugSchema,
    ...scalarFields,
    project: FocusProjectSchema.nullable().meta({
      description: "The project the focus is about, or `null` when it is about none.",
    }),
    topics: z
      .array(TopicSchema)
      .meta({ description: "The linked topics, in their intended order." }),
    ...timestamps,
  })
  .meta({ id: "CurrentFocus" });

/** Every focus entry, in the intended order. */
export const CurrentFocusListSchema = z
  .array(CurrentFocusSchema)
  .meta({ id: "CurrentFocusList", description: "Ordered by position, then slug." });

/**
 * Body of creating a focus entry together with its project and topic links. An omitted link or
 * project means none; omitted topics are empty.
 */
export const CurrentFocusCreateSchema = z
  .strictObject({
    slug: SlugSchema,
    ...scalarFields,
    ...relationFields,
    link: scalarFields.link.default(null),
    project: relationFields.project.default(null),
    topics: relationFields.topics.default([]),
  })
  .superRefine(topicsAreUnique)
  .meta({ id: "CurrentFocusCreate" });

/**
 * Body of updating a focus entry: at least one field; only the fields sent change and the slug
 * cannot be changed. `null` clears the link or the project, a sent `topics` list replaces the
 * stored one, and an omitted field keeps its value.
 */
export const CurrentFocusUpdateSchema = z
  .strictObject({ ...scalarFields, ...relationFields })
  .partial()
  .refine((change) => Object.keys(change).length > 0, { message: "Change at least one field." })
  .superRefine(topicsAreUnique)
  .meta({ id: "CurrentFocusUpdate" });

export type CurrentFocus = z.infer<typeof CurrentFocusSchema>;
export type CurrentFocusCreate = z.output<typeof CurrentFocusCreateSchema>;
export type CurrentFocusUpdate = z.output<typeof CurrentFocusUpdateSchema>;
