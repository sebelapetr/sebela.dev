import type { DatabaseConfig } from "./config.js";
import { openConnection } from "./connection.js";
import { createApiKeyPersistence, type ApiKeyPersistence } from "./modules/api-keys/index.js";
import { createAuditPersistence, type AuditPersistence } from "./modules/audit/index.js";
import { createProfilePersistence, type ProfilePersistence } from "./modules/profile/index.js";
import { createRoadmapPersistence, type RoadmapPersistence } from "./modules/roadmap/index.js";

/** Every persistence operation of the backend over one connection pool. */
export interface Persistence {
  readonly profile: ProfilePersistence;
  readonly roadmap: RoadmapPersistence;
  readonly apiKeys: ApiKeyPersistence;
  /** The private audit of content changes; written only inside `transaction`, with the change. */
  readonly audit: AuditPersistence;
  /**
   * Runs `work` with profile, roadmap and audit persistence inside one database transaction. It commits
   * when the work resolves and rolls every write back when it throws; the work's result or error
   * passes through. Writes that open their own transaction run as savepoints inside it.
   */
  transaction<T>(
    work: (
      profile: ProfilePersistence,
      roadmap: RoadmapPersistence,
      audit: AuditPersistence,
    ) => Promise<T>,
  ): Promise<T>;
  /** Ends the pool. Call once, at shutdown. */
  close(): Promise<void>;
}

/** Opens a connection pool to a migrated database. Does not connect until the first query. */
export function createPersistence(config: DatabaseConfig): Persistence {
  const connection = openConnection(config);
  return {
    profile: createProfilePersistence(connection.db),
    roadmap: createRoadmapPersistence(connection.db),
    apiKeys: createApiKeyPersistence(connection.db),
    audit: createAuditPersistence(connection.db),
    transaction: (work) =>
      connection.db.transaction((tx) =>
        work(
          createProfilePersistence(tx),
          createRoadmapPersistence(tx),
          createAuditPersistence(tx),
        ),
      ),
    close: () => connection.close(),
  };
}
