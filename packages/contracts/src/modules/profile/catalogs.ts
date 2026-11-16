import { z } from "zod";

// Skeleton: shapes only, the rules follow.
export const SlugParamsSchema = z.object({ slug: z.string() });

const technology = {
  slug: z.string(),
  name: z.string(),
  tier: z.string(),
  group: z.string().nullable(),
  logoKey: z.string().nullable(),
  position: z.number(),
};

export const TechnologySchema = z.object({
  id: z.string(),
  ...technology,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const TechnologyListSchema = z.array(TechnologySchema);
export const TechnologyCreateSchema = z.object({
  ...technology,
  group: technology.group.default(null),
  logoKey: technology.logoKey.default(null),
});
export const TechnologyUpdateSchema = z.object(technology).partial();

const topic = { slug: z.string(), name: z.string(), position: z.number() };

export const TopicSchema = z.object({
  id: z.string(),
  ...topic,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const TopicListSchema = z.array(TopicSchema);
export const TopicCreateSchema = z.object(topic);
export const TopicUpdateSchema = z.object(topic).partial();
