// The AI roadmap contracts: areas, their modules and the resources to learn from, as written and
// as read, and the whole tree with its derived progress. Topics are the profile's shared catalog.
import { z } from "zod";

import { SlugParamsSchema, TopicSchema } from "../profile/index.js";
import { roadmapResourceStatuses, roadmapResourceTypes } from "./catalogs.js";

export { roadmapResourceStatuses, roadmapResourceTypes };

/** The status an area or a module derives from its resources; it is never `paused`. */
export const roadmapDerivedStatuses = ["planned", "in-progress", "completed"] as const;

/** Slugs taken by the roadmap's own pages under `/ai-roadmap/`; no area may use them. */
export const reservedRoadmapAreaSlugs = [
  "diary",
  "bookshelf",
  "events",
  "how-to-read-effectively",
] as const;

const RESERVED_SLUG = "This slug is reserved for a roadmap page.";
const FINISH_RULE = "The finish cannot be before the start.";
const UNIQUE_TOPICS = "List each topic once.";

/** Trimmed, non-empty text of at most `max` characters. */
const text = (max: number) => z.string().trim().min(1).max(max);

const SlugSchema = SlugParamsSchema.shape.slug;

const DescriptionSchema = text(5000)
  .nullable()
  .meta({ description: "Markdown; `null` when there is none." });

const PositionSchema = z
  .int()
  .min(0)
  .max(1_000_000)
  .meta({ description: "Ascending order among its siblings; ties are ordered by slug." });

const InstantSchema = z.iso.datetime();

const timestamps = { createdAt: InstantSchema, updatedAt: InstantSchema };

/** Scalar fields of an area, the same when written and when read. */
const areaFields = {
  name: text(200),
  description: DescriptionSchema,
  weight: z.int().min(1).max(100).meta({
    description:
      "The recommended share of learning effort, 1 to 100. It is not progress and not logged time.",
  }),
  position: PositionSchema,
};

/** Scalar fields of a module, the same when written and when read. */
const moduleFields = { name: text(200), description: DescriptionSchema, position: PositionSchema };

/** Scalar fields of a resource, the same when written and when read. */
const resourceFields = {
  name: text(200),
  description: DescriptionSchema,
  type: z.enum(roadmapResourceTypes),
  status: z.enum(roadmapResourceStatuses),
  estimatedMinutes: z.int().min(0).max(1_000_000).nullable().meta({
    description: "Planned effort in minutes; `null` when unknown. It is not logged time.",
  }),
  startedAt: InstantSchema.nullable().meta({ description: "When studying started, if it did." }),
  finishedAt: InstantSchema.nullable().meta({
    description: "When studying finished, if it did; not before `startedAt`.",
  }),
  link: z
    .url({ protocol: /^https?$/, hostname: z.regexes.domain })
    .max(2048)
    .nullable()
    .meta({ description: "An absolute `http` or `https` address; `null` when there is none." }),
  position: PositionSchema,
};

const AreaSlugSchema = SlugSchema.refine(
  (slug) => !(reservedRoadmapAreaSlugs as readonly string[]).includes(slug),
  { message: RESERVED_SLUG },
).meta({
  description: `The stable address of the area; never ${reservedRoadmapAreaSlugs.join(", ")}.`,
});

const ParentAreaSchema = SlugSchema.meta({ description: "The slug of an existing area." });
const ParentModuleSchema = SlugSchema.meta({ description: "The slug of an existing module." });

const TopicSlugsSchema = z
  .array(SlugSchema)
  .max(50)
  .meta({
    description:
      "Slugs of existing topics, each once, in their intended order. On an update the list " +
      "replaces every link; an omitted list leaves them unchanged.",
  });

/** The finish is not before the start, checked when both are set in the same body. */
function finishFollowsStart(
  value: { startedAt?: string | null | undefined; finishedAt?: string | null | undefined },
  context: z.core.$RefinementCtx,
) {
  const { startedAt, finishedAt } = value;
  if (startedAt === undefined || startedAt === null) return;
  if (finishedAt === undefined || finishedAt === null) return;
  if (Date.parse(finishedAt) < Date.parse(startedAt)) {
    context.addIssue({ code: "custom", path: ["finishedAt"], message: FINISH_RULE });
  }
}

/** Every topic slug of a write appears once. */
function topicsAreUnique(value: { topics?: string[] | undefined }, context: z.core.$RefinementCtx) {
  const { topics } = value;
  if (topics !== undefined && new Set(topics).size !== topics.length) {
    context.addIssue({ code: "custom", path: ["topics"], message: UNIQUE_TOPICS });
  }
}

const nonEmpty = (change: object) => Object.keys(change).length > 0;
const NON_EMPTY = { message: "Change at least one field." };

/** An area: a top-level part of the roadmap. */
export const RoadmapAreaSchema = z
  .object({ id: z.uuid(), slug: SlugSchema, ...areaFields, ...timestamps })
  .meta({ id: "RoadmapArea" });

/** A module: an ordered part of one area. */
export const RoadmapModuleSchema = z
  .object({
    id: z.uuid(),
    slug: SlugSchema,
    area: SlugSchema.meta({ description: "The slug of the area it belongs to." }),
    ...moduleFields,
    ...timestamps,
  })
  .meta({ id: "RoadmapModule" });

/** A resource: one thing to learn from, in one module, with its topics resolved. */
export const RoadmapResourceSchema = z
  .object({
    id: z.uuid(),
    slug: SlugSchema,
    module: SlugSchema.meta({ description: "The slug of the module it belongs to." }),
    ...resourceFields,
    topics: z.array(TopicSchema).meta({ description: "The linked topics, in their order." }),
    ...timestamps,
  })
  .meta({ id: "RoadmapResource" });

/** Body of creating an area. An omitted description means none. */
export const RoadmapAreaCreateSchema = z
  .strictObject({
    slug: AreaSlugSchema,
    ...areaFields,
    description: areaFields.description.default(null),
  })
  .meta({ id: "RoadmapAreaCreate" });

/** Body of updating an area: at least one field; the slug cannot be changed. */
export const RoadmapAreaUpdateSchema = z
  .strictObject(areaFields)
  .partial()
  .refine(nonEmpty, NON_EMPTY)
  .meta({ id: "RoadmapAreaUpdate" });

/** Body of creating a module in an existing area. An omitted description means none. */
export const RoadmapModuleCreateSchema = z
  .strictObject({
    slug: SlugSchema,
    area: ParentAreaSchema,
    ...moduleFields,
    description: moduleFields.description.default(null),
  })
  .meta({ id: "RoadmapModuleCreate" });

/**
 * Body of updating a module: at least one field; the slug cannot be changed. A sent `area` moves
 * the module to that existing area.
 */
export const RoadmapModuleUpdateSchema = z
  .strictObject({ area: ParentAreaSchema, ...moduleFields })
  .partial()
  .refine(nonEmpty, NON_EMPTY)
  .meta({ id: "RoadmapModuleUpdate" });

/**
 * Body of creating a resource in an existing module with its topic links. Omitted fields mean a
 * planned resource without a description, estimate, dates, link or topics.
 */
export const RoadmapResourceCreateSchema = z
  .strictObject({
    slug: SlugSchema,
    module: ParentModuleSchema,
    ...resourceFields,
    description: resourceFields.description.default(null),
    status: resourceFields.status.default("planned"),
    estimatedMinutes: resourceFields.estimatedMinutes.default(null),
    startedAt: resourceFields.startedAt.default(null),
    finishedAt: resourceFields.finishedAt.default(null),
    link: resourceFields.link.default(null),
    topics: TopicSlugsSchema.default([]),
  })
  .superRefine(finishFollowsStart)
  .superRefine(topicsAreUnique)
  .meta({ id: "RoadmapResourceCreate" });

/**
 * Body of updating a resource: at least one field; the slug cannot be changed. A sent `module`
 * moves the resource, `null` clears an optional field, and a sent `topics` list replaces the links.
 * The finish may not end up before the start.
 */
export const RoadmapResourceUpdateSchema = z
  .strictObject({ module: ParentModuleSchema, ...resourceFields, topics: TopicSlugsSchema })
  .partial()
  .refine(nonEmpty, NON_EMPTY)
  .superRefine(finishFollowsStart)
  .superRefine(topicsAreUnique)
  .meta({ id: "RoadmapResourceUpdate" });

/** Derived progress of an area or a module; computed on read, never stored. */
export const RoadmapProgressSchema = z
  .object({
    completed: z.int().min(0).meta({ description: "Resources with the status `completed`." }),
    total: z.int().min(0).meta({ description: "All resources, whatever their status." }),
    status: z.enum(roadmapDerivedStatuses).meta({
      description:
        "`planned` when empty; `completed` when every resource is completed or skipped; " +
        "`in-progress` when any is in progress; otherwise `planned`. `in-progress` marks it current.",
    }),
    completedAt: InstantSchema.nullable().meta({
      description:
        "The latest finish among completed resources once the whole container is completed; " +
        "`null` otherwise or when no completed resource has a finish.",
    }),
    lastUpdatedAt: InstantSchema.nullable().meta({
      description: "The latest change of any of its resources; `null` when it has none.",
    }),
    estimatedMinutes: z.int().min(0).meta({
      description: "The sum of every resource estimate; a missing estimate counts as zero.",
    }),
  })
  .meta({ id: "RoadmapProgress" });

/** Totals of the whole roadmap. */
export const RoadmapSummarySchema = z
  .object({
    areaCount: z.int().min(0),
    moduleCount: z.int().min(0),
    resourceCount: z.int().min(0),
    completed: z.int().min(0).meta({ description: "Resources with the status `completed`." }),
    total: z.int().min(0).meta({ description: "All resources, whatever their status." }),
    estimatedMinutes: z.int().min(0).meta({
      description: "The sum of every resource estimate; a missing estimate counts as zero.",
    }),
    estimatedHours: z.int().min(0).meta({
      description: "`estimatedMinutes` divided by 60, rounded to the nearest whole hour.",
    }),
    lastUpdatedAt: InstantSchema.nullable().meta({
      description: "The latest change of any resource; `null` when there are none.",
    }),
  })
  .meta({ id: "RoadmapSummary" });

/** A resource inside the tree; its module is the enclosing node. */
export const RoadmapTreeResourceSchema = RoadmapResourceSchema.omit({ module: true }).meta({
  id: "RoadmapTreeResource",
});

/** A module inside the tree with its derived progress and its ordered resources. */
export const RoadmapTreeModuleSchema = RoadmapModuleSchema.omit({ area: true })
  .extend({ progress: RoadmapProgressSchema, resources: z.array(RoadmapTreeResourceSchema) })
  .meta({ id: "RoadmapTreeModule" });

/** An area inside the tree with its derived progress and its ordered modules. */
export const RoadmapTreeAreaSchema = RoadmapAreaSchema.extend({
  progress: RoadmapProgressSchema,
  modules: z.array(RoadmapTreeModuleSchema),
}).meta({ id: "RoadmapTreeArea" });

/** The whole roadmap in one read: ordered areas, modules and resources with derived progress. */
export const RoadmapSchema = z
  .object({ summary: RoadmapSummarySchema, areas: z.array(RoadmapTreeAreaSchema) })
  .meta({
    id: "Roadmap",
    description: "Every level is ordered by position, then slug.",
  });

/** The address of an area page: `/v1/roadmap/tree/{area}`. */
export const RoadmapAreaParamsSchema = z.strictObject({
  area: SlugSchema.meta({ description: "The slug of the area." }),
});

/** The address of a module page inside its area: `/v1/roadmap/tree/{area}/{module}`. */
export const RoadmapModuleParamsSchema = z.strictObject({
  area: SlugSchema.meta({ description: "The slug of the area the module belongs to." }),
  module: SlugSchema.meta({ description: "The slug of the module." }),
});

/** One area as the overview shows it: the same node, progress and ordering as in `Roadmap`. */
export const RoadmapAreaDetailSchema = z.object({ area: RoadmapTreeAreaSchema }).meta({
  id: "RoadmapAreaDetail",
  description: "The area node of the roadmap tree, with its modules and their resources.",
});

/** One module as the overview shows it, with the area it belongs to for navigation. */
export const RoadmapModuleDetailSchema = z
  .object({ area: RoadmapAreaSchema, module: RoadmapTreeModuleSchema })
  .meta({
    id: "RoadmapModuleDetail",
    description: "The module node of the roadmap tree and the area that holds it.",
  });

const InProgressSchema = RoadmapProgressSchema.extend({
  status: z.literal("in-progress").meta({ description: "Always `in-progress` here." }),
});

/** A module whose derived status is `in-progress`, without its resources. */
export const RoadmapCurrentModuleSchema = RoadmapModuleSchema.omit({ area: true })
  .extend({ progress: InProgressSchema })
  .meta({ id: "RoadmapCurrentModule" });

/** An area whose derived status is `in-progress` with its modules that are. */
export const RoadmapCurrentAreaSchema = RoadmapAreaSchema.extend({
  progress: InProgressSchema,
  modules: z.array(RoadmapCurrentModuleSchema),
}).meta({ id: "RoadmapCurrentArea" });

/** What is being learned now: the in-progress areas and modules, in roadmap order. */
export const RoadmapCurrentSchema = z.object({ areas: z.array(RoadmapCurrentAreaSchema) }).meta({
  id: "RoadmapCurrent",
  description:
    "The areas and modules whose derived status is `in-progress`, in the order of the roadmap; empty when nothing is.",
});

export type RoadmapResourceType = (typeof roadmapResourceTypes)[number];
export type RoadmapResourceStatus = (typeof roadmapResourceStatuses)[number];
export type RoadmapDerivedStatus = (typeof roadmapDerivedStatuses)[number];
export type RoadmapArea = z.infer<typeof RoadmapAreaSchema>;
export type RoadmapModule = z.infer<typeof RoadmapModuleSchema>;
export type RoadmapResource = z.infer<typeof RoadmapResourceSchema>;
export type RoadmapAreaCreate = z.output<typeof RoadmapAreaCreateSchema>;
export type RoadmapAreaUpdate = z.output<typeof RoadmapAreaUpdateSchema>;
export type RoadmapModuleCreate = z.output<typeof RoadmapModuleCreateSchema>;
export type RoadmapModuleUpdate = z.output<typeof RoadmapModuleUpdateSchema>;
export type RoadmapResourceCreate = z.output<typeof RoadmapResourceCreateSchema>;
export type RoadmapResourceUpdate = z.output<typeof RoadmapResourceUpdateSchema>;
export type RoadmapProgress = z.infer<typeof RoadmapProgressSchema>;
export type RoadmapSummary = z.infer<typeof RoadmapSummarySchema>;
export type RoadmapTreeResource = z.infer<typeof RoadmapTreeResourceSchema>;
export type RoadmapTreeModule = z.infer<typeof RoadmapTreeModuleSchema>;
export type RoadmapTreeArea = z.infer<typeof RoadmapTreeAreaSchema>;
export type Roadmap = z.infer<typeof RoadmapSchema>;
export type RoadmapAreaParams = z.infer<typeof RoadmapAreaParamsSchema>;
export type RoadmapModuleParams = z.infer<typeof RoadmapModuleParamsSchema>;
export type RoadmapAreaDetail = z.infer<typeof RoadmapAreaDetailSchema>;
export type RoadmapModuleDetail = z.infer<typeof RoadmapModuleDetailSchema>;
export type RoadmapCurrentModule = z.infer<typeof RoadmapCurrentModuleSchema>;
export type RoadmapCurrentArea = z.infer<typeof RoadmapCurrentAreaSchema>;
export type RoadmapCurrent = z.infer<typeof RoadmapCurrentSchema>;

export {
  DiaryDateParamsSchema,
  DiaryDateSchema,
  DiaryDaySchema,
  DiaryNotesWriteSchema,
  DiaryResourceSchema,
  DiarySchema,
  TimeEntryCreateSchema,
  TimeEntryIdParamsSchema,
  TimeEntrySchema,
  TimeEntryUpdateSchema,
  TimeEntryWriteSchema,
  diaryTimeZone,
} from "./diary.js";
export type {
  Diary,
  DiaryDateParams,
  DiaryDay,
  DiaryNotesWrite,
  DiaryResource,
  TimeEntry,
  TimeEntryCreate,
  TimeEntryIdParams,
  TimeEntryUpdate,
  TimeEntryWrite,
} from "./diary.js";
