import type { DatabaseConfig } from "./config.js";

/**
 * Applies every committed migration of `packages/db/migrations/` that the database has not had
 * yet. Safe to repeat. The API never calls it on start-up; it runs as its own step.
 */
export function migrateDatabase(config: DatabaseConfig): Promise<void> {
  return Promise.reject(new Error(`not implemented for ${config.name}`));
}
