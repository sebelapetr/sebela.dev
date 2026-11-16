import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { ExplorationPersistence } from "./types.js";

// Stub until the exploration persistence is implemented.
export function createExplorationPersistence(db: NodePgDatabase): ExplorationPersistence {
  const missing = () => Promise.reject(new Error(`Not implemented for ${typeof db}.`));
  return {
    listExplorations: missing,
    findExploration: missing,
    createExploration: missing,
    updateExploration: missing,
    deleteExploration: missing,
  };
}
