import { z } from "zod";

import { key, SlugSchema, timestamps } from "./fields.js";

const NameSchema = z.string().trim().min(1).max(100);

/** Orders a record in its list, ascending; records with the same position are ordered by slug. */
const PositionSchema = z
  .int()
  .min(0)
  .max(1_000_000)
  .meta({ description: "Ascending order in the list; ties are ordered by slug." });

/** Path parameters of a route that addresses one record by its slug. */
export const SlugParamsSchema = z.strictObject({ slug: SlugSchema });

export const technologyTiers = ["primary", "secondary"] as const;
export const technologyGroups = ["core", "ai_engineering_focus"] as const;

const TierSchema = z.enum(technologyTiers).meta({
  description: "`primary` technologies are shown prominently, `secondary` ones as plain text.",
});
const GroupSchema = z
  .enum(technologyGroups)
  .nullable()
  .meta({
    description:
      "The group of a primary technology: `core` (with logos) or `ai_engineering_focus` " +
      "(plain text). A secondary technology has none.",
  });
const LogoKeySchema = key(
  "A key into the website's fixed set of static logos, for example `typescript`. Not an " +
    "uploaded file and not a URL.",
).nullable();

const GROUP_RULE = "A primary technology needs a group; a secondary technology has none.";

/** A primary technology has a group, a secondary one has none. Checked when both are known. */
function groupMatchesTier(
  value: { tier?: string | undefined; group?: string | null | undefined },
  context: z.core.$RefinementCtx,
) {
  if (value.tier === undefined || value.group === undefined) return;
  if ((value.tier === "primary") !== (value.group !== null)) {
    context.addIssue({ code: "custom", path: ["group"], message: GROUP_RULE });
  }
}

const technologyFields = {
  name: NameSchema,
  tier: TierSchema,
  group: GroupSchema,
  logoKey: LogoKeySchema,
  position: PositionSchema,
};

/** A technology: a tool or language, presented by its tier and, when primary, its group. */
export const TechnologySchema = z
  .object({ id: z.uuid(), slug: SlugSchema, ...technologyFields, ...timestamps })
  .meta({ id: "Technology" });

/** Every technology, ordered by tier, group, position and slug. */
export const TechnologyListSchema = z.array(TechnologySchema).meta({
  id: "TechnologyList",
  description:
    "Primary before secondary, `core` before `ai_engineering_focus`, then by position and slug.",
});

/** Body of creating a technology. An omitted group or logo key is `null`. */
export const TechnologyCreateSchema = z
  .strictObject({
    slug: SlugSchema,
    ...technologyFields,
    group: GroupSchema.default(null),
    logoKey: LogoKeySchema.default(null),
  })
  .superRefine(groupMatchesTier)
  .meta({ id: "TechnologyCreate" });

/**
 * Body of updating a technology: at least one field; only the fields sent change. The slug is
 * stable and cannot be changed. When the tier changes, send the matching group too.
 */
export const TechnologyUpdateSchema = z
  .strictObject(technologyFields)
  .partial()
  .refine((change) => Object.keys(change).length > 0, { message: "Change at least one field." })
  .superRefine(groupMatchesTier)
  .meta({ id: "TechnologyUpdate" });

const topicFields = { name: NameSchema, position: PositionSchema };

/** A topic: a subject such as RAG, MCP or agents that later profile records refer to. */
export const TopicSchema = z
  .object({ id: z.uuid(), slug: SlugSchema, ...topicFields, ...timestamps })
  .meta({ id: "Topic" });

/** Every topic, ordered by position and slug. */
export const TopicListSchema = z
  .array(TopicSchema)
  .meta({ id: "TopicList", description: "Ordered by position, then slug." });

/** Body of creating a topic. */
export const TopicCreateSchema = z
  .strictObject({ slug: SlugSchema, ...topicFields })
  .meta({ id: "TopicCreate" });

/** Body of updating a topic: at least one field; the slug cannot be changed. */
export const TopicUpdateSchema = z
  .strictObject(topicFields)
  .partial()
  .refine((change) => Object.keys(change).length > 0, { message: "Change at least one field." })
  .meta({ id: "TopicUpdate" });

export type SlugParams = z.infer<typeof SlugParamsSchema>;
export type TechnologyTier = (typeof technologyTiers)[number];
export type TechnologyGroup = (typeof technologyGroups)[number];
export type Technology = z.infer<typeof TechnologySchema>;
export type TechnologyCreate = z.output<typeof TechnologyCreateSchema>;
export type TechnologyUpdate = z.output<typeof TechnologyUpdateSchema>;
export type Topic = z.infer<typeof TopicSchema>;
export type TopicCreate = z.output<typeof TopicCreateSchema>;
export type TopicUpdate = z.output<typeof TopicUpdateSchema>;
