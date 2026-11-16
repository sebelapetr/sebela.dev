import { asc, eq, inArray, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { topicColumns } from "./catalogs.js";
import { type Executor, now, topicIds, WriteRefused } from "./relations.js";
import { currentFocus, currentFocusTopics, experiences, projects, topics } from "./schema.js";
import type {
  CurrentFocusFields,
  CurrentFocusPersistence,
  CurrentFocusRecord,
  CurrentFocusRelations,
  CurrentFocusWriteFailure,
  TopicRecord,
} from "./types.js";

const focusColumns = {
  id: currentFocus.id,
  slug: currentFocus.slug,
  title: currentFocus.title,
  description: currentFocus.description,
  link: currentFocus.link,
  position: currentFocus.position,
  projectSlug: projects.slug,
  projectName: projects.name,
  projectExperience: experiences.slug,
  createdAt: currentFocus.createdAt,
  updatedAt: currentFocus.updatedAt,
};

/** The entries by position, then slug, with their project and topics in link order. */
async function loadCurrentFocus(
  db: Executor,
  where: SQL | undefined,
): Promise<CurrentFocusRecord[]> {
  const rows = await db
    .select(focusColumns)
    .from(currentFocus)
    .leftJoin(projects, eq(currentFocus.projectId, projects.id))
    .leftJoin(experiences, eq(projects.experienceId, experiences.id))
    .where(where)
    .orderBy(asc(currentFocus.position), asc(currentFocus.slug));
  if (rows.length === 0) return [];

  const links = await db
    .select({ focusId: currentFocusTopics.currentFocusId, topic: topicColumns })
    .from(currentFocusTopics)
    .innerJoin(topics, eq(currentFocusTopics.topicId, topics.id))
    .where(
      inArray(
        currentFocusTopics.currentFocusId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(asc(currentFocusTopics.currentFocusId), asc(currentFocusTopics.position));
  const linkedTopics = new Map<string, TopicRecord[]>();
  for (const { focusId, topic } of links) {
    linkedTopics.set(focusId, [...(linkedTopics.get(focusId) ?? []), topic]);
  }

  return rows.map(({ projectSlug, projectName, projectExperience, ...row }) => ({
    ...row,
    project:
      projectSlug !== null && projectName !== null && projectExperience !== null
        ? { slug: projectSlug, name: projectName, experience: projectExperience }
        : null,
    topics: linkedTopics.get(row.id) ?? [],
  }));
}

async function loadOne(db: Executor, id: string): Promise<CurrentFocusRecord> {
  const [record] = await loadCurrentFocus(db, eq(currentFocus.id, id));
  if (!record) throw new Error("The written focus entry is missing.");
  return record;
}

/**
 * The id of the project, locked against a concurrent delete until the transaction ends, or `null`
 * for no project. Refuses an unknown slug.
 */
async function projectId(tx: Executor, slug: string | null): Promise<string | null> {
  if (slug === null) return null;
  const [row] = await tx
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, slug))
    .for("key share");
  if (!row)
    throw new WriteRefused<CurrentFocusWriteFailure>({ ok: false, reason: "unknown_project" });
  return row.id;
}

/** Replaces the topic links of the entry with the given slugs in their order. */
async function linkTopics(tx: Executor, currentFocusId: string, slugs: string[]) {
  const ids = await topicIds(tx, slugs);
  await tx.delete(currentFocusTopics).where(eq(currentFocusTopics.currentFocusId, currentFocusId));
  if (ids.length === 0) return;
  await tx
    .insert(currentFocusTopics)
    .values(ids.map((topicId, position) => ({ currentFocusId, topicId, position })));
}

/** Runs a write; a refusal rolls it back and becomes its failure. */
async function refusable<T>(write: () => Promise<T>): Promise<T | CurrentFocusWriteFailure> {
  try {
    return await write();
  } catch (error) {
    // Every refusal thrown by the focus writes is a `CurrentFocusWriteFailure`.
    if (error instanceof WriteRefused) return error.failure as CurrentFocusWriteFailure;
    throw error;
  }
}

/** Scalar changes without the relations, which are resolved separately. */
function scalarChanges(
  changes: Partial<CurrentFocusFields & CurrentFocusRelations>,
): Partial<CurrentFocusFields> {
  const fields: Partial<CurrentFocusFields & CurrentFocusRelations> = { ...changes };
  delete fields.project;
  delete fields.topics;
  return fields;
}

/**
 * The current-focus entries with their optional project and ordered topic links. Every write runs
 * in one transaction, so an entry and its relations are stored completely or not at all. Slugs are
 * unique in the database, an update locks its entry so concurrent replacements serialize, and a
 * write locks the project and topics it links against a concurrent delete. The project key and the
 * topic links have no cascade towards their targets, so a linked project or topic cannot be
 * deleted; the topic links cascade only with their entry.
 */
export function createCurrentFocusPersistence(db: NodePgDatabase): CurrentFocusPersistence {
  return {
    listCurrentFocus() {
      return loadCurrentFocus(db, undefined);
    },
    async findCurrentFocus(slug) {
      const [record] = await loadCurrentFocus(db, eq(currentFocus.slug, slug));
      return record ?? null;
    },
    createCurrentFocus({ project, topics: topicSlugs, ...fields }) {
      return refusable(() =>
        db.transaction(async (tx) => {
          const [row] = await tx
            .insert(currentFocus)
            .values({ ...fields, projectId: await projectId(tx, project) })
            .onConflictDoNothing({ target: currentFocus.slug })
            .returning({ id: currentFocus.id });
          if (!row) return { ok: false, reason: "conflict" } as const;
          await linkTopics(tx, row.id, topicSlugs);
          return { ok: true, focus: await loadOne(tx, row.id) } as const;
        }),
      );
    },
    updateCurrentFocus(slug, changes) {
      return refusable(() =>
        db.transaction(async (tx) => {
          const [current] = await tx
            .select({ id: currentFocus.id })
            .from(currentFocus)
            .where(eq(currentFocus.slug, slug))
            .for("update");
          if (!current) return { ok: false, reason: "not_found" } as const;

          await tx
            .update(currentFocus)
            .set({
              ...scalarChanges(changes),
              ...(changes.project !== undefined && {
                projectId: await projectId(tx, changes.project),
              }),
              updatedAt: now,
            })
            .where(eq(currentFocus.id, current.id));
          if (changes.topics !== undefined) await linkTopics(tx, current.id, changes.topics);
          return { ok: true, focus: await loadOne(tx, current.id) } as const;
        }),
      );
    },
    async deleteCurrentFocus(slug) {
      const rows = await db
        .delete(currentFocus)
        .where(eq(currentFocus.slug, slug))
        .returning({ id: currentFocus.id });
      return rows.length > 0 ? { ok: true } : { ok: false, reason: "not_found" };
    },
  };
}
