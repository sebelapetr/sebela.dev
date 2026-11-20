import type { Database } from "../../database.js";

/** Operations on the whole content of the database, for the owner's maintenance commands. */
export interface MaintenancePersistence {
  /**
   * Empties every table of the `profile` and `ai_roadmap` schemas in one transaction, all or
   * nothing, and returns the storage keys of the media it removed, so the caller can delete the
   * stored files after the commit. API keys and the audit of earlier changes stay. The migrations
   * stay applied, so the database is empty and ready for content again.
   */
  clearContent(): Promise<readonly string[]>;
}

export function createMaintenancePersistence(db: Database): MaintenancePersistence {
  return {
    clearContent: () => Promise.reject(new Error("not implemented", { cause: db })),
  };
}
