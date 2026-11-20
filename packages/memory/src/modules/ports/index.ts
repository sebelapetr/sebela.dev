// The interfaces the knowledge base needs from the outside: an embedding provider, the persistence
// of the index and its spend, and the portfolio as the public reads return it. `packages/db`
// implements the store structurally, `packages/services` reads the portfolio and composes both;
// nothing here knows SQL, HTTP or a provider's wire format.
import { retrievalMaxPassages, type RetrievalContentKind } from "@sebela/contracts";

/** Whether texts are embedded to be stored or to search with; providers encode them differently. */
export type EmbeddingInput = "document" | "query";

/** The vectors of one call, in the order of its texts, and the tokens the provider billed. */
export interface Embedding {
  readonly vectors: readonly (readonly number[])[];
  readonly tokens: number;
}

/**
 * An embedding provider. A failure of any kind (network, timeout, refusal, malformed answer) is a
 * `ProviderUnavailableError`; a vector of another dimension is a failure too.
 */
export interface Embedder {
  /** The provider's model name, for example `voyage-4`. */
  readonly model: string;
  /** What changes the vectors besides the model, for example a provider-side revision. */
  readonly version: string;
  readonly dimension: number;
  embed(texts: readonly string[], input: EmbeddingInput, signal?: AbortSignal): Promise<Embedding>;
}

/** The embedding provider failed or did not answer in time. Never reported as "no evidence". */
export class ProviderUnavailableError extends Error {
  override readonly name = "ProviderUnavailableError";
}

/** The month's embedding spend reached its ceiling; nothing more is sent to the provider. */
export class BudgetExhaustedError extends Error {
  override readonly name = "BudgetExhaustedError";
}

/** What a provider call was for. */
export type UsageOperation = "index" | "search" | "candidates";

/** One provider call, recorded whether it served indexing or a search. */
export interface UsageRecord {
  readonly operation: UsageOperation;
  readonly model: string;
  readonly tokens: number;
  readonly costUsd: number;
  readonly occurredAt: Date;
}

/** Recorded usage, in total and per operation. */
export interface UsageTotals {
  readonly tokens: number;
  readonly costUsd: number;
  readonly byOperation: Readonly<
    Record<UsageOperation, { readonly tokens: number; readonly costUsd: number }>
  >;
}

/** Whether a source is portfolio content or a supplemental document. */
export type SourceKind = "portfolio" | "supplemental";

/** What the store knows about an indexed source: enough to tell whether it is current. */
export interface IndexedSource {
  readonly sourceId: string;
  readonly version: string;
  readonly model: string;
  readonly modelVersion: string;
}

/** A section of a source version: its heading path and its span in the version's text. */
export interface StoredSection {
  readonly ordinal: number;
  readonly headingPath: readonly string[];
  readonly start: number;
  readonly end: number;
}

/** A chunk with its vector, in its parent section. */
export interface StoredChunk {
  readonly sectionOrdinal: number;
  readonly ordinal: number;
  readonly text: string;
  /** SHA-256 of the chunk text; vectors are reused by it across versions. */
  readonly textHash: string;
  readonly vector: readonly number[];
}

/** One complete version of a source as it is indexed, replacing any earlier one. */
export interface SourceVersion {
  readonly sourceId: string;
  readonly sourceKind: SourceKind;
  readonly contentKind: RetrievalContentKind;
  readonly title: string;
  /** The canonical site path of a portfolio source; `null` for a supplemental one. */
  readonly path: string | null;
  /** SHA-256 over the source's title, path and sections. */
  readonly version: string;
  readonly model: string;
  readonly modelVersion: string;
  readonly dimension: number;
  readonly indexedAt: Date;
  readonly sections: readonly StoredSection[];
  readonly chunks: readonly StoredChunk[];
}

/** A nearest-neighbour query over the current versions embedded with one model. */
export interface NearestQuery {
  readonly vector: readonly number[];
  readonly model: string;
  readonly modelVersion: string;
  readonly kinds?: readonly RetrievalContentKind[];
  readonly limit: number;
}

/** A chunk found by a nearest-neighbour query, with its source and its cosine similarity. */
export interface NearestChunk {
  readonly sourceId: string;
  readonly sourceKind: SourceKind;
  readonly contentKind: RetrievalContentKind;
  readonly title: string;
  readonly path: string | null;
  readonly version: string;
  readonly text: string;
  readonly headingPath: readonly string[];
  readonly indexedAt: Date;
  /** 1 minus the cosine distance. */
  readonly similarity: number;
}

/** The persistence of the index and of provider spend. */
export interface RetrievalStore {
  indexedSources(): Promise<IndexedSource[]>;
  /** Stored vectors of chunks with these text hashes, embedded with this model and version. */
  vectorsByHash(
    hashes: readonly string[],
    model: string,
    modelVersion: string,
  ): Promise<Map<string, readonly number[]>>;
  /** Stores a source version and its chunks atomically, replacing the source's earlier ones. */
  replaceSource(source: SourceVersion): Promise<void>;
  /** Removes every source of this kind not named; returns how many it removed. */
  removeSourcesExcept(sourceKind: SourceKind, sourceIds: readonly string[]): Promise<number>;
  recordUsage(usage: UsageRecord): Promise<void>;
  usageSince(since: Date): Promise<UsageTotals>;
  nearest(query: NearestQuery): Promise<NearestChunk[]>;
}

// The portfolio as the API's public reads return it, narrowed to the fields the index reads. The
// contract types (`Person`, `Experience`, the roadmap tree and the rest) satisfy these structurally.
// The contact email is deliberately absent: it is never indexed.

export interface PortfolioPerson {
  readonly name: string;
  readonly headline: string;
  readonly shortBio: string;
  readonly longBio: string | null;
  readonly location: string | null;
  readonly availability: string | null;
  readonly servicesIntro: string | null;
  readonly collaborationSteps: readonly { readonly title: string; readonly description: string }[];
  readonly servicesNote: string | null;
}

interface Named {
  readonly name: string;
}

export interface PortfolioExperience {
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  readonly responsibilities: readonly string[];
  readonly organization: Named;
  readonly technologies: readonly Named[];
}

export interface PortfolioProject {
  readonly slug: string;
  readonly experience: string;
  readonly name: string;
  readonly summary: string;
  readonly problem: string;
  readonly workDone: string;
  readonly result: string;
  readonly technologies: readonly Named[];
}

export interface PortfolioCaseStudy {
  readonly project: string;
  readonly role: string;
  readonly body: string;
}

export interface PortfolioTestimonial {
  readonly slug: string;
  readonly experience: string;
  readonly quote: string;
  readonly authorName: string;
  readonly authorRole: string;
}

export interface PortfolioExploration {
  readonly slug: string;
  readonly name: string;
  readonly summary: string;
  readonly concepts: readonly string[];
  readonly technologies: readonly Named[];
}

export interface PortfolioService {
  readonly slug: string;
  readonly name: string;
  readonly summary: string;
  readonly audience: string;
  readonly deliverable: string;
}

export interface PortfolioEducation {
  readonly slug: string;
  readonly title: string;
  readonly institution: string | null;
  readonly description: string | null;
}

export interface PortfolioRoadmapResource {
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
}

export interface PortfolioRoadmapModule {
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly resources: readonly PortfolioRoadmapResource[];
}

export interface PortfolioRoadmapArea {
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly modules: readonly PortfolioRoadmapModule[];
}

export interface PortfolioDiaryDay {
  readonly date: string;
  readonly notes: string | null;
}

export interface PortfolioBook {
  readonly slug: string;
  readonly title: string;
  readonly author: string | null;
  readonly description: string | null;
  readonly summary: string | null;
}

export interface PortfolioEvent {
  readonly slug: string;
  readonly name: string;
  readonly organizer: string | null;
  readonly place: string | null;
  readonly takeaways: string | null;
}

export interface PortfolioGlossaryTerm {
  readonly slug: string;
  readonly term: string;
  readonly description: string;
}

/** The public portfolio the knowledge base indexes. */
export interface PortfolioSnapshot {
  readonly person: PortfolioPerson | null;
  readonly experiences: readonly PortfolioExperience[];
  readonly projects: readonly PortfolioProject[];
  readonly caseStudies: readonly PortfolioCaseStudy[];
  readonly explorations: readonly PortfolioExploration[];
  readonly services: readonly PortfolioService[];
  readonly education: readonly PortfolioEducation[];
  readonly testimonials: readonly PortfolioTestimonial[];
  readonly roadmap: { readonly areas: readonly PortfolioRoadmapArea[] };
  readonly diary: { readonly days: readonly PortfolioDiaryDay[] };
  readonly books: readonly PortfolioBook[];
  readonly events: readonly PortfolioEvent[];
  readonly glossary: readonly PortfolioGlossaryTerm[];
}

/** The retrieval settings (`.env.example`, Retrieval); the evals tune the pool, count and floor. */
export interface RetrievalConfig {
  /** The embedding model, for example `voyage-4`. */
  readonly embeddingModel: string;
  /** The provider's list price, used to estimate the cost of every call. */
  readonly embeddingPricePerMillionTokensUsd: number;
  /** The most texts sent in one embedding call. */
  readonly embeddingBatchSize: number;
  /** How long one provider call may take before it counts as unavailable. */
  readonly providerTimeoutMs: number;
  /** The month's embedding spend at which nothing more is sent to the provider. */
  readonly monthlyCeilingUsd: number;
  /** How many nearest chunks a search considers. */
  readonly candidatePool: number;
  /** How many passages a search returns at most. */
  readonly finalPassages: number;
  /** The least cosine similarity a passage needs; below it the search finds no evidence. */
  readonly relevanceFloor: number;
}

const SETTINGS = {
  embeddingModel: "RETRIEVAL_EMBEDDING_MODEL",
  embeddingPricePerMillionTokensUsd: "RETRIEVAL_EMBEDDING_PRICE_PER_MILLION_TOKENS_USD",
  embeddingBatchSize: "RETRIEVAL_EMBEDDING_BATCH_SIZE",
  providerTimeoutMs: "RETRIEVAL_PROVIDER_TIMEOUT_MS",
  monthlyCeilingUsd: "RETRIEVAL_MONTHLY_CEILING_USD",
  candidatePool: "RETRIEVAL_CANDIDATE_POOL",
  finalPassages: "RETRIEVAL_FINAL_PASSAGES",
  relevanceFloor: "RETRIEVAL_RELEVANCE_FLOOR",
} as const satisfies Record<keyof RetrievalConfig, string>;

/** The most texts the Voyage API accepts in one call. */
const MAX_BATCH_SIZE = 1000;

/**
 * Reads the retrieval settings. Returns `null` when none is set, so a process without retrieval
 * still starts and its search answers that the provider is unavailable; throws naming every
 * missing or invalid setting when only some are.
 */
export function readRetrievalConfig(
  env: Readonly<Record<string, string | undefined>>,
): RetrievalConfig | null {
  const raw = (name: string) => {
    const value = env[name]?.trim();
    return value === undefined || value === "" ? undefined : value;
  };
  if (Object.values(SETTINGS).every((name) => raw(name) === undefined)) return null;

  const problems: string[] = [];
  const number = (name: string, valid: (value: number) => boolean, expectation: string): number => {
    const value = raw(name);
    const parsed = value === undefined ? Number.NaN : Number(value);
    if (!Number.isFinite(parsed) || !valid(parsed)) {
      problems.push(`${name} must be ${expectation}`);
    }
    return parsed;
  };
  const integer = (name: string, min: number, max: number) =>
    number(
      name,
      (value) => Number.isInteger(value) && value >= min && value <= max,
      `an integer from ${String(min)} to ${String(max)}`,
    );

  const embeddingModel = raw(SETTINGS.embeddingModel) ?? "";
  if (embeddingModel === "") problems.push(`${SETTINGS.embeddingModel} must be a model name`);
  const config: RetrievalConfig = {
    embeddingModel,
    embeddingPricePerMillionTokensUsd: number(
      SETTINGS.embeddingPricePerMillionTokensUsd,
      (value) => value >= 0,
      "a non-negative price",
    ),
    embeddingBatchSize: integer(SETTINGS.embeddingBatchSize, 1, MAX_BATCH_SIZE),
    providerTimeoutMs: integer(SETTINGS.providerTimeoutMs, 1, 120_000),
    monthlyCeilingUsd: number(
      SETTINGS.monthlyCeilingUsd,
      (value) => value >= 0,
      "a non-negative amount",
    ),
    candidatePool: integer(SETTINGS.candidatePool, 1, 1000),
    finalPassages: integer(SETTINGS.finalPassages, 1, retrievalMaxPassages),
    relevanceFloor: number(SETTINGS.relevanceFloor, (value) => value >= 0 && value <= 1, "0 to 1"),
  };
  if (problems.length === 0 && config.candidatePool < config.finalPassages) {
    problems.push(`${SETTINGS.candidatePool} must be at least ${SETTINGS.finalPassages}`);
  }
  if (problems.length > 0) {
    throw new Error(`Invalid retrieval configuration: ${problems.join("; ")}.`);
  }
  return config;
}
