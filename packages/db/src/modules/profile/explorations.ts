import { asc, eq, inArray, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { technologyColumns, topicColumns } from "./catalogs.js";
import { breaksCheck } from "./database-errors.js";
import { type Executor, now, technologyIds, topicIds, WriteRefused } from "./relations.js";
import {
  explorations,
  explorationTechnologies,
  explorationTopics,
  technologies,
  topics,
} from "./schema.js";
import type {
  ExplorationFields,
  ExplorationPersistence,
  ExplorationRecord,
  ExplorationRelations,
  ExplorationWriteFailure,
  TechnologyRecord,
  TopicRecord,
} from "./types.js";

const explorationColumns = {
  id: explorations.id,
  slug: explorations.slug,
  name: explorations.name,
  summary: explorations.summary,
  status: explorations.status,
  concepts: explorations.concepts,
  startedOn: explorations.startedOn,
  endedOn: explorations.endedOn,
  position: explorations.position,
  createdAt: explorations.createdAt,
  updatedAt: explorations.updatedAt,
};

const PERIOD_CHECK = "explorations_period_is_ordered";

/** Groups link rows by their exploration, keeping the order of the rows. */
function byExploration<T>(rows: { explorationId: string; target: T }[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const { explorationId, target } of rows) {
    grouped.set(explorationId, [...(grouped.get(explorationId) ?? []), target]);
  }
  return grouped;
}

/** The explorations by position, then slug, with their technologies and topics in link order. */
async function loadExplorations(
  db: Executor,
  where: SQL | undefined,
): Promise<ExplorationRecord[]> {
  const rows = await db
    .select(explorationColumns)
    .from(explorations)
    .where(where)
    .orderBy(asc(explorations.position), asc(explorations.slug));
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);

  const technologyLinks = await db
    .select({ explorationId: explorationTechnologies.explorationId, target: technologyColumns })
    .from(explorationTechnologies)
    .innerJoin(technologies, eq(explorationTechnologies.technologyId, technologies.id))
    .where(inArray(explorationTechnologies.explorationId, ids))
    .orderBy(asc(explorationTechnologies.explorationId), asc(explorationTechnologies.position));
  const topicLinks = await db
    .select({ explorationId: explorationTopics.explorationId, target: topicColumns })
    .from(explorationTopics)
    .innerJoin(topics, eq(explorationTopics.topicId, topics.id))
    .where(inArray(explorationTopics.explorationId, ids))
    .orderBy(asc(explorationTopics.explorationId), asc(explorationTopics.position));

  const linkedTechnologies = byExploration<TechnologyRecord>(technologyLinks);
  const linkedTopics = byExploration<TopicRecord>(topicLinks);
  return rows.map((row) => ({
    ...row,
    technologies: linkedTechnologies.get(row.id) ?? [],
    topics: linkedTopics.get(row.id) ?? [],
  }));
}

async function loadExploration(db: Executor, id: string): Promise<ExplorationRecord> {
  const [record] = await loadExplorations(db, eq(explorations.id, id));
  if (!record) throw new Error("The written exploration is missing.");
  return record;
}

/** Replaces the technology links of the exploration with the given slugs in their order. */
async function linkTechnologies(tx: Executor, explorationId: string, slugs: string[]) {
  const ids = await technologyIds(tx, slugs);
  await tx
    .delete(explorationTechnologies)
    .where(eq(explorationTechnologies.explorationId, explorationId));
  if (ids.length === 0) return;
  await tx
    .insert(explorationTechnologies)
    .values(ids.map((technologyId, position) => ({ explorationId, technologyId, position })));
}

/** Replaces the topic links of the exploration with the given slugs in their order. */
async function linkTopics(tx: Executor, explorationId: string, slugs: string[]) {
  const ids = await topicIds(tx, slugs);
  await tx.delete(explorationTopics).where(eq(explorationTopics.explorationId, explorationId));
  if (ids.length === 0) return;
  await tx
    .insert(explorationTopics)
    .values(ids.map((topicId, position) => ({ explorationId, topicId, position })));
}

/** Runs a write; a refusal or a broken period rolls it back and becomes its failure. */
async function refusable<T>(write: () => Promise<T>): Promise<T | ExplorationWriteFailure> {
  try {
    return await write();
  } catch (error) {
    // Every refusal thrown by the exploration writes is an `ExplorationWriteFailure`.
    if (error instanceof WriteRefused) return error.failure as ExplorationWriteFailure;
    if (breaksCheck(error, PERIOD_CHECK)) return { ok: false, reason: "invalid_period" };
    throw error;
  }
}

/** Scalar changes without the relations, which are written separately. */
function scalarChanges(
  changes: Partial<ExplorationFields & ExplorationRelations>,
): Partial<ExplorationFields> {
  const fields: Partial<ExplorationFields & ExplorationRelations> = { ...changes };
  delete fields.technologies;
  delete fields.topics;
  return fields;
}

/**
 * The explorations and their ordered technology and topic links. Every write runs in one
 * transaction, so an exploration and its links are stored completely or not at all. Slugs are
 * unique in the database, the status is an enum and the period rule a check constraint, an update
 * locks its exploration so concurrent replacements of the links serialize, and the links cascade
 * only with their exploration. An exploration refers to no experience and no project.
 */
export function createExplorationPersistence(db: NodePgDatabase): ExplorationPersistence {
  return {
    listExplorations() {
      return loadExplorations(db, undefined);
    },
    async findExploration(slug) {
      const [record] = await loadExplorations(db, eq(explorations.slug, slug));
      return record ?? null;
    },
    createExploration({ technologies: technologySlugs, topics: topicSlugs, ...fields }) {
      return refusable(() =>
        db.transaction(async (tx) => {
          const [row] = await tx
            .insert(explorations)
            .values(fields)
            .onConflictDoNothing({ target: explorations.slug })
            .returning({ id: explorations.id });
          if (!row) return { ok: false, reason: "conflict" } as const;
          await linkTechnologies(tx, row.id, technologySlugs);
          await linkTopics(tx, row.id, topicSlugs);
          return { ok: true, exploration: await loadExploration(tx, row.id) } as const;
        }),
      );
    },
    updateExploration(slug, changes) {
      return refusable(() =>
        db.transaction(async (tx) => {
          const [current] = await tx
            .select({ id: explorations.id })
            .from(explorations)
            .where(eq(explorations.slug, slug))
            .for("update");
          if (!current) return { ok: false, reason: "not_found" } as const;

          await tx
            .update(explorations)
            .set({ ...scalarChanges(changes), updatedAt: now })
            .where(eq(explorations.id, current.id));
          if (changes.technologies !== undefined) {
            await linkTechnologies(tx, current.id, changes.technologies);
          }
          if (changes.topics !== undefined) {
            await linkTopics(tx, current.id, changes.topics);
          }
          return { ok: true, exploration: await loadExploration(tx, current.id) } as const;
        }),
      );
    },
    async deleteExploration(slug) {
      const rows = await db
        .delete(explorations)
        .where(eq(explorations.slug, slug))
        .returning({ id: explorations.id });
      return rows.length > 0 ? { ok: true } : { ok: false, reason: "not_found" };
    },
  };
}
