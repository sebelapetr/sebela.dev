import { z } from "zod";

import { HttpUrlSchema, mediaReference, text } from "./fields.js";

export const PersonLinkSchema = z
  .strictObject({
    label: text(100),
    url: HttpUrlSchema,
  })
  .meta({ id: "PersonLink", description: "A link of the person, in its intended order." });

/** Required writable fields of the person. */
const required = {
  name: text(200),
  headline: text(300),
  shortBio: text(2000).meta({ description: "Markdown." }),
};

/** Optional writable fields of the person; `null` means not set. */
const optional = {
  longBio: text(20000).nullable().meta({ description: "Markdown." }),
  location: text(200).nullable(),
  email: z.email().max(320).nullable(),
  links: z.array(PersonLinkSchema).max(20),
  availability: text(500).nullable(),
  careerStartedOn: z.iso.date().nullable().meta({ description: "The date the career started." }),
  photoId: mediaReference("The identifier of the person's photo, an uploaded image."),
  cvPdfId: mediaReference(
    "The identifier of the current CV PDF, an uploaded, manually prepared PDF. It is never generated.",
  ),
};

/** The person, the singleton profile record. */
export const PersonSchema = z
  .object({
    id: z.uuid(),
    ...required,
    ...optional,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "Person" });

/** Body of creating the person. Unknown fields are rejected; unset optional fields become empty. */
export const PersonCreateSchema = z
  .strictObject({
    ...required,
    longBio: optional.longBio.default(null),
    location: optional.location.default(null),
    email: optional.email.default(null),
    links: optional.links.default([]),
    availability: optional.availability.default(null),
    careerStartedOn: optional.careerStartedOn.default(null),
    photoId: optional.photoId.default(null),
    cvPdfId: optional.cvPdfId.default(null),
  })
  .meta({ id: "PersonCreate" });

/** Body of updating the person: at least one field; only the fields sent are changed. */
export const PersonUpdateSchema = z
  .strictObject({ ...required, ...optional })
  .partial()
  .refine((change) => Object.keys(change).length > 0, { message: "Change at least one field." })
  .meta({ id: "PersonUpdate" });

export type PersonLink = z.infer<typeof PersonLinkSchema>;
export type Person = z.infer<typeof PersonSchema>;
export type PersonCreate = z.output<typeof PersonCreateSchema>;
export type PersonUpdate = z.output<typeof PersonUpdateSchema>;
