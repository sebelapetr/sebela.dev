import { z } from "zod";

/** Not yet defined. */
export const CvExplorationSchema = z.never();

/** Not yet defined. */
export const CvSchema = z.never();

export type CvExploration = z.infer<typeof CvExplorationSchema>;
export type Cv = z.infer<typeof CvSchema>;
