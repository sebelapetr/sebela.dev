import { createPersistence, type DatabaseConfig } from "@sebela/db";

import {
  createApiKeyService,
  type ApiKeyService,
  type ApiKeyServiceOptions,
} from "./modules/api-keys/index.js";
import { createProfileService, type ProfileService } from "./modules/profile/index.js";

/** Every domain operation of the backend over one database connection pool. */
export interface Services {
  readonly profile: ProfileService;
  readonly apiKeys: ApiKeyService;
  /** Ends the connection pool. Call once, at shutdown. */
  close(): Promise<void>;
}

/** Composes the services over a migrated database. Connects on the first operation. */
export function openServices(
  config: DatabaseConfig,
  options: { apiKeys?: ApiKeyServiceOptions } = {},
): Services {
  const persistence = createPersistence(config);
  return {
    profile: createProfileService(persistence.profile),
    apiKeys: createApiKeyService(persistence.apiKeys, options.apiKeys),
    close: () => persistence.close(),
  };
}
