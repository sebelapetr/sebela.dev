import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/node-postgres/migrator";

import type { DatabaseConfig } from "./config.js";
import { openConnection } from "./connection.js";

// The same relative path from `src/` and from `dist/`.
const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

/**
 * Applies every committed migration of `packages/db/migrations/` that the database has not had
 * yet. Safe to repeat. The API never calls it on start-up; it runs as its own step.
 */
export async function migrateDatabase(config: DatabaseConfig): Promise<void> {
  const connection = openConnection(config, { max: 1 });
  try {
    await migrate(connection.db, { migrationsFolder });
  } finally {
    await connection.close();
  }
}
