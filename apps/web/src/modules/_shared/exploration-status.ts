// An exploration's stored status in words, the same on every page that shows one (docs/design.md,
// Independent R&D). Designed work is planned or architected only: its wording says so and never
// claims that it works, was tried or was delivered (docs/domain-context.md, Exploration status).
import type { ExplorationStatus } from "@sebela/api-client";

/** An exploration's stored status as visible text: a short label and what it means. */
export interface ExplorationStatusText {
  /** For example `Designed`. */
  readonly label: string;
  /** For example `Unimplemented design, planned or architected only`. */
  readonly meaning: string;
}

const STATUSES: Record<ExplorationStatus, ExplorationStatusText> = {
  built: { label: "Built", meaning: "Implemented and working" },
  tested: { label: "Tested", meaning: "Tried hands-on" },
  designed: { label: "Designed", meaning: "Unimplemented design, planned or architected only" },
};

/** The status as visible text, never stronger than the stored status. */
export function explorationStatusText(status: ExplorationStatus): ExplorationStatusText {
  return STATUSES[status];
}
