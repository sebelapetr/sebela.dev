// Turns committed content changes into queued indexing work. A deleted record's sources leave the
// index at once and a changed record's sources leave search at once, before any embedding; the
// queued items make a later run reconcile the portfolio, also after a restart.
import {
  portfolioSourceId,
  type ContentChange,
  type PortfolioContentKind,
} from "@sebela/contracts";

import type { PortfolioSnapshot, RetrievalStore, WorkOperation } from "../ports/index.js";

/** Queues indexing for these changes and excludes their sources from search in one transaction. */
export const scheduleChanges: (
  store: Pick<RetrievalStore, "scheduleWork" | "indexedSources">,
  changes: readonly ContentChange[],
  current: PortfolioSnapshot,
) => Promise<void> = scheduleDirect;

async function scheduleDirect(
  store: Pick<RetrievalStore, "scheduleWork">,
  changes: readonly ContentChange[],
): Promise<void> {
  if (changes.length === 0) return;
  const removeSourceIds: string[] = [];
  const staleSourceIds: string[] = [];
  const items: { sourceId: string; operation: WorkOperation }[] = [];
  for (const change of changes) {
    const affected = sourcesOf(change);
    const remove = change.action === "deleted" && !keptOnDelete.has(change.domain);
    (remove ? removeSourceIds : staleSourceIds).push(...affected);
    items.push({
      sourceId: affected[0] ?? WHOLE_PORTFOLIO,
      operation: change.action === "deleted" ? "remove" : "index",
    });
  }
  await store.scheduleWork({ removeSourceIds, staleSourceIds, items });
}

/** The work item of a change that maps to no one source: the run reconciles the whole portfolio. */
const WHOLE_PORTFOLIO = "portfolio";

/**
 * Domains whose record is one source, by the source kind it is indexed as. A project is its own
 * source and its case study's; a diary day is one source whatever changed in it.
 */
const kindsOf: Partial<Record<ContentChange["domain"], readonly PortfolioContentKind[]>> = {
  experience: ["experience"],
  project: ["project", "case_study"],
  "case-study": ["case_study"],
  exploration: ["exploration"],
  service: ["service"],
  education: ["education"],
  "roadmap-area": ["roadmap_area"],
  "roadmap-module": ["roadmap_module"],
  "roadmap-resource": ["roadmap_resource"],
  "roadmap-diary": ["diary_day"],
  "roadmap-book": ["book"],
  "roadmap-event": ["event"],
  "roadmap-glossary-term": ["glossary_term"],
};

/**
 * A deleted diary entry or session leaves the day's other notes in place, so the day's source is
 * only hidden; the run removes it if the day has no notes left.
 */
const keptOnDelete: ReadonlySet<ContentChange["domain"]> = new Set(["roadmap-diary"]);

/**
 * The sources a change affects directly. Records indexed only inside others (technologies,
 * organizations, testimonials and the like) affect none directly; the run finds what changed.
 */
function sourcesOf(change: ContentChange): string[] {
  if (change.domain === "person") return [portfolioSourceId("profile", "person")];
  const kinds = kindsOf[change.domain];
  if (kinds === undefined) return [];
  const { record } = change;
  return kinds.map((kind) => portfolioSourceId(kind, record));
}
