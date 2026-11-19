// The supporting content of the roadmap, private to the roadmap module and re-exported by its
// entry: project ideas, followed sources ("stay current") and glossary terms ("additional terms"),
// as written and as read. Each is an ordered, slugged list of its own, unrelated to areas, modules
// or the diary; a project idea links the profile's shared topics.
import { z } from "zod";

import { SlugParamsSchema, TopicSchema } from "../profile/index.js";

const UNIQUE_TOPICS = "List each topic once.";
const NON_EMPTY = { message: "Change at least one field." };

/** Trimmed, non-empty text of at most `max` characters. */
const text = (max: number) => z.string().trim().min(1).max(max);

const SlugSchema = SlugParamsSchema.shape.slug.meta({
  description: "The stable identity of the record and its anchor on the website.",
});

const InstantSchema = z.iso.datetime();

const timestamps = { createdAt: InstantSchema, updatedAt: InstantSchema };

const PositionSchema = z
  .int()
  .min(0)
  .max(1_000_000)
  .meta({ description: "Ascending order in its list; ties are ordered by slug." });

const MarkdownSchema = text(20_000).meta({ description: "Markdown." });

const OptionalMarkdownSchema = text(20_000)
  .nullable()
  .meta({ description: "Markdown; `null` when there is none." });

const LinkSchema = z
  .url({ protocol: /^https?$/, hostname: z.regexes.domain })
  .max(2048)
  .nullable()
  .meta({ description: "An absolute `http` or `https` address; `null` when there is none." });

const TopicSlugsSchema = z
  .array(SlugParamsSchema.shape.slug)
  .max(50)
  .meta({
    description:
      "Slugs of existing shared topics, each once, in their intended order. On an update the " +
      "list replaces every link; an omitted list leaves them unchanged.",
  });

/** Every topic slug of a write appears once. */
function topicsAreUnique(value: { topics?: string[] | undefined }, context: z.core.$RefinementCtx) {
  const { topics } = value;
  if (topics !== undefined && new Set(topics).size !== topics.length) {
    context.addIssue({ code: "custom", path: ["topics"], message: UNIQUE_TOPICS });
  }
}

const nonEmpty = (change: object) => Object.keys(change).length > 0;

/** Scalar fields of a project idea, the same when written and when read. */
const ideaFields = {
  title: text(200),
  whyItMatters: MarkdownSchema.meta({ description: "Why the project is worth doing, Markdown." }),
  howToStart: OptionalMarkdownSchema.meta({
    description: "How to begin, Markdown; `null` when there is no advice yet.",
  }),
  position: PositionSchema,
};

/** Scalar fields of a followed source, the same when written and when read. */
const sourceFields = {
  title: text(200),
  description: OptionalMarkdownSchema,
  link: LinkSchema,
  kind: text(100).meta({
    description:
      "A short label of what the source is, for example `newsletter`, `podcast` or `blog`; " +
      "free text, shown as written.",
  }),
  position: PositionSchema,
};

/** Scalar fields of a glossary term, the same when written and when read. */
const termFields = {
  term: text(200),
  description: MarkdownSchema.meta({ description: "What the term means, Markdown." }),
  position: PositionSchema,
};

/** A project idea worth building to learn, with its shared topics. */
export const RoadmapProjectIdeaSchema = z
  .object({
    id: z.uuid(),
    slug: SlugSchema,
    ...ideaFields,
    topics: z.array(TopicSchema).meta({ description: "The linked topics, in their order." }),
    ...timestamps,
  })
  .meta({ id: "RoadmapProjectIdea" });

/** Every project idea in its order. */
export const RoadmapProjectIdeaListSchema = z.array(RoadmapProjectIdeaSchema).meta({
  id: "RoadmapProjectIdeaList",
  description: "Ordered by position, then slug.",
});

/** Body of creating a project idea. An omitted way to start means none; omitted topics none. */
export const RoadmapProjectIdeaCreateSchema = z
  .strictObject({
    slug: SlugSchema,
    ...ideaFields,
    howToStart: ideaFields.howToStart.default(null),
    topics: TopicSlugsSchema.default([]),
  })
  .superRefine(topicsAreUnique)
  .meta({ id: "RoadmapProjectIdeaCreate" });

/**
 * Body of updating a project idea: at least one field; the slug cannot change, `null` clears the
 * way to start and a sent `topics` list replaces the links.
 */
export const RoadmapProjectIdeaUpdateSchema = z
  .strictObject({ ...ideaFields, topics: TopicSlugsSchema })
  .partial()
  .refine(nonEmpty, NON_EMPTY)
  .superRefine(topicsAreUnique)
  .meta({ id: "RoadmapProjectIdeaUpdate" });

/** A source followed to stay current. */
export const RoadmapFollowedSourceSchema = z
  .object({ id: z.uuid(), slug: SlugSchema, ...sourceFields, ...timestamps })
  .meta({ id: "RoadmapFollowedSource" });

/** Every followed source in its order. */
export const RoadmapFollowedSourceListSchema = z.array(RoadmapFollowedSourceSchema).meta({
  id: "RoadmapFollowedSourceList",
  description: "Ordered by position, then slug.",
});

/** Body of creating a followed source. An omitted description or link means none. */
export const RoadmapFollowedSourceCreateSchema = z
  .strictObject({
    slug: SlugSchema,
    ...sourceFields,
    description: sourceFields.description.default(null),
    link: sourceFields.link.default(null),
  })
  .meta({ id: "RoadmapFollowedSourceCreate" });

/** Body of updating a followed source: at least one field; `null` clears an optional one. */
export const RoadmapFollowedSourceUpdateSchema = z
  .strictObject(sourceFields)
  .partial()
  .refine(nonEmpty, NON_EMPTY)
  .meta({ id: "RoadmapFollowedSourceUpdate" });

/** An additional term explained beside the roadmap. */
export const RoadmapGlossaryTermSchema = z
  .object({ id: z.uuid(), slug: SlugSchema, ...termFields, ...timestamps })
  .meta({ id: "RoadmapGlossaryTerm" });

/** Every glossary term in its order. */
export const RoadmapGlossaryTermListSchema = z.array(RoadmapGlossaryTermSchema).meta({
  id: "RoadmapGlossaryTermList",
  description: "Ordered by position, then slug.",
});

/** Body of creating a glossary term. */
export const RoadmapGlossaryTermCreateSchema = z
  .strictObject({ slug: SlugSchema, ...termFields })
  .meta({ id: "RoadmapGlossaryTermCreate" });

/** Body of updating a glossary term: at least one field; the slug cannot change. */
export const RoadmapGlossaryTermUpdateSchema = z
  .strictObject(termFields)
  .partial()
  .refine(nonEmpty, NON_EMPTY)
  .meta({ id: "RoadmapGlossaryTermUpdate" });

export type RoadmapProjectIdea = z.infer<typeof RoadmapProjectIdeaSchema>;
export type RoadmapProjectIdeaList = z.infer<typeof RoadmapProjectIdeaListSchema>;
export type RoadmapProjectIdeaCreate = z.output<typeof RoadmapProjectIdeaCreateSchema>;
export type RoadmapProjectIdeaUpdate = z.output<typeof RoadmapProjectIdeaUpdateSchema>;
export type RoadmapFollowedSource = z.infer<typeof RoadmapFollowedSourceSchema>;
export type RoadmapFollowedSourceList = z.infer<typeof RoadmapFollowedSourceListSchema>;
export type RoadmapFollowedSourceCreate = z.output<typeof RoadmapFollowedSourceCreateSchema>;
export type RoadmapFollowedSourceUpdate = z.output<typeof RoadmapFollowedSourceUpdateSchema>;
export type RoadmapGlossaryTerm = z.infer<typeof RoadmapGlossaryTermSchema>;
export type RoadmapGlossaryTermList = z.infer<typeof RoadmapGlossaryTermListSchema>;
export type RoadmapGlossaryTermCreate = z.output<typeof RoadmapGlossaryTermCreateSchema>;
export type RoadmapGlossaryTermUpdate = z.output<typeof RoadmapGlossaryTermUpdateSchema>;
