import type { CleanupFailure } from "@sebela/services";

import type { Logger } from "../../middleware/logging.js";

/** Logs a stored file the media workflow could not remove. Not implemented yet. */
export function logCleanupFailure(log: Logger): (failure: CleanupFailure) => void {
  return () => {
    throw new Error(`Not implemented: ${typeof log}`);
  };
}
