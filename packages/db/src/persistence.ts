import { sql } from "drizzle-orm";

import type { DatabaseConfig } from "./config.js";
import { openConnection } from "./connection.js";
import { createApiKeyPersistence, type ApiKeyPersistence } from "./modules/api-keys/index.js";
import { createAuditPersistence, type AuditPersistence } from "./modules/audit/index.js";
import { createChatPersistence, type ChatPersistence } from "./modules/chat/index.js";
import {
  createMaintenancePersistence,
  type MaintenancePersistence,
} from "./modules/maintenance/index.js";
import { createProfilePersistence, type ProfilePersistence } from "./modules/profile/index.js";
import {
  createRetrievalPersistence,
  type RetrievalPersistence,
} from "./modules/retrieval/index.js";
import { createRoadmapPersistence, type RoadmapPersistence } from "./modules/roadmap/index.js";

/** Every persistence operation of the backend over one connection pool. */
export interface Persistence {
  readonly profile: ProfilePersistence;
  readonly roadmap: RoadmapPersistence;
  readonly apiKeys: ApiKeyPersistence;
  /** The private audit of content changes; written only inside `transaction`, with the change. */
  readonly audit: AuditPersistence;
  /** The private knowledge index and its embedding spend. */
  readonly retrieval: RetrievalPersistence;
  /** The private visitor chat: identities, conversations, admissions, grants and spend. */
  readonly chat: ChatPersistence;
  /** Whole-database operations of the owner's maintenance commands, such as the demo clear. */
  readonly maintenance: MaintenancePersistence;
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
  /**
   * Runs the cheapest query the database can answer. Resolves when it answers; rejects when it
   * cannot be reached or refuses the connection. Reads and changes no data.
   */
  ping(): Promise<void>;
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
    retrieval: createRetrievalPersistence(connection.db),
    maintenance: createMaintenancePersistence(connection.db),
    chat: createChatPersistence(connection.db),
    transaction: (work) =>
      connection.db.transaction((tx) =>
        work(
          createProfilePersistence(tx),
          createRoadmapPersistence(tx),
          createAuditPersistence(tx),
        ),
      ),
    ping: async () => {
      await connection.db.execute(sql`select 1`);
    },
    close: () => connection.close(),
  };
}
