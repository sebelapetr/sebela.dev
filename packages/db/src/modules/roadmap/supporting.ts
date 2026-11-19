// Supporting-content persistence, private to the roadmap module: project ideas with their ordered
// topic links, followed sources and glossary terms. Each is an independent list ordered by
// position, then slug; nothing refers to these records, so a delete is refused only when the slug
// is missing.
import { asc, eq, inArray, sql, type SQL } from "drizzle-orm";

import type { Database } from "../../database.js";
import {
  type Executor,
  topicColumns,
  topicIds,
  topics,
  type TopicRecord,
  WriteRefused,
} from "../profile/index.js";
import { followedSources, glossaryTerms, projectIdeas, projectIdeaTopics } from "./schema.js";
import type {
  DeleteRoadmapSupportingResult,
  RoadmapPersistence,
  RoadmapProjectIdeaFields,
  RoadmapProjectIdeaRecord,
  RoadmapProjectIdeaRelations,
  RoadmapProjectIdeaWriteFailure,
} from "./types.js";

type SupportingPersistence = Pick<
  RoadmapPersistence,
  | "listRoadmapProjectIdeas"
  | "findRoadmapProjectIdea"
  | "createRoadmapProjectIdea"
  | "updateRoadmapProjectIdea"
  | "deleteRoadmapProjectIdea"
  | "listRoadmapFollowedSources"
  | "findRoadmapFollowedSource"
  | "createRoadmapFollowedSource"
  | "updateRoadmapFollowedSource"
  | "deleteRoadmapFollowedSource"
  | "listRoadmapGlossaryTerms"
  | "findRoadmapGlossaryTerm"
  | "createRoadmapGlossaryTerm"
  | "updateRoadmapGlossaryTerm"
  | "deleteRoadmapGlossaryTerm"
>;

/** `clock_timestamp()`, not `now()`: it advances also within one transaction. */
const now = sql`clock_timestamp()`;

const readOnly = { isolationLevel: "repeatable read", accessMode: "read only" } as const;

const ideaColumns = {
  id: projectIdeas.id,
  slug: projectIdeas.slug,
  title: projectIdeas.title,
  whyItMatters: projectIdeas.whyItMatters,
  howToStart: projectIdeas.howToStart,
  position: projectIdeas.position,
  createdAt: projectIdeas.createdAt,
  updatedAt: projectIdeas.updatedAt,
};

const sourceColumns = {
  id: followedSources.id,
  slug: followedSources.slug,
  title: followedSources.title,
  description: followedSources.description,
  link: followedSources.link,
  kind: followedSources.kind,
  position: followedSources.position,
  createdAt: followedSources.createdAt,
  updatedAt: followedSources.updatedAt,
};

const termColumns = {
  id: glossaryTerms.id,
  slug: glossaryTerms.slug,
  term: glossaryTerms.term,
  description: glossaryTerms.description,
  position: glossaryTerms.position,
  createdAt: glossaryTerms.createdAt,
  updatedAt: glossaryTerms.updatedAt,
};

/** Project ideas with their topics in link order, by position, then slug. */
async function loadIdeas(
  db: Executor,
  where: SQL | undefined,
): Promise<RoadmapProjectIdeaRecord[]> {
  const rows = await db
    .select(ideaColumns)
    .from(projectIdeas)
    .where(where)
    .orderBy(asc(projectIdeas.position), asc(projectIdeas.slug));
  if (rows.length === 0) return [];

  const links = await db
    .select({ projectIdeaId: projectIdeaTopics.projectIdeaId, topic: topicColumns })
    .from(projectIdeaTopics)
    .innerJoin(topics, eq(projectIdeaTopics.topicId, topics.id))
    .where(
      inArray(
        projectIdeaTopics.projectIdeaId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(asc(projectIdeaTopics.projectIdeaId), asc(projectIdeaTopics.position));
  return rows.map((row) => ({
    ...row,
    topics: links
      .filter((link) => link.projectIdeaId === row.id)
      .map((link): TopicRecord => link.topic),
  }));
}

async function loadIdea(db: Executor, id: string): Promise<RoadmapProjectIdeaRecord> {
  const [row] = await loadIdeas(db, eq(projectIdeas.id, id));
  if (!row) throw new Error("The written project idea is missing.");
  return row;
}

/** Replaces the topic links of the idea with the given slugs in their order. */
async function linkTopics(tx: Executor, projectIdeaId: string, slugs: string[]) {
  const ids = await topicIds(tx, slugs);
  await tx.delete(projectIdeaTopics).where(eq(projectIdeaTopics.projectIdeaId, projectIdeaId));
  if (ids.length === 0) return;
  await tx
    .insert(projectIdeaTopics)
    .values(ids.map((topicId, position) => ({ projectIdeaId, topicId, position })));
}

/** Runs an idea write; a topic refusal rolls it back and becomes its failure. */
async function refusableIdea<T>(
  write: () => Promise<T>,
): Promise<T | RoadmapProjectIdeaWriteFailure> {
  try {
    return await write();
  } catch (error) {
    if (error instanceof WriteRefused) return error.failure as RoadmapProjectIdeaWriteFailure;
    throw error;
  }
}

/** Idea field changes without the topics, which are written separately. */
function ideaScalars(
  changes: Partial<RoadmapProjectIdeaFields & RoadmapProjectIdeaRelations>,
): Partial<RoadmapProjectIdeaFields> {
  const fields: Partial<RoadmapProjectIdeaFields & RoadmapProjectIdeaRelations> = { ...changes };
  delete fields.topics;
  return fields;
}

/** Deletes the record of a slugged supporting table; its link rows cascade. */
async function deleteSupporting(
  db: Database,
  table: typeof projectIdeas | typeof followedSources | typeof glossaryTerms,
  slug: string,
): Promise<DeleteRoadmapSupportingResult> {
  const rows = await db.delete(table).where(eq(table.slug, slug)).returning({ id: table.id });
  return rows.length > 0 ? { ok: true } : { ok: false, reason: "not_found" };
}

/** Every supporting-content operation over one connection or transaction. */
export function createSupportingPersistence(db: Database): SupportingPersistence {
  return {
    listRoadmapProjectIdeas() {
      return db.transaction((tx) => loadIdeas(tx, undefined), readOnly);
    },
    findRoadmapProjectIdea(slug) {
      return db.transaction(
        async (tx) => (await loadIdeas(tx, eq(projectIdeas.slug, slug)))[0] ?? null,
        readOnly,
      );
    },
    createRoadmapProjectIdea({ topics: topicSlugs, ...fields }) {
      return refusableIdea(() =>
        db.transaction(async (tx) => {
          const [row] = await tx
            .insert(projectIdeas)
            .values(fields)
            .onConflictDoNothing({ target: projectIdeas.slug })
            .returning({ id: projectIdeas.id });
          if (!row) return { ok: false, reason: "conflict" } as const;
          await linkTopics(tx, row.id, topicSlugs);
          return { ok: true, projectIdea: await loadIdea(tx, row.id) } as const;
        }),
      );
    },
    updateRoadmapProjectIdea(slug, changes) {
      return refusableIdea(() =>
        db.transaction(async (tx) => {
          const [current] = await tx
            .select({ id: projectIdeas.id })
            .from(projectIdeas)
            .where(eq(projectIdeas.slug, slug))
            .for("update");
          if (!current) return { ok: false, reason: "not_found" } as const;
          await tx
            .update(projectIdeas)
            .set({ ...ideaScalars(changes), updatedAt: now })
            .where(eq(projectIdeas.id, current.id));
          if (changes.topics !== undefined) await linkTopics(tx, current.id, changes.topics);
          return { ok: true, projectIdea: await loadIdea(tx, current.id) } as const;
        }),
      );
    },
    deleteRoadmapProjectIdea(slug) {
      return deleteSupporting(db, projectIdeas, slug);
    },

    listRoadmapFollowedSources() {
      return db
        .select(sourceColumns)
        .from(followedSources)
        .orderBy(asc(followedSources.position), asc(followedSources.slug));
    },
    async findRoadmapFollowedSource(slug) {
      const [row] = await db
        .select(sourceColumns)
        .from(followedSources)
        .where(eq(followedSources.slug, slug));
      return row ?? null;
    },
    async createRoadmapFollowedSource(fields) {
      const [row] = await db
        .insert(followedSources)
        .values(fields)
        .onConflictDoNothing({ target: followedSources.slug })
        .returning(sourceColumns);
      return row ? { ok: true, followedSource: row } : { ok: false, reason: "conflict" };
    },
    async updateRoadmapFollowedSource(slug, changes) {
      const [row] = await db
        .update(followedSources)
        .set({ ...changes, updatedAt: now })
        .where(eq(followedSources.slug, slug))
        .returning(sourceColumns);
      return row ? { ok: true, followedSource: row } : { ok: false, reason: "not_found" };
    },
    deleteRoadmapFollowedSource(slug) {
      return deleteSupporting(db, followedSources, slug);
    },

    listRoadmapGlossaryTerms() {
      return db
        .select(termColumns)
        .from(glossaryTerms)
        .orderBy(asc(glossaryTerms.position), asc(glossaryTerms.slug));
    },
    async findRoadmapGlossaryTerm(slug) {
      const [row] = await db
        .select(termColumns)
        .from(glossaryTerms)
        .where(eq(glossaryTerms.slug, slug));
      return row ?? null;
    },
    async createRoadmapGlossaryTerm(fields) {
      const [row] = await db
        .insert(glossaryTerms)
        .values(fields)
        .onConflictDoNothing({ target: glossaryTerms.slug })
        .returning(termColumns);
      return row ? { ok: true, glossaryTerm: row } : { ok: false, reason: "conflict" };
    },
    async updateRoadmapGlossaryTerm(slug, changes) {
      const [row] = await db
        .update(glossaryTerms)
        .set({ ...changes, updatedAt: now })
        .where(eq(glossaryTerms.slug, slug))
        .returning(termColumns);
      return row ? { ok: true, glossaryTerm: row } : { ok: false, reason: "not_found" };
    },
    deleteRoadmapGlossaryTerm(slug) {
      return deleteSupporting(db, glossaryTerms, slug);
    },
  };
}
