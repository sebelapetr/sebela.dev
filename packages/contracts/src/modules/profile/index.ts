import { z } from "zod";

// Interface first: the schemas are declared, their rules arrive with the implementation.

export const PersonLinkSchema = z.object({ label: z.string(), url: z.string() });
export const PersonSchema = z.object({ id: z.string() });
export const PersonCreateSchema = z.object({});
export const PersonUpdateSchema = z.object({});

export type PersonLink = z.infer<typeof PersonLinkSchema>;
export type Person = z.infer<typeof PersonSchema>;
export type PersonCreate = z.output<typeof PersonCreateSchema>;
export type PersonUpdate = z.output<typeof PersonUpdateSchema>;
