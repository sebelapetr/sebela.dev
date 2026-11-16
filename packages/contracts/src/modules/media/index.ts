import { z } from "zod";

// Not implemented yet: the tests describe the contract first.
export const mediaTypes = [] as const;

export const MediaSchema = z.never();
export const MediaListSchema = z.never();
export const MediaUpdateSchema = z.never();
export const MediaUploadSchema = z.never();
export const MediaIdParamsSchema = z.strictObject({ id: z.never() });
