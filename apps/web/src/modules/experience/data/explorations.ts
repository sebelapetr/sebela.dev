import type { Exploration, ExplorationStatus } from "@sebela/api-client";

/** One exploration as the independent R&D block shows it. */
export interface ExplorationRow {
  readonly slug: string;
  readonly anchor: string;
  readonly name: string;
  readonly status: ExplorationStatus;
  readonly statusLabel: string;
  readonly statusMeaning: string;
  readonly summary: string;
  readonly concepts: readonly string[];
}

export function toExplorationRows(explorations: readonly Exploration[]): ExplorationRow[] {
  throw new Error(`not implemented (${String(explorations.length)})`);
}
