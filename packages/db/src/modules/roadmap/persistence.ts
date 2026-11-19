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
import { bookId, createBookPersistence, linkedBookSlug } from "./books.js";
import { breaksCheck, breaksUnique, isStillReferenced } from "./database-errors.js";
import { createDiaryPersistence } from "./diary.js";
import { createEventPersistence } from "./events.js";
import {
  areas,
  BOOK_LINK_TYPE_CHECK,
  BOOK_LINK_UNIQUE,
  books,
  events,
  modules,
  PERIOD_CHECK,
  RESERVED_SLUG_CHECK,
  resources,
  resourceTopics,
} from "./schema.js";
import type {
  DeleteRoadmapRecordResult,
  RoadmapAreaNode,
  RoadmapAreaRecord,
  RoadmapModuleRecord,
  RoadmapModuleWriteFailure,
  RoadmapPersistence,
  RoadmapResourceFields,
  RoadmapResourceRecord,
  RoadmapResourceRelations,
  RoadmapResourceWriteFailure,
} from "./types.js";

/** `clock_timestamp()`, not `now()`: it advances also within one transaction. */
const now = sql`clock_timestamp()`;

const areaColumns = {
  id: areas.id,
  slug: areas.slug,
  name: areas.name,
  description: areas.description,
  weight: areas.weight,
  position: areas.position,
  createdAt: areas.createdAt,
  updatedAt: areas.updatedAt,
};

const moduleColumns = {
  id: modules.id,
  slug: modules.slug,
  area: areas.slug,
  name: modules.name,
  description: modules.description,
  position: modules.position,
  createdAt: modules.createdAt,
  updatedAt: modules.updatedAt,
};

const resourceColumns = {
  id: resources.id,
  slug: resources.slug,
  module: modules.slug,
  name: resources.name,
  description: resources.description,
  type: resources.type,
  status: resources.status,
  estimatedMinutes: resources.estimatedMinutes,
  startedAt: resources.startedAt,
  finishedAt: resources.finishedAt,
  link: resources.link,
  position: resources.position,
  book: linkedBookSlug,
  createdAt: resources.createdAt,
  updatedAt: resources.updatedAt,
};

/** Groups rows by a key, keeping the order of the rows. */
function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) grouped.set(key(row), [...(grouped.get(key(row)) ?? []), row]);
  return grouped;
}

async function loadAreas(db: Executor, where: SQL | undefined): Promise<RoadmapAreaRecord[]> {
  return db
    .select(areaColumns)
    .from(areas)
    .where(where)
    .orderBy(asc(areas.position), asc(areas.slug));
}

/** Modules with their area's slug and its internal id, by position, then slug. */
async function loadModules(
  db: Executor,
  where: SQL | undefined,
): Promise<{ areaId: string; module: RoadmapModuleRecord }[]> {
  return db
    .select({ areaId: modules.areaId, module: moduleColumns })
    .from(modules)
    .innerJoin(areas, eq(modules.areaId, areas.id))
    .where(where)
    .orderBy(asc(modules.position), asc(modules.slug));
}

/**
 * Resources with their module's slug, its internal id and their topics in link order, by position,
 * then slug.
 */
async function loadResources(
  db: Executor,
  where: SQL | undefined,
): Promise<{ moduleId: string; resource: RoadmapResourceRecord }[]> {
  const rows = await db
    .select({ moduleId: resources.moduleId, resource: resourceColumns })
    .from(resources)
    .innerJoin(modules, eq(resources.moduleId, modules.id))
    .where(where)
    .orderBy(asc(resources.position), asc(resources.slug));
  if (rows.length === 0) return [];

  const links = await db
    .select({ resourceId: resourceTopics.resourceId, topic: topicColumns })
    .from(resourceTopics)
    .innerJoin(topics, eq(resourceTopics.topicId, topics.id))
    .where(
      inArray(
        resourceTopics.resourceId,
        rows.map((row) => row.resource.id),
      ),
    )
    .orderBy(asc(resourceTopics.resourceId), asc(resourceTopics.position));
  const linked = groupBy(links, (link) => link.resourceId);
  return rows.map(({ moduleId, resource }) => ({
    moduleId,
    resource: {
      ...resource,
      topics: (linked.get(resource.id) ?? []).map((link): TopicRecord => link.topic),
    },
  }));
}

async function loadModule(db: Executor, id: string): Promise<RoadmapModuleRecord> {
  const [row] = await loadModules(db, eq(modules.id, id));
  if (!row) throw new Error("The written roadmap module is missing.");
  return row.module;
}

async function loadResource(db: Executor, id: string): Promise<RoadmapResourceRecord> {
  const [row] = await loadResources(db, eq(resources.id, id));
  if (!row) throw new Error("The written roadmap resource is missing.");
  return row.resource;
}

/** The id of the area with the slug, locked against a concurrent delete; refuses an unknown one. */
async function areaId(tx: Executor, slug: string): Promise<string> {
  const [row] = await tx
    .select({ id: areas.id })
    .from(areas)
    .where(eq(areas.slug, slug))
    .for("key share");
  if (!row)
    throw new WriteRefused<RoadmapModuleWriteFailure>({ ok: false, reason: "unknown_area" });
  return row.id;
}

/** The id of the module with the slug, locked against a concurrent delete; refuses an unknown one. */
async function moduleId(tx: Executor, slug: string): Promise<string> {
  const [row] = await tx
    .select({ id: modules.id })
    .from(modules)
    .where(eq(modules.slug, slug))
    .for("key share");
  if (!row) {
    throw new WriteRefused<RoadmapResourceWriteFailure>({ ok: false, reason: "unknown_module" });
  }
  return row.id;
}

/** Replaces the topic links of the resource with the given slugs in their order. */
async function linkTopics(tx: Executor, resourceId: string, slugs: string[]) {
  const ids = await topicIds(tx, slugs);
  await tx.delete(resourceTopics).where(eq(resourceTopics.resourceId, resourceId));
  if (ids.length === 0) return;
  await tx
    .insert(resourceTopics)
    .values(ids.map((topicId, position) => ({ resourceId, topicId, position })));
}

/**
 * Runs a write; a refusal, a broken check or a second link to one book rolls it back and becomes its
 * failure.
 */
async function refusable<T, Failure>(write: () => Promise<T>): Promise<T | Failure> {
  try {
    return await write();
  } catch (error) {
    // Every refusal thrown by a roadmap write is a failure of that write.
    if (error instanceof WriteRefused) return error.failure as Failure;
    if (breaksCheck(error, PERIOD_CHECK)) return { ok: false, reason: "invalid_period" } as Failure;
    if (breaksCheck(error, RESERVED_SLUG_CHECK)) {
      return { ok: false, reason: "reserved_slug" } as Failure;
    }
    if (breaksCheck(error, BOOK_LINK_TYPE_CHECK)) {
      return { ok: false, reason: "book_requires_book_type" } as Failure;
    }
    if (breaksUnique(error, BOOK_LINK_UNIQUE))
      return { ok: false, reason: "book_taken" } as Failure;
    throw error;
  }
}

/** Deletes the row with the slug; `referenced` while a foreign key still points to it. */
async function deleteBySlug(
  db: Database,
  table: typeof areas | typeof modules | typeof resources | typeof books | typeof events,
  slug: string,
): Promise<DeleteRoadmapRecordResult> {
  try {
    // A savepoint inside a caller's transaction keeps a refused delete from aborting it.
    const rows = await db.transaction((tx) =>
      tx.delete(table).where(eq(table.slug, slug)).returning({ id: table.id }),
    );
    return rows.length > 0 ? { ok: true } : { ok: false, reason: "not_found" };
  } catch (error) {
    if (isStillReferenced(error)) return { ok: false, reason: "referenced" };
    throw error;
  }
}

/** Resource field changes without the relations, which are written separately. */
function resourceScalars(
  changes: Partial<RoadmapResourceFields & RoadmapResourceRelations>,
): Partial<RoadmapResourceFields> {
  const fields: Partial<RoadmapResourceFields & RoadmapResourceRelations> = { ...changes };
  delete fields.module;
  delete fields.topics;
  delete fields.book;
  return fields;
}

/** Every roadmap persistence operation over one connection or transaction. */
export function createRoadmapPersistence(db: Database): RoadmapPersistence {
  return {
    ...createDiaryPersistence(db),
    loadRoadmapTree() {
      return db.transaction(
        async (tx): Promise<RoadmapAreaNode[]> => {
          const areaRows = await loadAreas(tx, undefined);
          const moduleRows = groupBy(await loadModules(tx, undefined), (row) => row.areaId);
          const resourceRows = groupBy(await loadResources(tx, undefined), (row) => row.moduleId);
          return areaRows.map((area) => ({
            ...area,
            modules: (moduleRows.get(area.id) ?? []).map(({ module }) => ({
              ...module,
              resources: (resourceRows.get(module.id) ?? []).map(({ resource }) => resource),
            })),
          }));
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    },

    async findRoadmapArea(slug) {
      const [row] = await loadAreas(db, eq(areas.slug, slug));
      return row ?? null;
    },
    createRoadmapArea(fields) {
      return refusable(() =>
        db.transaction(async (tx) => {
          const [row] = await tx
            .insert(areas)
            .values(fields)
            .onConflictDoNothing({ target: areas.slug })
            .returning(areaColumns);
          return row
            ? ({ ok: true, area: row } as const)
            : ({ ok: false, reason: "conflict" } as const);
        }),
      );
    },
    async updateRoadmapArea(slug, changes) {
      const [row] = await db
        .update(areas)
        .set({ ...changes, updatedAt: now })
        .where(eq(areas.slug, slug))
        .returning(areaColumns);
      return row ? { ok: true, area: row } : { ok: false, reason: "not_found" };
    },
    deleteRoadmapArea(slug) {
      return deleteBySlug(db, areas, slug);
    },

    async findRoadmapModule(slug) {
      const [row] = await loadModules(db, eq(modules.slug, slug));
      return row?.module ?? null;
    },
    createRoadmapModule({ area, ...fields }) {
      return refusable(() =>
        db.transaction(async (tx) => {
          const [row] = await tx
            .insert(modules)
            .values({ ...fields, areaId: await areaId(tx, area) })
            .onConflictDoNothing({ target: modules.slug })
            .returning({ id: modules.id });
          if (!row) return { ok: false, reason: "conflict" } as const;
          return { ok: true, module: await loadModule(tx, row.id) } as const;
        }),
      );
    },
    updateRoadmapModule(slug, { area, ...changes }) {
      return refusable(() =>
        db.transaction(async (tx) => {
          const [current] = await tx
            .select({ id: modules.id })
            .from(modules)
            .where(eq(modules.slug, slug))
            .for("update");
          if (!current) return { ok: false, reason: "not_found" } as const;
          await tx
            .update(modules)
            .set({
              ...changes,
              ...(area === undefined ? {} : { areaId: await areaId(tx, area) }),
              updatedAt: now,
            })
            .where(eq(modules.id, current.id));
          return { ok: true, module: await loadModule(tx, current.id) } as const;
        }),
      );
    },
    deleteRoadmapModule(slug) {
      return deleteBySlug(db, modules, slug);
    },

    async findRoadmapResource(slug) {
      const [row] = await loadResources(db, eq(resources.slug, slug));
      return row?.resource ?? null;
    },
    createRoadmapResource({ module, topics: topicSlugs, book, ...fields }) {
      return refusable(() =>
        db.transaction(async (tx) => {
          const [row] = await tx
            .insert(resources)
            .values({
              ...fields,
              moduleId: await moduleId(tx, module),
              bookId: await bookId(tx, book),
            })
            .onConflictDoNothing({ target: resources.slug })
            .returning({ id: resources.id });
          if (!row) return { ok: false, reason: "conflict" } as const;
          await linkTopics(tx, row.id, topicSlugs);
          return { ok: true, resource: await loadResource(tx, row.id) } as const;
        }),
      );
    },
    updateRoadmapResource(slug, changes) {
      return refusable(() =>
        db.transaction(async (tx) => {
          const [current] = await tx
            .select({ id: resources.id })
            .from(resources)
            .where(eq(resources.slug, slug))
            .for("update");
          if (!current) return { ok: false, reason: "not_found" } as const;
          await tx
            .update(resources)
            .set({
              ...resourceScalars(changes),
              ...(changes.module === undefined
                ? {}
                : { moduleId: await moduleId(tx, changes.module) }),
              ...(changes.book === undefined ? {} : { bookId: await bookId(tx, changes.book) }),
              updatedAt: now,
            })
            .where(eq(resources.id, current.id));
          if (changes.topics !== undefined) await linkTopics(tx, current.id, changes.topics);
          return { ok: true, resource: await loadResource(tx, current.id) } as const;
        }),
      );
    },
    deleteRoadmapResource(slug) {
      return deleteBySlug(db, resources, slug);
    },

    ...createBookPersistence(db),
    deleteRoadmapBook(slug) {
      return deleteBySlug(db, books, slug);
    },

    ...createEventPersistence(db),
    deleteRoadmapEvent(slug) {
      return deleteBySlug(db, events, slug);
    },
  };
}
