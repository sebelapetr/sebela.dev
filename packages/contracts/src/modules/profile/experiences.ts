import { z } from "zod";

import { TechnologySchema } from "./catalogs.js";
import {
  DateSchema,
  endFollowsStart,
  SlugSchema,
  technologiesAreUnique,
  text,
  timestamps,
} from "./fields.js";
import { OrganizationSchema } from "./organizations.js";
import { ProjectSchema } from "./projects.js";
import { TestimonialSchema } from "./testimonials.js";

export const experienceKinds = ["main_job", "side_project", "own_business"] as const;

const KindSchema = z
  .enum(experienceKinds)
  .meta({ description: "A `main_job`, a `side_project` or an `own_business`." });

/** Scalar fields of an experience, the same when written and when read. */
const scalarFields = {
  title: text(200),
  kind: KindSchema,
  startedOn: DateSchema.meta({ description: "The first day of the role, an ISO date." }),
  endedOn: DateSchema.nullable().meta({
    description: "The last day of the role, an ISO date; `null` marks a current role.",
  }),
  summary: text(5000).meta({ description: "Markdown." }),
  responsibilities: z
    .array(text(500))
    .max(30)
    .meta({ description: "Plain-text responsibilities, in their intended order." }),
  inCv: z.boolean().meta({ description: "Whether the experience appears in the CV." }),
};

/** Relations of an experience as written: the slugs of existing records. */
const relationFields = {
  organization: SlugSchema.meta({ description: "The slug of an existing organization." }),
  technologies: z
    .array(SlugSchema)
    .max(50)
    .meta({
      description:
        "Slugs of existing technologies, each once, in their intended order. On an update the " +
        "list replaces every link; an omitted list leaves the links unchanged.",
    }),
};

/**
 * An experience: a role at an organization over a period, with its technologies, its projects and
 * its testimonials resolved.
 */
export const ExperienceSchema = z
  .object({
    id: z.uuid(),
    slug: SlugSchema,
    ...scalarFields,
    organization: OrganizationSchema,
    technologies: z
      .array(TechnologySchema)
      .meta({ description: "The linked technologies, in their intended order." }),
    projects: z.array(ProjectSchema).meta({
      description:
        "The projects delivered within the experience, by position, then slug; each says " +
        "whether it is selected for the homepage.",
    }),
    testimonials: z.array(TestimonialSchema).meta({
      description:
        "The quotes of clients and colleagues about the experience, by position, then slug; the " +
        "organization above is their context.",
    }),
    ...timestamps,
  })
  .meta({ id: "Experience" });

/** Every experience, current roles first, then the latest start first. */
export const ExperienceListSchema = z.array(ExperienceSchema).meta({
  id: "ExperienceList",
  description:
    "Current roles (no end) first, then by start, latest first, then by end, latest first, " +
    "then by slug.",
});

/**
 * Body of creating an experience together with its technology links. An omitted end means a
 * current role; omitted responsibilities and technologies are empty.
 */
export const ExperienceCreateSchema = z
  .strictObject({
    slug: SlugSchema,
    ...scalarFields,
    ...relationFields,
    endedOn: scalarFields.endedOn.default(null),
    responsibilities: scalarFields.responsibilities.default([]),
    technologies: relationFields.technologies.default([]),
  })
  .superRefine(endFollowsStart)
  .superRefine(technologiesAreUnique)
  .meta({ id: "ExperienceCreate" });

/**
 * Body of updating an experience: at least one field; only the fields sent change and the slug
 * cannot be changed. A sent `technologies` list replaces every link; an omitted one keeps them.
 * The period is checked against the stored start or end when only one of them is sent.
 */
export const ExperienceUpdateSchema = z
  .strictObject({ ...scalarFields, ...relationFields })
  .partial()
  .refine((change) => Object.keys(change).length > 0, { message: "Change at least one field." })
  .superRefine(endFollowsStart)
  .superRefine(technologiesAreUnique)
  .meta({ id: "ExperienceUpdate" });

export type ExperienceKind = (typeof experienceKinds)[number];
export type Experience = z.infer<typeof ExperienceSchema>;
export type ExperienceCreate = z.output<typeof ExperienceCreateSchema>;
export type ExperienceUpdate = z.output<typeof ExperienceUpdateSchema>;
