import { createPersistence, type DatabaseConfig } from "@sebela/db";

import {
  createApiKeyService,
  type ApiKeyService,
  type ApiKeyServiceOptions,
} from "./modules/api-keys/index.js";
import {
  createMediaService,
  type CleanupFailure,
  type MediaConfig,
  type MediaService,
} from "./modules/media/index.js";
import { createProfileService, type ProfileService } from "./modules/profile/index.js";
import { openStorage } from "./modules/storage/index.js";

/** Every domain operation of the backend over one database connection pool. */
export interface Services {
  readonly profile: ProfileService;
  readonly apiKeys: ApiKeyService;
  readonly media: MediaService;
  /** Ends the connection pool. Call once, at shutdown. */
  close(): Promise<void>;
}

export interface ServicesOptions {
  readonly apiKeys?: ApiKeyServiceOptions;
  /**
   * Storage and upload limits for media. Without them every media operation throws, so a process
   * that never handles media needs no storage configuration.
   */
  readonly media?: {
    readonly config: MediaConfig;
    /** Called for a stored file that could not be removed; log the key, never file contents. */
    onCleanupFailure(failure: CleanupFailure): void;
  };
}

const unconfigured = (): never => {
  throw new Error("Media storage is not configured.");
};

const unconfiguredMedia: MediaService = {
  listMedia: unconfigured,
  getMedia: unconfigured,
  uploadMedia: unconfigured,
  updateMedia: unconfigured,
  deleteMedia: unconfigured,
  readMediaFile: unconfigured,
};

/** Composes the services over a migrated database. Connects on the first operation. */
export function openServices(config: DatabaseConfig, options: ServicesOptions = {}): Services {
  const persistence = createPersistence(config);
  const { media } = options;
  return {
    profile: createProfileService(persistence.profile),
    apiKeys: createApiKeyService(persistence.apiKeys, options.apiKeys),
    media:
      media === undefined
        ? unconfiguredMedia
        : createMediaService(persistence.profile, {
            storage: openStorage(media.config.storage),
            limits: media.config.limits,
            onCleanupFailure: (failure) => {
              media.onCleanupFailure(failure);
            },
          }),
    close: () => persistence.close(),
  };
}
