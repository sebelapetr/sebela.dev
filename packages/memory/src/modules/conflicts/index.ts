// Deterministic checks of a supplemental document's chunks against the structured portfolio facts:
// a year, a role title or a technology a chunk claims for an organization that the API's
// experiences contradict. The checks are deliberately narrow and never claim complete detection.
import type { SourceChunk } from "../ingest/index.js";
import type { PortfolioSnapshot } from "../ports/index.js";

/** What a conflicting claim is about. */
export type DocumentConflictKind = "date" | "role_title" | "technology";

/**
 * A claim of one chunk that contradicts a structured fact: the chunk's ordinal, the portfolio
 * source of the fact, the claim as it appears in the chunk and the fact it contradicts.
 */
export interface DocumentConflict {
  readonly kind: DocumentConflictKind;
  readonly chunkOrdinal: number;
  readonly sourceId: string;
  readonly claim: string;
  readonly fact: string;
}

/**
 * The conflicts of the chunks with the snapshot's experiences, in chunk order. `today` bounds a
 * continuing role (the current year when absent).
 */
export const findConflicts: (
  chunks: readonly SourceChunk[],
  snapshot: PortfolioSnapshot,
  today?: Date,
) => DocumentConflict[] = () => {
  throw new Error("not implemented");
};
