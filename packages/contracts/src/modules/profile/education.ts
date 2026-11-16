import { z } from "zod";

import { PositionSchema } from "./catalogs.js";
import { DateSchema, endFollowsStart, SlugSchema, text, timestamps } from "./fields.js";

/** What kind of learning an education record is. */
export const educationKinds = ["school", "course", "certification", "milestone"] as const;

const KindSchema = z.enum(educationKinds).meta({
  description:
    "`school` (a formal study programme), `course`, `certification` or `milestone` (any other " +
    "learning achievement).",
});

/** Scalar fields of an education record, the same when written and when read. */
const scalarFields = {
  kind: KindSchema,
  title: text(200),
  institution: text(200)
    .nullable()
    .meta({ description: "The school, provider or issuer; `null` when there is none." }),
  startedOn: DateSchema.nullable().meta({
    description:
      "The first day, an ISO date; `null` when only the day of completion is known, as for a " +
      "certification awarded on one day.",
  }),
  endedOn: DateSchema.nullable().meta({
    description:
      "The day of completion, an ISO date, not before the start; `null` with a start marks " +
      "ongoing learning. At least one of `startedOn` and `endedOn` is set.",
  }),
  description: text(5000).nullable().meta({ description: "Markdown; `null` when there is none." }),
  position: PositionSchema,
};

const DATE_RULE = "Give the start, the end or both.";

/** At least one date is set. Checked when both dates are in the same body. */
function periodIsDated(
  value: { startedOn?: string | null | undefined; endedOn?: string | null | undefined },
  context: z.core.$RefinementCtx,
) {
  if (value.startedOn !== null || value.endedOn !== null) return;
  context.addIssue({ code: "custom", path: ["startedOn"], message: DATE_RULE });
  context.addIssue({ code: "custom", path: ["endedOn"], message: DATE_RULE });
}

/**
 * Education: a school, course, certification or other learning milestone. Its period is
 * flexible: a start and an end, a start alone (ongoing) or an end alone (completed on that day).
 */
export const EducationSchema = z
  .object({ id: z.uuid(), slug: SlugSchema, ...scalarFields, ...timestamps })
  .meta({ id: "Education" });

/** Every education record, in the intended order. */
export const EducationListSchema = z
  .array(EducationSchema)
  .meta({ id: "EducationList", description: "Ordered by position, then slug." });

/**
 * Body of creating an education record. An omitted institution, description or date is `null`;
 * at least one date is required and the end is not before the start.
 */
export const EducationCreateSchema = z
  .strictObject({
    slug: SlugSchema,
    ...scalarFields,
    institution: scalarFields.institution.default(null),
    startedOn: scalarFields.startedOn.default(null),
    endedOn: scalarFields.endedOn.default(null),
    description: scalarFields.description.default(null),
  })
  .superRefine(periodIsDated)
  .superRefine(endFollowsStart)
  .meta({ id: "EducationCreate" });

/**
 * Body of updating an education record: at least one field; only the fields sent change and the
 * slug cannot be changed. The period is checked against the stored start or end when only one of
 * them is sent.
 */
export const EducationUpdateSchema = z
  .strictObject(scalarFields)
  .partial()
  .refine((change) => Object.keys(change).length > 0, { message: "Change at least one field." })
  .superRefine((change, context) => {
    if (change.startedOn !== undefined && change.endedOn !== undefined) {
      periodIsDated(change, context);
    }
  })
  .superRefine(endFollowsStart)
  .meta({ id: "EducationUpdate" });

export type EducationKind = (typeof educationKinds)[number];
export type Education = z.infer<typeof EducationSchema>;
export type EducationCreate = z.output<typeof EducationCreateSchema>;
export type EducationUpdate = z.output<typeof EducationUpdateSchema>;
