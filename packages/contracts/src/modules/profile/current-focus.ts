import { z } from "zod";

// Not specified yet: the current-focus contracts follow their tests.
export const CurrentFocusSchema = z.never();
export const CurrentFocusListSchema = z.never();
export const CurrentFocusCreateSchema = z.never();
export const CurrentFocusUpdateSchema = z.never();

export type CurrentFocus = z.infer<typeof CurrentFocusSchema>;
export type CurrentFocusCreate = z.output<typeof CurrentFocusCreateSchema>;
export type CurrentFocusUpdate = z.output<typeof CurrentFocusUpdateSchema>;
