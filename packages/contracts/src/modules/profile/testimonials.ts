import { z } from "zod";

import { PositionSchema } from "./catalogs.js";
import { mediaReference, SlugSchema, text, timestamps } from "./fields.js";

/** Scalar fields of a testimonial, the same when written and when read. */
const scalarFields = {
  quote: text(2000).meta({
    description: "What the author said, plain text without quotation marks.",
  }),
  authorName: text(200).meta({ description: "The name of the client or colleague who said it." }),
  authorRole: text(200).meta({
    description:
      "The author's role, for example `Head of Operations`; the organization comes from the " +
      "experience.",
  }),
  position: PositionSchema.meta({
    description: "Ascending order within the experience; ties are ordered by slug.",
  }),
  authorPhotoId: mediaReference(
    "The identifier of the author's photo, an uploaded image; `null` without one.",
  ),
};

const ExperienceSlugSchema = SlugSchema.meta({
  description:
    "The slug of the experience the testimonial belongs to; every testimonial has exactly one.",
});

/** A quote from a client or colleague, which names the experience it belongs to by slug. */
export const TestimonialSchema = z
  .object({
    id: z.uuid(),
    slug: SlugSchema,
    experience: ExperienceSlugSchema,
    ...scalarFields,
    ...timestamps,
  })
  .meta({ id: "Testimonial" });

/** Every testimonial, grouped by experience in the experience order, then by position and slug. */
export const TestimonialListSchema = z.array(TestimonialSchema).meta({
  id: "TestimonialList",
  description: "Grouped by experience in the experience order, then by position, then by slug.",
});

const relationFields = {
  experience: ExperienceSlugSchema.meta({
    description:
      "The slug of the existing experience the testimonial belongs to. On an update it moves the " +
      "testimonial to that experience.",
  }),
};

/**
 * Body of creating a testimonial in an existing experience. Every field is required except the
 * author photo, which is `null` when omitted.
 */
export const TestimonialCreateSchema = z
  .strictObject({
    slug: SlugSchema,
    ...relationFields,
    ...scalarFields,
    authorPhotoId: scalarFields.authorPhotoId.default(null),
  })
  .meta({ id: "TestimonialCreate" });

/**
 * Body of updating a testimonial: at least one field; only the fields sent change and the slug
 * cannot be changed. A sent `experience` moves the testimonial; `authorPhotoId: null` clears the
 * photo.
 */
export const TestimonialUpdateSchema = z
  .strictObject({ ...relationFields, ...scalarFields })
  .partial()
  .refine((change) => Object.keys(change).length > 0, { message: "Change at least one field." })
  .meta({ id: "TestimonialUpdate" });

export type Testimonial = z.infer<typeof TestimonialSchema>;
export type TestimonialCreate = z.output<typeof TestimonialCreateSchema>;
export type TestimonialUpdate = z.output<typeof TestimonialUpdateSchema>;
