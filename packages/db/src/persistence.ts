import type { DatabaseConfig } from "./config.js";
import { openConnection } from "./connection.js";
import { createApiKeyPersistence, type ApiKeyPersistence } from "./modules/api-keys/index.js";
import { createProfilePersistence, type ProfilePersistence } from "./modules/profile/index.js";

/** Every persistence operation of the backend over one connection pool. */
export interface Persistence {
  readonly profile: ProfilePersistence;
  readonly apiKeys: ApiKeyPersistence;
  /** Ends the pool. Call once, at shutdown. */
  close(): Promise<void>;
}

/** Opens a connection pool to a migrated database. Does not connect until the first query. */
export function createPersistence(config: DatabaseConfig): Persistence {
  const connection = openConnection(config);
  return {
    profile: createProfilePersistence(connection.db),
    apiKeys: createApiKeyPersistence(connection.db),
    close: () => connection.close(),
  };
}
