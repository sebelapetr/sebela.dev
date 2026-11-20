// The knowledge base of the backend: composes `@sebela/memory` with the retrieval persistence, the
// public portfolio reads and the configured embedding provider.
import {
  retrievalContentKinds,
  type ContentChange,
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
  scheduleChanges,
  type Embedder,
  type IndexReport,
  type PortfolioSnapshot,
  type ProcessOptions,
  type QueueReport,
  type CandidateQuestion,
  type RetrievalConfig,
  type RetrievalStore,
  type UsageTotals,
  type WorkCounts,
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
  /**
   * Stores every portfolio source again, as after an embedding model or version change; each text
   * is embedded at most once per model, the rest comes from stored vectors.
   */
  rebuildPortfolio(): Promise<IndexReport>;
  /**
   * Queues indexing for committed content changes. A deleted record's passages leave search at
   * once and a changed record's until it is indexed again. Needs no provider or settings.
   */
  schedule(changes: readonly ContentChange[]): Promise<void>;
  /**
   * Runs one bounded batch of queued work against the current portfolio. When the provider is
   * unavailable the batch counts a failed attempt; at the ceiling it stays as it was.
   */
  processPending(options?: ProcessOptions): Promise<QueueReport>;
  /** How much queued work waits, and how much gave up after the most attempts. */
  pending(): Promise<WorkCounts>;
  /** The passages answering the query, or no evidence below the relevance floor. */
  search(request: SearchRequest): Promise<SearchResult>;
  /**
   * Each question's candidate pool as source IDs, best first and without the floor, in the order
   * of the questions; the queries are embedded in batches. For the evals.
   */
  candidates(questions: readonly CandidateQuestion[]): Promise<string[][]>;
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
    rebuildPortfolio: () =>
      provider(async () => ready().indexer.rebuildPortfolio(await snapshot(sources))),
    schedule: (changes) => scheduleChanges(store, changes),
    processPending: (processOptions) =>
      provider(() => ready().indexer.processPending(() => snapshot(sources), processOptions)),
    pending: () => store.workCounts(),
    search: (request) => provider(() => ready().retriever.search(request)),
    candidates: (questions) => provider(() => ready().retriever.candidates(questions)),
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
      const answered =
        error.status === undefined ? "" : `: it answered ${statusClass(error.status)}`;
      throw new DomainError(
        "provider_unavailable",
        `The embedding provider is unavailable${answered}.`,
      );
    }
    if (error instanceof BudgetExhaustedError) {
      throw new DomainError("budget_exhausted", "The month's embedding budget is exhausted.");
    }
    throw error;
  }
}

/** An HTTP status with its class, for example `HTTP 429 (4xx, rate limited)`; nothing of the body. */
function statusClass(status: number): string {
  const kind =
    status === 429
      ? "4xx, rate limited"
      : status >= 500
        ? "5xx, provider error"
        : status >= 400
          ? "4xx, refused"
          : `${String(Math.floor(status / 100))}xx, unexpected`;
  return `HTTP ${String(status)} (${kind})`;
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
    storeVectors: (vectors, model, modelVersion) =>
      persistence.storeVectors(vectors, model, modelVersion),
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
    scheduleWork: (work) => persistence.scheduleWork(work),
    pendingWork: (limit, includeFailed) => persistence.pendingWork(limit, includeFailed),
    completeWork: (ids) => persistence.completeWork(ids),
    failWork: (ids, error, maxAttempts) => persistence.failWork(ids, error, maxAttempts),
    workCounts: () => persistence.workCounts(),
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
      retries: config.providerRetries,
      maxRetryWaitMs: config.providerMaxRetryWaitMs,
    }),
  };
}
