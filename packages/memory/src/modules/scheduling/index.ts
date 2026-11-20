// Turns committed content changes into queued indexing work. A deleted record's sources leave the
// index at once and a changed record's sources leave search at once, before any embedding; the
// queued items make a later run reconcile the portfolio, also after a restart.
import type { ContentChange } from "@sebela/contracts";

import type { RetrievalStore } from "../ports/index.js";

/** Queues indexing for these changes and excludes their sources from search in one transaction. */
export const scheduleChanges: (
  store: Pick<RetrievalStore, "scheduleWork">,
  changes: readonly ContentChange[],
) => Promise<void> = () => Promise.reject(new Error("not implemented"));
