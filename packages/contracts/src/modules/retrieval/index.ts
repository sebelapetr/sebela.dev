// The retrieval contract: the request and result of the private search over the indexed knowledge.
// A portfolio passage carries the canonical site path of its public record; a supplemental passage
// is a label and an opaque identifier only and can never carry a URL, a path or a storage key.
import { z } from "zod";

/** Every kind of content a passage can come from; `document` is the only supplemental kind. */
export const retrievalContentKinds = [
  "profile",
  "experience",
  "project",
  "case_study",
  "exploration",
  "service",
  "education",
  "roadmap_area",
  "roadmap_module",
  "roadmap_resource",
  "diary_day",
  "book",
  "event",
  "glossary_term",
  "document",
] as const;
export type RetrievalContentKind = (typeof retrievalContentKinds)[number];
export type PortfolioContentKind = Exclude<RetrievalContentKind, "document">;

const portfolioContentKinds = retrievalContentKinds.filter(
  (kind): kind is PortfolioContentKind => kind !== "document",
);

/** The longest query, in characters after trimming. */
export const retrievalQueryMaxLength = 500;
/** The most passages one search returns. */
export const retrievalMaxPassages = 8;
/** The longest passage text, in characters. */
export const retrievalPassageMaxLength = 4000;

const ContentKindSchema = z.enum(retrievalContentKinds).meta({ id: "RetrievalContentKind" });

export const SearchRequestSchema = z
  .strictObject({
    query: z.string().trim().min(1).max(retrievalQueryMaxLength).meta({
      description: "The question or keywords, at most 500 characters after trimming.",
    }),
    kinds: z.array(ContentKindSchema).min(1).max(retrievalContentKinds.length).optional().meta({
      description: "Only passages of these content kinds; every kind when absent.",
    }),
    limit: z.int().min(1).max(retrievalMaxPassages).optional().meta({
      description: "The most passages to return; the configured number when absent.",
    }),
  })
  .meta({ id: "SearchRequest", description: "A search of the indexed knowledge." });

export type SearchRequest = z.output<typeof SearchRequestSchema>;

const VersionSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/)
  .meta({ description: "SHA-256 of the indexed source text; changes when the source changes." });

const passageFields = {
  title: z.string().min(1).max(300),
  version: VersionSchema,
  text: z.string().min(1).max(retrievalPassageMaxLength),
  score: z.number().min(-1).max(1).meta({
    description:
      "Relevance to the query, higher is better: the reranker's score in the deployed search.",
  }),
};

const provenance = <Kind extends z.ZodType<RetrievalContentKind>>(contentKind: Kind) =>
  z.strictObject({
    contentKind,
    sectionPath: z.array(z.string().min(1).max(300)).max(10).meta({
      description: "The headings from the source title down to the passage's section.",
    }),
    indexedAt: z.iso.datetime({ offset: true }),
  });

const KEY = String.raw`[a-z0-9]+(?:-[a-z0-9]+)*`;
const DATE = String.raw`\d{4}-\d{2}-\d{2}`;
const keyPattern = new RegExp(`^${KEY}$`);
const datePattern = new RegExp(`^${DATE}$`);

/** The kind and key of a portfolio source ID, or `null` when it is not one. */
function parsePortfolioSourceId(
  sourceId: string,
): { kind: PortfolioContentKind; key: string } | null {
  const [prefix, kind, key, ...rest] = sourceId.split(":");
  if (prefix !== "portfolio" || rest.length > 0 || kind === undefined || key === undefined) {
    return null;
  }
  const known = portfolioContentKinds.find((candidate) => candidate === kind);
  if (known === undefined) return null;
  const pattern = known === "diary_day" ? datePattern : keyPattern;
  return pattern.test(key) ? { kind: known, key } : null;
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The pattern of the site path of a source, with any slug for the roadmap containers. */
function pathPattern(kind: PortfolioContentKind, key: string): RegExp {
  const container = "CONTAINER";
  const path = portfolioSourcePath({ kind, key, area: container, module: container });
  return new RegExp(`^${escape(path).replaceAll(container, KEY)}$`);
}

export const PortfolioPassageSchema = z
  .strictObject({
    sourceKind: z.literal("portfolio"),
    sourceId: z.string().max(200).meta({
      description: "`portfolio:<content kind>:<slug or date>` of the public record.",
    }),
    ...passageFields,
    path: z.string().startsWith("/").max(300).meta({
      description: "The canonical site path of the record, never an absolute URL.",
    }),
    provenance: provenance(z.enum(portfolioContentKinds)),
  })
  .superRefine((passage, context) => {
    const source = parsePortfolioSourceId(passage.sourceId);
    if (source === null) {
      context.addIssue({ code: "custom", path: ["sourceId"], message: "Not a portfolio source." });
      return;
    }
    if (source.kind !== passage.provenance.contentKind) {
      context.addIssue({
        code: "custom",
        path: ["provenance", "contentKind"],
        message: "The content kind differs from the source's.",
      });
    }
    if (!pathPattern(source.kind, source.key).test(passage.path)) {
      context.addIssue({
        code: "custom",
        path: ["path"],
        message: "Not the canonical path of the source.",
      });
    }
  })
  .meta({ id: "PortfolioPassage", description: "A passage of a public portfolio record." });

export const SupplementalPassageSchema = z
  .strictObject({
    sourceKind: z.literal("supplemental"),
    sourceId: z
      .string()
      .regex(new RegExp(`^document:${KEY}$`))
      .max(200)
      .meta({ description: "`document:<slug>`, an opaque identifier; never an address." }),
    ...passageFields,
    provenance: provenance(z.literal("document")),
  })
  .meta({
    id: "SupplementalPassage",
    description: "A passage of an approved supplemental document: a label, never a link.",
  });

export const PassageSchema = z
  .discriminatedUnion("sourceKind", [PortfolioPassageSchema, SupplementalPassageSchema])
  .meta({ id: "Passage" });

export const SearchResultSchema = z
  .discriminatedUnion("status", [
    z.strictObject({
      status: z.literal("found"),
      passages: z.array(PassageSchema).min(1).max(retrievalMaxPassages),
    }),
    z.strictObject({ status: z.literal("no_evidence"), passages: z.tuple([]) }),
  ])
  .meta({
    id: "SearchResult",
    description:
      "The passages answering the query, best first, or no evidence when none reaches the " +
      "relevance floor. A failing provider is an error, never no evidence.",
  });

export type PortfolioPassage = z.output<typeof PortfolioPassageSchema>;
export type SupplementalPassage = z.output<typeof SupplementalPassageSchema>;
export type Passage = z.output<typeof PassageSchema>;
export interface PassageProvenance<Kind extends RetrievalContentKind = RetrievalContentKind> {
  contentKind: Kind;
  sectionPath: string[];
  indexedAt: string;
}
export type SearchResult = z.output<typeof SearchResultSchema>;

/** The address of a portfolio record; roadmap modules and resources name their containers. */
export interface PortfolioSourceAddress {
  kind: PortfolioContentKind;
  key: string;
  area?: string;
  module?: string;
}

/** The source ID of a portfolio record, `portfolio:<kind>:<key>`. */
export function portfolioSourceId(kind: PortfolioContentKind, key: string): string {
  return `portfolio:${kind}:${key}`;
}

/** The canonical site path of a portfolio record. */
export function portfolioSourcePath({ kind, key, area, module }: PortfolioSourceAddress): string {
  const container = (value: string | undefined, name: string) => {
    if (value === undefined) throw new Error(`A ${kind} path needs its ${name}.`);
    return value;
  };
  switch (kind) {
    case "profile":
      return "/";
    case "experience":
      return `/experience#experience-${key}`;
    case "project":
      return `/experience#project-${key}`;
    case "case_study":
      return `/experience#case-study-${key}`;
    case "exploration":
      return `/experience#exploration-${key}`;
    case "service":
      return `/services#service-${key}`;
    case "education":
      return "/cv";
    case "roadmap_area":
      return `/ai-roadmap/${key}`;
    case "roadmap_module":
      return `/ai-roadmap/${container(area, "area")}/${key}`;
    case "roadmap_resource":
      return `/ai-roadmap/${container(area, "area")}/${container(module, "module")}#resource-${key}`;
    case "diary_day":
      return `/ai-roadmap/diary/${key}`;
    case "book":
      return `/ai-roadmap/bookshelf/${key}`;
    case "event":
      return "/ai-roadmap/events";
    case "glossary_term":
      return "/ai-roadmap";
  }
}
