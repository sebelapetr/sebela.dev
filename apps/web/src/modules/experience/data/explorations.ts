import type { Exploration, ExplorationStatus } from "@sebela/api-client";

import { anchorId } from "../../_shared";

/** One exploration as the independent R&D block shows it. */
export interface ExplorationRow {
  readonly slug: string;
  /** The stable anchor of the exploration on the page, `exploration-<slug>`. */
  readonly anchor: string;
  readonly name: string;
  /** The stored status; a page never shows one stronger than this. */
  readonly status: ExplorationStatus;
  /** The status as visible text, for example `Designed`. */
  readonly statusLabel: string;
  /** What the status means, shown beside it, for example `Tried hands-on`. */
  readonly statusMeaning: string;
  /** Markdown: one sentence. */
  readonly summary: string;
  /** The concepts involved, in their stored order. */
  readonly concepts: readonly string[];
}

// Designed work is planned or architected only: its wording says so and never claims that it
// works, was tried or was delivered (docs/domain-context.md, Exploration status).
const STATUSES: Record<ExplorationStatus, { label: string; meaning: string }> = {
  built: { label: "Built", meaning: "Implemented and working" },
  tested: { label: "Tested", meaning: "Tried hands-on" },
  designed: { label: "Designed", meaning: "Unimplemented design, planned or architected only" },
};

/**
 * The explorations as the independent R&D block shows them, in the API's order (by position, then
 * slug), each with its stored status as visible text. Kept apart from the career timeline.
 */
export function toExplorationRows(explorations: readonly Exploration[]): ExplorationRow[] {
  return explorations.map((exploration) => {
    const status = STATUSES[exploration.status];
    return {
      slug: exploration.slug,
      anchor: anchorId({ kind: "exploration", slug: exploration.slug }),
      name: exploration.name,
      status: exploration.status,
      statusLabel: status.label,
      statusMeaning: status.meaning,
      summary: exploration.summary,
      concepts: exploration.concepts,
    };
  });
}
