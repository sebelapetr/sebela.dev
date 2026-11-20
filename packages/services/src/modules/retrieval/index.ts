// The knowledge base of the backend: composes `@sebela/memory` with the retrieval persistence, the
// public portfolio reads and the configured embedding provider.
import {
  retrievalContentKinds,
  type RetrievalContentKind,
  type SearchRequest,
  type SearchResult,
} from "@sebela/contracts";
import { retrievalDimension, type RetrievalPersistence } from "@sebela/db";
import {
  BudgetExhaustedError,
  ProviderUnavailableError,
  createIndexer,
  createRetriever,
  createVoyageEmbedder,
  readRetrievalConfig,
  type Embedder,
  type IndexReport,
  type PortfolioSnapshot,
  type RetrievalConfig,
  type RetrievalStore,
  type UsageTotals,
} from "@sebela/memory";

import { DomainError } from "../../errors.js";
import type { ProfileService } from "../profile/index.js";
import type { RoadmapService } from "../roadmap/index.js";

/**
 * Indexing and searching the public portfolio. Every operation that needs the provider fails with
 * a `DomainError` `provider_unavailable` when retrieval is not configured or the provider fails,
 * and `budget_exhausted` once the month's spend reached its ceiling; neither is ever no evidence.
 */
export interface KnowledgeService {
  /** Brings the index in step with the portfolio, embedding only what changed. */
  reindexPortfolio(): Promise<IndexReport>;
  /** The passages answering the query, or no evidence below the relevance floor. */
  search(request: SearchRequest): Promise<SearchResult>;
  /** The candidate pool's source IDs, best first and without the floor; for the evals. */
  candidates(query: string, kinds?: readonly RetrievalContentKind[]): Promise<string[]>;
  /** The provider usage recorded this calendar month (UTC). */
  usage(): Promise<UsageTotals>;
}

export interface KnowledgeSources {
  readonly store: RetrievalPersistence;
  readonly profile: ProfileService;
  readonly roadmap: RoadmapService;
}

export interface KnowledgeServiceOptions {
  /** `null` when retrieval is not configured. */
  readonly config: RetrievalConfig | null;
  /** The embedding provider; without it every provider operation is unavailable. */
  readonly embedder?: Embedder;
}

export function createKnowledgeService(
  sources: KnowledgeSources,
  options: KnowledgeServiceOptions,
): KnowledgeService {
  const { config, embedder } = options;
  const store = narrowStore(sources.store);
  const engine =
    config === null || embedder === undefined
      ? null
      : {
          indexer: createIndexer({ store, embedder, config }),
          retriever: createRetriever({ store, embedder, config }),
        };

  const ready = () => {
    if (engine === null) {
      throw new DomainError("provider_unavailable", "Retrieval is not configured.");
    }
    return engine;
  };

  return {
    reindexPortfolio: () =>
      provider(async () => ready().indexer.reindexPortfolio(await snapshot(sources))),
    search: (request) => provider(() => ready().retriever.search(request)),
    candidates: (query, kinds) => provider(() => ready().retriever.candidates(query, kinds)),
    usage: () => store.usageSince(monthStart(new Date())),
  };
}

/** The first instant of the calendar month (UTC) of `now`. */
function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Runs a provider operation, turning the provider's failures into domain errors. */
async function provider<Result>(operation: () => Promise<Result>): Promise<Result> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ProviderUnavailableError) {
      throw new DomainError("provider_unavailable", "The embedding provider is unavailable.");
    }
    if (error instanceof BudgetExhaustedError) {
      throw new DomainError("budget_exhausted", "The month's embedding budget is exhausted.");
    }
    throw error;
  }
}

/** The content kind the persistence stores as text, narrowed back to the contract's kinds. */
function contentKindOf(value: string): RetrievalContentKind {
  const kind = retrievalContentKinds.find((known) => known === value);
  if (kind === undefined) throw new Error(`Unknown retrieval content kind ${value}.`);
  return kind;
}

/** The persistence as the memory package's store: the same operations, kinds narrowed. */
function narrowStore(persistence: RetrievalPersistence): RetrievalStore {
  return {
    indexedSources: () => persistence.indexedSources(),
    vectorsByHash: (hashes, model, modelVersion) =>
      persistence.vectorsByHash(hashes, model, modelVersion),
    replaceSource: (source) => persistence.replaceSource(source),
    removeSourcesExcept: (sourceKind, sourceIds) =>
      persistence.removeSourcesExcept(sourceKind, sourceIds),
    recordUsage: (usage) => persistence.recordUsage(usage),
    usageSince: (since) => persistence.usageSince(since),
    nearest: async (query) =>
      (await persistence.nearest(query)).map((chunk) => ({
        ...chunk,
        contentKind: contentKindOf(chunk.contentKind),
      })),
  };
}

/** The public portfolio as the public reads return it. */
async function snapshot({ profile, roadmap }: KnowledgeSources): Promise<PortfolioSnapshot> {
  const person = await profile.getPerson().catch((error: unknown) => {
    if (error instanceof DomainError && error.code === "not_found") return null;
    throw error;
  });
  const [
    experiences,
    projects,
    explorations,
    services,
    education,
    testimonials,
    tree,
    diary,
    books,
    events,
    glossary,
  ] = await Promise.all([
    profile.listExperiences(),
    profile.listProjects(),
    profile.listExplorations(),
    profile.listServices(),
    profile.listEducation(),
    profile.listTestimonials(),
    roadmap.getRoadmap(),
    roadmap.getDiary(),
    roadmap.listBooks(),
    roadmap.listEvents(),
    roadmap.listGlossaryTerms(),
  ]);
  return {
    person,
    experiences,
    projects,
    caseStudies: projects.flatMap((project) => (project.caseStudy ? [project.caseStudy] : [])),
    explorations,
    services,
    education,
    testimonials,
    roadmap: tree,
    diary,
    books,
    events,
    glossary,
  };
}

/**
 * The retrieval options of a process from its environment: the `RETRIEVAL_*` settings (none set
 * switches retrieval off) and the Voyage embedder when `VOYAGE_API_KEY` is set. Throws an error
 * naming every invalid setting, never a value.
 */
export function readRetrievalOptions(
  env: Readonly<Record<string, string | undefined>>,
): KnowledgeServiceOptions {
  const config = readRetrievalConfig(env);
  const apiKey = env["VOYAGE_API_KEY"]?.trim() ?? "";
  if (config === null || apiKey === "") return { config };
  return {
    config,
    embedder: createVoyageEmbedder({
      apiKey,
      model: config.embeddingModel,
      dimension: retrievalDimension,
      timeoutMs: config.providerTimeoutMs,
    }),
  };
}
