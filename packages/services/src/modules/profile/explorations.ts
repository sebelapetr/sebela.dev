import type { ProfilePersistence } from "@sebela/db";

import type { ExplorationService } from "./types.js";

// Stub until the exploration service is implemented.
export function createExplorationService(persistence: ProfilePersistence): ExplorationService {
  const missing = () => Promise.reject(new Error(`Not implemented for ${typeof persistence}.`));
  return {
    listExplorations: missing,
    getExploration: missing,
    createExploration: missing,
    updateExploration: missing,
    deleteExploration: missing,
  };
}
