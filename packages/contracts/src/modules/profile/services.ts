import { z } from "zod";

// Stub: the service contracts are specified by services.test.ts and not implemented yet.
export const serviceEvidenceKinds = [] as const;
export const ServiceEvidenceInputSchema = z.never();
export const ServiceSchema = z.never();
export const ServiceListSchema = z.never();
export const ServiceCreateSchema = z.object({ evidence: z.array(z.unknown()) }).refine(() => false);
export const ServiceUpdateSchema = z.never();
