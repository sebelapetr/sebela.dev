import { z } from "zod";

import { CaseStudySchema } from "./case-studies.js";
import { PositionSchema, TechnologySchema } from "./catalogs.js";
import {
  DateSchema,
  endFollowsStart,
  HttpUrlSchema,
  mediaReference,
  SlugSchema,
  technologiesAreUnique,
  text,
  timestamps,
} from "./fields.js";

/** A labelled outside link of a project, such as its product page or repository. */
export const ProjectLinkSchema = z
  .strictObject({
    label: text(100).meta({ description: "What the link leads to, for example `Repository`." }),
    url: HttpUrlSchema,
  })
  .meta({ id: "ProjectLink" });

/** Scalar fields of a project, the same when written and when read. */
const scalarFields = {
  name: text(200),
  summary: text(5000).meta({ description: "Markdown." }),
  problem: text(5000).meta({ description: "The problem the project solved. Markdown." }),
  workDone: text(10000).meta({ description: "The work done on the project. Markdown." }),
  result: text(5000).meta({ description: "What the project achieved. Markdown." }),
  startedOn: DateSchema.meta({ description: "The first day of the project, an ISO date." }),
  endedOn: DateSchema.nullable().meta({
    description: "The last day of the project, an ISO date; `null` marks an ongoing project.",
  }),
  links: z
    .array(ProjectLinkSchema)
    .max(20)
    .meta({ description: "Outside links, in their intended order." }),
  selectedForHomepage: z
    .boolean()
    .meta({ description: "Whether the project is selected for the homepage." }),
  position: PositionSchema.meta({
    description: "Ascending order within the owning experience; ties are ordered by slug.",
  }),
  coverId: mediaReference("The identifier of the project's cover, an uploaded image."),
};

const ExperienceSlugSchema = SlugSchema.meta({
  description: "The slug of the experience the project belongs to; every project has exactly one.",
});

/** Relations of a project as written: the slugs of existing records. */
const relationFields = {
  experience: ExperienceSlugSchema.meta({
    description:
      "The slug of the existing experience the project belongs to. On an update it moves the " +
      "project to that experience.",
  }),
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
 * A project delivered within one experience, with its technologies and its case study resolved. The
 * owning experience is named by its slug.
 */
export const ProjectSchema = z
  .object({
    id: z.uuid(),
    slug: SlugSchema,
    experience: ExperienceSlugSchema,
    ...scalarFields,
    technologies: z
      .array(TechnologySchema)
      .meta({ description: "The linked technologies, in their intended order." }),
    caseStudy: CaseStudySchema.nullable().meta({
      description:
        "The long-form case study of the project, or `null` while it has none. It is written at " +
        "`/v1/projects/{slug}/case-study`, never in a project body.",
    }),
    ...timestamps,
  })
  .meta({ id: "Project" });

/** Every project, grouped by experience in the experience order, then by position and slug. */
export const ProjectListSchema = z.array(ProjectSchema).meta({
  id: "ProjectList",
  description:
    "Grouped by owning experience in the experience order, then by position, then by slug.",
});

/**
 * Body of creating a project in an existing experience together with its technology links. An
 * omitted end means an ongoing project; omitted links and technologies are empty, an omitted
 * homepage selection is `false` and an omitted cover is `null`.
 */
export const ProjectCreateSchema = z
  .strictObject({
    slug: SlugSchema,
    ...scalarFields,
    ...relationFields,
    endedOn: scalarFields.endedOn.default(null),
    links: scalarFields.links.default([]),
    selectedForHomepage: scalarFields.selectedForHomepage.default(false),
    coverId: scalarFields.coverId.default(null),
    technologies: relationFields.technologies.default([]),
  })
  .superRefine(endFollowsStart)
  .superRefine(technologiesAreUnique)
  .meta({ id: "ProjectCreate" });

/**
 * Body of updating a project: at least one field; only the fields sent change and the slug cannot
 * be changed. A sent `experience` moves the project; a sent `technologies` list replaces every
 * link. The period is checked against the stored start or end when only one of them is sent.
 */
export const ProjectUpdateSchema = z
  .strictObject({ ...scalarFields, ...relationFields })
  .partial()
  .refine((change) => Object.keys(change).length > 0, { message: "Change at least one field." })
  .superRefine(endFollowsStart)
  .superRefine(technologiesAreUnique)
  .meta({ id: "ProjectUpdate" });

export type ProjectLink = z.infer<typeof ProjectLinkSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type ProjectCreate = z.output<typeof ProjectCreateSchema>;
export type ProjectUpdate = z.output<typeof ProjectUpdateSchema>;
