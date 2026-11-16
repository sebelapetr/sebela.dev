import type { ProfilePersistence } from "@sebela/db";

import type { CurrentFocusService } from "./types.js";

/** The current-focus entries. */
export function createCurrentFocusService(persistence: ProfilePersistence): CurrentFocusService {
  const pending = () => Promise.reject(new Error(`Not implemented for ${typeof persistence}.`));
  return {
    listCurrentFocus: pending,
    getCurrentFocus: pending,
    createCurrentFocus: pending,
    updateCurrentFocus: pending,
    deleteCurrentFocus: pending,
  };
}
