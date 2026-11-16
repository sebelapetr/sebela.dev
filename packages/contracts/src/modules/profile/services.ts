import { z } from "zod";

import { explorationStatuses } from "./explorations.js";
import { PositionSchema } from "./catalogs.js";
import { SlugSchema, text, timestamps } from "./fields.js";

/** What a piece of service evidence points at. */
export const serviceEvidenceKinds = ["project", "exploration", "link"] as const;

/**
 * A path within the site: it starts with a single `/` and has no whitespace, control characters or
 * backslashes, so it can carry neither a scheme nor another host.
 */
const SitePathSchema = z
  .string()
  .max(500)
  .regex(
    /^\/(?!\/)[^\s\\\p{Cc}]*$/u,
    "Use a path within the site that starts with a single `/`, for example `/roadmap`.",
  )
  .meta({
    description:
      "A path within the site, for example `/roadmap` or `/contact?topic=automation`. It starts " +
      "with a single `/`; schemes, hosts, whitespace and backslashes are rejected.",
  });

const linkFields = {
  kind: z.literal("link"),
  label: text(200).meta({ description: "The text of the link, for example `AI Roadmap`." }),
  path: SitePathSchema,
};

const ProjectEvidenceInputSchema = z
  .strictObject({
    kind: z.literal("project"),
    project: SlugSchema.meta({ description: "The slug of an existing project." }),
  })
  .meta({ id: "ServiceProjectEvidenceInput" });

const ExplorationEvidenceInputSchema = z
  .strictObject({
    kind: z.literal("exploration"),
    exploration: SlugSchema.meta({ description: "The slug of an existing exploration." }),
  })
  .meta({ id: "ServiceExplorationEvidenceInput" });

const LinkEvidenceSchema = z.strictObject(linkFields).meta({
  id: "ServiceLinkEvidence",
  description: "A link to another part of the site.",
});

/** One piece of evidence as written: a project or an exploration by slug, or a site link. */
export const ServiceEvidenceInputSchema = z
  .discriminatedUnion("kind", [
    ProjectEvidenceInputSchema,
    ExplorationEvidenceInputSchema,
    LinkEvidenceSchema,
  ])
  .meta({
    id: "ServiceEvidenceInput",
    description:
      "Evidence for a service, chosen by `kind`: an existing project, an existing exploration or " +
      "a link to another part of the site.",
  });

/** The project a piece of evidence points at, with what a page needs to render it. */
const EvidenceProjectSchema = z
  .object({
    slug: SlugSchema,
    name: z.string(),
    summary: z.string().meta({ description: "Markdown." }),
    experience: SlugSchema.meta({ description: "The slug of the experience it belongs to." }),
  })
  .meta({ id: "ServiceEvidenceProject" });

/** The exploration a piece of evidence points at, with its status exactly as stored. */
const EvidenceExplorationSchema = z
  .object({
    slug: SlugSchema,
    name: z.string(),
    summary: z.string().meta({ description: "Markdown." }),
    status: z.enum(explorationStatuses).meta({
      description: "How far the exploration got, exactly as stored; never shown stronger.",
    }),
  })
  .meta({ id: "ServiceEvidenceExploration" });

/** One piece of evidence as read: the project or exploration resolved, or the site link. */
export const ServiceEvidenceSchema = z
  .discriminatedUnion("kind", [
    z
      .object({ kind: z.literal("project"), project: EvidenceProjectSchema })
      .meta({ id: "ServiceProjectEvidence" }),
    z
      .object({ kind: z.literal("exploration"), exploration: EvidenceExplorationSchema })
      .meta({ id: "ServiceExplorationEvidence" }),
    LinkEvidenceSchema,
  ])
  .meta({ id: "ServiceEvidence" });

/** Scalar fields of a service, the same when written and when read. */
const scalarFields = {
  name: text(200),
  summary: text(5000).meta({ description: "Markdown." }),
  audience: text(5000).meta({ description: "Who the service is for. Markdown." }),
  deliverable: text(5000).meta({ description: "What the client gets. Markdown." }),
  position: PositionSchema,
};

const EvidenceInputListSchema = z
  .array(ServiceEvidenceInputSchema)
  .max(30)
  .meta({
    description:
      "The evidence in its intended order; each project and exploration at most once. On an " +
      "update the list replaces all evidence; an omitted list leaves it unchanged.",
  });

const UNIQUE_PROJECTS = "List each project once.";
const UNIQUE_EXPLORATIONS = "List each exploration once.";

/** Every project and every exploration appears at most once in the evidence of a write. */
function evidenceIsUnique(
  value: { evidence?: z.output<typeof EvidenceInputListSchema> | undefined },
  context: z.core.$RefinementCtx,
) {
  const { evidence } = value;
  if (evidence === undefined) return;
  const projects = evidence.flatMap((piece) => (piece.kind === "project" ? [piece.project] : []));
  const explorations = evidence.flatMap((piece) =>
    piece.kind === "exploration" ? [piece.exploration] : [],
  );
  if (new Set(projects).size !== projects.length) {
    context.addIssue({ code: "custom", path: ["evidence"], message: UNIQUE_PROJECTS });
  }
  if (new Set(explorations).size !== explorations.length) {
    context.addIssue({ code: "custom", path: ["evidence"], message: UNIQUE_EXPLORATIONS });
  }
}

/**
 * A service a client can order: who it is for, what they get, and its evidence resolved in the
 * intended order.
 */
export const ServiceSchema = z
  .object({
    id: z.uuid(),
    slug: SlugSchema,
    ...scalarFields,
    evidence: z
      .array(ServiceEvidenceSchema)
      .meta({ description: "The evidence for the service, in its intended order." }),
    ...timestamps,
  })
  .meta({ id: "Service" });

/** Every service, in the intended order. */
export const ServiceListSchema = z
  .array(ServiceSchema)
  .meta({ id: "ServiceList", description: "Ordered by position, then slug." });

/** Body of creating a service together with its evidence; omitted evidence is empty. */
export const ServiceCreateSchema = z
  .strictObject({
    slug: SlugSchema,
    ...scalarFields,
    evidence: EvidenceInputListSchema.default([]),
  })
  .superRefine(evidenceIsUnique)
  .meta({ id: "ServiceCreate" });

/**
 * Body of updating a service: at least one field; only the fields sent change and the slug cannot
 * be changed. A sent `evidence` list replaces all evidence; an omitted one keeps it.
 */
export const ServiceUpdateSchema = z
  .strictObject({ ...scalarFields, evidence: EvidenceInputListSchema })
  .partial()
  .refine((change) => Object.keys(change).length > 0, { message: "Change at least one field." })
  .superRefine(evidenceIsUnique)
  .meta({ id: "ServiceUpdate" });

export type ServiceEvidenceKind = (typeof serviceEvidenceKinds)[number];
export type ServiceEvidenceInput = z.infer<typeof ServiceEvidenceInputSchema>;
export type ServiceEvidence = z.infer<typeof ServiceEvidenceSchema>;
export type Service = z.infer<typeof ServiceSchema>;
export type ServiceCreate = z.output<typeof ServiceCreateSchema>;
export type ServiceUpdate = z.output<typeof ServiceUpdateSchema>;
