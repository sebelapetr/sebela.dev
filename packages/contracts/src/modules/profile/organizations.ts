import { z } from "zod";

import { HttpUrlSchema, SlugSchema, text, timestamps } from "./fields.js";

/**
 * Writable fields of an organization. Its logo is not one of them yet: it is attached once media
 * exists, so a body cannot carry an unresolved logo reference.
 */
const organizationFields = {
  name: text(200),
  website: HttpUrlSchema.nullable().meta({ description: "The organization's own website." }),
  description: text(5000).nullable().meta({ description: "Markdown." }),
};

/** An organization: a company or client that experiences refer to. */
export const OrganizationSchema = z
  .object({ id: z.uuid(), slug: SlugSchema, ...organizationFields, ...timestamps })
  .meta({ id: "Organization" });

/** Every organization, ordered by name and slug. */
export const OrganizationListSchema = z.array(OrganizationSchema).meta({
  id: "OrganizationList",
  description: "Ordered by name, ignoring case, then by slug.",
});

/** Body of creating an organization. An omitted website or description is `null`. */
export const OrganizationCreateSchema = z
  .strictObject({
    slug: SlugSchema,
    ...organizationFields,
    website: organizationFields.website.default(null),
    description: organizationFields.description.default(null),
  })
  .meta({ id: "OrganizationCreate" });

/** Body of updating an organization: at least one field; the slug cannot be changed. */
export const OrganizationUpdateSchema = z
  .strictObject(organizationFields)
  .partial()
  .refine((change) => Object.keys(change).length > 0, { message: "Change at least one field." })
  .meta({ id: "OrganizationUpdate" });

export type Organization = z.infer<typeof OrganizationSchema>;
export type OrganizationCreate = z.output<typeof OrganizationCreateSchema>;
export type OrganizationUpdate = z.output<typeof OrganizationUpdateSchema>;
