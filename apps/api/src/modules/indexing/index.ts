/**
 * Keeps the knowledge index current after committed content writes, inside the API process.
 *
 * Usable as the app's `onWrite`: each change is queued in the database at once (a deleted record's
 * passages leave search then, a changed record's until it is indexed again) and a background run
 * then works through the queue in bounded batches, one run at a time. A write never waits for the
 * provider and never fails because of it. While the provider is unavailable the run retries after
 * each of `retryDelaysMs` and then stops until the next write or start; at the month's ceiling it
 * stops at once. Queued work survives a restart: `start` runs the queue against the current
 * portfolio. Logs name the outcome and counts or an error code; never content or settings.
 */
import type { ContentChange } from "@sebela/contracts";
import type { KnowledgeService } from "@sebela/services";

import type { Logger } from "../../middleware/logging.js";

export interface IndexingQueueOptions {
  readonly knowledge: Pick<KnowledgeService, "schedule" | "processPending">;
  readonly log: Logger;
  /** The pause before each retry while the provider is unavailable; its length bounds them. */
  readonly retryDelaysMs?: readonly number[];
}

export interface IndexingQueue {
  /** Queues the change and starts a run; never rejects. Usable as the app's `onWrite`. */
  readonly notify: (event: { readonly change: ContentChange }) => Promise<void>;
  /** Starts a run over the queued work and the current portfolio, as after a restart. */
  readonly start: () => void;
  /** Resolves once no run is in progress or waiting. */
  readonly idle: () => Promise<void>;
  /** Stops after the batch in progress and ignores later changes. */
  readonly close: () => Promise<void>;
}

export const createIndexingQueue: (options: IndexingQueueOptions) => IndexingQueue = () => {
  const missing = () => Promise.reject(new Error("not implemented"));
  return {
    notify: missing,
    start: () => {
      throw new Error("not implemented");
    },
    idle: missing,
    close: missing,
  };
};
