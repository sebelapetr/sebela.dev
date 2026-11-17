import { z } from "zod";

import { SlugSchema, text, timestamps } from "./fields.js";

/** The narrative of a case study, the same when written and when read. */
const narrativeFields = {
  role: text(500).meta({
    description:
      "The person's own role in the project, as plain text, for example `Lead engineer`.",
  }),
  body: text(50000).meta({
    description: "The long-form account of the project. Markdown, stored as written; never HTML.",
  }),
};

/**
 * The long-form case study of a project. A project has at most one; it is addressed through its
 * project at `/v1/projects/{slug}/case-study`.
 */
export const CaseStudySchema = z
  .object({
    id: z.uuid(),
    project: SlugSchema.meta({ description: "The slug of the project the case study explains." }),
    ...narrativeFields,
    ...timestamps,
  })
  .meta({ id: "CaseStudy" });

/** Body of creating the case study of a project; the project is named by the address. */
export const CaseStudyCreateSchema = z
  .strictObject(narrativeFields)
  .meta({ id: "CaseStudyCreate" });

/** Body of updating a case study: at least one field; only the fields sent change. */
export const CaseStudyUpdateSchema = z
  .strictObject(narrativeFields)
  .partial()
  .refine((change) => Object.keys(change).length > 0, { message: "Change at least one field." })
  .meta({ id: "CaseStudyUpdate" });

export type CaseStudy = z.infer<typeof CaseStudySchema>;
export type CaseStudyCreate = z.output<typeof CaseStudyCreateSchema>;
export type CaseStudyUpdate = z.output<typeof CaseStudyUpdateSchema>;
