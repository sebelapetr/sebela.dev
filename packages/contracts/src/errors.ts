import { z } from "zod";

// Interface first: the shape is declared, its rules arrive with the implementation.

export const errorCodes = [] as const;
export const ErrorResponseSchema = z.object({});
export type ErrorCode = string;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
