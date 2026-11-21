// Turns committed content changes into queued indexing work. A deleted record's sources leave the
// index at once and a changed record's sources leave search at once, before any embedding; so do
// the sources a changed record is indexed inside (a testimonial in its experience, a technology or
// organization name in every record that lists it) and the sources gone with a deleted parent,
// found by comparing the index with the current portfolio. The queued items make a later run
// reconcile the portfolio, also after a restart.
import { portfolioSources } from "../ingest/index.js";
import {
  portfolioSourceId,
  type ContentChange,
  type PortfolioContentKind,
} from "@sebela/contracts";

import type { PortfolioSnapshot, RetrievalStore, WorkOperation } from "../ports/index.js";

/**
 * Queues indexing for these changes and, in the same transaction, excludes from search every
 * indexed portfolio source that no longer matches `current`, the portfolio as it is after the
 * changes committed: sources missing from it are removed, sources whose version differs are
 * marked stale. The sources the changes name directly are excluded whatever `current` holds.
 */
export async function scheduleChanges(
  store: Pick<RetrievalStore, "scheduleWork" | "indexedSources">,
  changes: readonly ContentChange[],
  current: PortfolioSnapshot,
): Promise<void> {
  if (changes.length === 0) return;
  const remove = new Set<string>();
  const stale = new Set<string>();
  const items: { sourceId: string; operation: WorkOperation }[] = [];
  for (const change of changes) {
    const affected = sourcesOf(change);
    const removed = change.action === "deleted" && !keptOnDelete.has(change.domain);
    for (const sourceId of affected) (removed ? remove : stale).add(sourceId);
    items.push({
      sourceId: affected[0] ?? WHOLE_PORTFOLIO,
      operation: change.action === "deleted" ? "remove" : "index",
    });
  }
  const versions = new Map(
    portfolioSources(current).map((source) => [source.sourceId, source.version]),
  );
  for (const indexed of await store.indexedSources()) {
    if (indexed.sourceKind !== "portfolio" || remove.has(indexed.sourceId)) continue;
    const version = versions.get(indexed.sourceId);
    if (version === undefined) remove.add(indexed.sourceId);
    else if (version !== indexed.version) stale.add(indexed.sourceId);
  }
  await store.scheduleWork({
    removeSourceIds: [...remove],
    staleSourceIds: [...stale].filter((sourceId) => !remove.has(sourceId)),
    items,
  });
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
 * organizations, testimonials and the like) affect none directly; comparing the index with the
 * current portfolio finds the sources they appear in.
 */
function sourcesOf(change: ContentChange): string[] {
  if (change.domain === "person") return [portfolioSourceId("profile", "person")];
  const kinds = kindsOf[change.domain];
  if (kinds === undefined) return [];
  const { record } = change;
  return kinds.map((kind) => portfolioSourceId(kind, record));
}
