import { z } from "zod";

import { PositionSchema, TechnologySchema, TopicSchema } from "./catalogs.js";
import {
  DateSchema,
  endFollowsStart,
  SlugSchema,
  technologiesAreUnique,
  text,
  timestamps,
  topicsAreUnique,
} from "./fields.js";

/** How far an exploration got, from the strongest claim to the weakest. */
export const explorationStatuses = ["built", "tested", "designed"] as const;

const StatusSchema = z.enum(explorationStatuses).meta({
  description:
    "How far the exploration got: `built` (it exists and runs), `tested` (it was tried out) or " +
    "`designed` (it exists only as a design). Returned exactly as stored.",
});

/** Scalar fields of an exploration, the same when written and when read. */
const scalarFields = {
  name: text(200),
  summary: text(5000).meta({ description: "Markdown." }),
  status: StatusSchema,
  concepts: z
    .array(text(200))
    .max(30)
    .meta({ description: "Plain-text concepts the exploration covers, in their intended order." }),
  startedOn: DateSchema.meta({ description: "The first day of the exploration, an ISO date." }),
  endedOn: DateSchema.nullable().meta({
    description: "The last day of the exploration, an ISO date; `null` marks an ongoing one.",
  }),
  position: PositionSchema,
};

/** Relations of an exploration as written: the slugs of existing catalog records. */
const relationFields = {
  technologies: z
    .array(SlugSchema)
    .max(50)
    .meta({
      description:
        "Slugs of existing technologies, each once, in their intended order. On an update the " +
        "list replaces every link; an omitted list leaves the links unchanged.",
    }),
  topics: z
    .array(SlugSchema)
    .max(50)
    .meta({
      description:
        "Slugs of existing topics, each once, in their intended order. On an update the list " +
        "replaces every link; an omitted list leaves the links unchanged.",
    }),
};

/**
 * An exploration: independent work outside the career timeline, with an honest status and its
 * technologies and topics resolved. It belongs to no experience and is no delivered project.
 */
export const ExplorationSchema = z
  .object({
    id: z.uuid(),
    slug: SlugSchema,
    ...scalarFields,
    technologies: z
      .array(TechnologySchema)
      .meta({ description: "The linked technologies, in their intended order." }),
    topics: z
      .array(TopicSchema)
      .meta({ description: "The linked topics, in their intended order." }),
    ...timestamps,
  })
  .meta({ id: "Exploration" });

/** Every exploration, in the intended order. */
export const ExplorationListSchema = z
  .array(ExplorationSchema)
  .meta({ id: "ExplorationList", description: "Ordered by position, then slug." });

/**
 * Body of creating an exploration together with its technology and topic links. An omitted end
 * means an ongoing exploration; omitted concepts, technologies and topics are empty.
 */
export const ExplorationCreateSchema = z
  .strictObject({
    slug: SlugSchema,
    ...scalarFields,
    ...relationFields,
    endedOn: scalarFields.endedOn.default(null),
    concepts: scalarFields.concepts.default([]),
    technologies: relationFields.technologies.default([]),
    topics: relationFields.topics.default([]),
  })
  .superRefine(endFollowsStart)
  .superRefine(technologiesAreUnique)
  .superRefine(topicsAreUnique)
  .meta({ id: "ExplorationCreate" });

/**
 * Body of updating an exploration: at least one field; only the fields sent change and the slug
 * cannot be changed. A sent `concepts`, `technologies` or `topics` list replaces the stored one;
 * an omitted one keeps it. The period is checked against the stored start or end when only one of
 * them is sent.
 */
export const ExplorationUpdateSchema = z
  .strictObject({ ...scalarFields, ...relationFields })
  .partial()
  .refine((change) => Object.keys(change).length > 0, { message: "Change at least one field." })
  .superRefine(endFollowsStart)
  .superRefine(technologiesAreUnique)
  .superRefine(topicsAreUnique)
  .meta({ id: "ExplorationUpdate" });

export type ExplorationStatus = (typeof explorationStatuses)[number];
export type Exploration = z.infer<typeof ExplorationSchema>;
export type ExplorationCreate = z.output<typeof ExplorationCreateSchema>;
export type ExplorationUpdate = z.output<typeof ExplorationUpdateSchema>;
