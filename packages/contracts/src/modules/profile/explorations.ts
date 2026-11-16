import { z } from "zod";

// Stubs until the exploration contracts are implemented.
export const explorationStatuses: readonly string[] = [];
export const ExplorationSchema = z.never();
export const ExplorationListSchema = z.array(ExplorationSchema).max(0);
export const ExplorationCreateSchema = z.never();
export const ExplorationUpdateSchema = z.never();
