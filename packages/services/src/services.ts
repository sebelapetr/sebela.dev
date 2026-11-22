import { createPersistence, type DatabaseConfig } from "@sebela/db";

import {
  createApiKeyService,
  type ApiKeyService,
  type ApiKeyServiceOptions,
} from "./modules/api-keys/index.js";
import { createAuditService, type AuditService } from "./modules/audit/index.js";
import {
  createChatService,
  type ChatService,
  type ChatServiceOptions,
  unconfiguredChat,
} from "./modules/chat/index.js";
import { createHealthService, type HealthService } from "./modules/health/index.js";
import {
  createMediaService,
  type CleanupFailure,
  type MediaConfig,
  type MediaService,
  unconfiguredMedia,
} from "./modules/media/index.js";
import {
  createKnowledgeService,
  type KnowledgeService,
  type KnowledgeServiceOptions,
} from "./modules/retrieval/index.js";
import { createProfileService, type ProfileService } from "./modules/profile/index.js";
import { createRoadmapService, type RoadmapService } from "./modules/roadmap/index.js";
import { createSeedService, type SeedService } from "./modules/seed/index.js";
import { openStorage } from "./modules/storage/index.js";

/** Every domain operation of the backend over one database connection pool. */
export interface Services {
  readonly profile: ProfileService;
  /** The AI roadmap: areas, modules and resources, and the whole tree with derived progress. */
  readonly roadmap: RoadmapService;
  readonly apiKeys: ApiKeyService;
  readonly media: MediaService;
  /** Content writes with their audit in one transaction, and the newest changes. */
  readonly audit: AuditService;
  /** Indexing and searching the public portfolio; private, server-side only. */
  readonly knowledge: KnowledgeService;
  /** The visitor chat: cookie identities, admission, grants, results and retention. */
  readonly chat: ChatService;
  /** Loads a seed folder through the services above; needs media to be configured. */
  readonly seed: SeedService;
  /** Whether the database answers now, for readiness checks; never throws. */
  readonly health: HealthService;
  /** Ends the connection pool. Call once, at shutdown. */
  close(): Promise<void>;
}

export interface ServicesOptions {
  readonly apiKeys?: ApiKeyServiceOptions;
  /**
   * Storage and upload limits for media. Without them every media and seed operation throws, so a
   * process that never handles media needs no storage configuration.
   */
  readonly media?: {
    readonly config: MediaConfig;
    /** Called for a stored file that could not be removed; log the key, never file contents. */
    onCleanupFailure(failure: CleanupFailure): void;
  };
  /**
   * Retrieval settings and the embedding provider. Without them every knowledge operation that
   * needs the provider fails as unavailable.
   */
  readonly retrieval?: KnowledgeServiceOptions;
  /**
   * The chat settings and the bot-challenge verifier, optionally with a clock and a policy for
   * tests. Without them every chat operation throws.
   */
  readonly chat?: ChatServiceOptions;
}

const unconfigured = (): never => {
  throw new Error("Media storage is not configured.");
};

const unconfiguredSeed: SeedService = {
  loadSeed: unconfigured,
  loadSeedIntoEmpty: unconfigured,
  clearContent: unconfigured,
};

/** Composes the services over a migrated database. Connects on the first operation. */
export function openServices(config: DatabaseConfig, options: ServicesOptions = {}): Services {
  const persistence = createPersistence(config);
  const { media } = options;
  const opened = media === undefined ? undefined : openStorage(media.config.storage);
  // The assembled CV addresses its PDF, and the bookshelf its covers, through the same storage the
  // media service uses.
  const profileOptions =
    opened === undefined
      ? {}
      : { mediaAddress: (key: string) => opened.storage.publicAddress(key) };
  const mediaOptions =
    media === undefined || opened === undefined
      ? undefined
      : {
          storage: opened,
          limits: media.config.limits,
          onCleanupFailure: (failure: CleanupFailure) => {
            media.onCleanupFailure(failure);
          },
        };
  const profile = createProfileService(persistence.profile, profileOptions);
  const roadmap = createRoadmapService(persistence.roadmap, profileOptions);
  return {
    profile,
    roadmap,
    knowledge: createKnowledgeService(
      { store: persistence.retrieval, profile, roadmap },
      options.retrieval ?? { config: null },
    ),
    chat:
      options.chat === undefined
        ? unconfiguredChat
        : createChatService(persistence.chat, options.chat),
    apiKeys: createApiKeyService(persistence.apiKeys, options.apiKeys),
    media:
      mediaOptions === undefined
        ? unconfiguredMedia
        : createMediaService(persistence.profile, mediaOptions),
    audit: createAuditService(
      persistence,
      mediaOptions === undefined ? profileOptions : { ...profileOptions, media: mediaOptions },
    ),
    seed:
      mediaOptions === undefined
        ? unconfiguredSeed
        : createSeedService(persistence, { ...mediaOptions, ...profileOptions }),
    health: createHealthService(persistence),
    close: () => persistence.close(),
  };
}
