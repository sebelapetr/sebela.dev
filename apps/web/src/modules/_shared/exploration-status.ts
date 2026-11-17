import type { Exploration } from "@sebela/api-client";

/** An exploration's stored status as visible text: a short label and what it means. */
export interface ExplorationStatusText {
  readonly label: string;
  readonly meaning: string;
}

export function explorationStatusText(status: Exploration["status"]): ExplorationStatusText {
  throw new Error(`not implemented: ${String(Boolean(status))}`);
}
