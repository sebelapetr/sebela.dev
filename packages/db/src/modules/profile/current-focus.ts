import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { CurrentFocusPersistence } from "./types.js";

/** The current-focus entries. */
export function createCurrentFocusPersistence(db: NodePgDatabase): CurrentFocusPersistence {
  const pending = () => Promise.reject(new Error(`Not implemented for ${typeof db}.`));
  return {
    listCurrentFocus: pending,
    findCurrentFocus: pending,
    createCurrentFocus: pending,
    updateCurrentFocus: pending,
    deleteCurrentFocus: pending,
  };
}
