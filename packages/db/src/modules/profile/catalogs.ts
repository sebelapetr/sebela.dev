import { asc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { CatalogPersistence } from "./index.js";
import { technologies, topics } from "./schema.js";

const technologyColumns = {
  id: technologies.id,
  slug: technologies.slug,
  name: technologies.name,
  tier: technologies.tier,
  group: technologies.group,
  logoKey: technologies.logoKey,
  position: technologies.position,
  createdAt: technologies.createdAt,
  updatedAt: technologies.updatedAt,
};

const topicColumns = {
  id: topics.id,
  slug: topics.slug,
  name: topics.name,
  position: topics.position,
  createdAt: topics.createdAt,
  updatedAt: topics.updatedAt,
};

/** `clock_timestamp()`, not `now()`: it advances also within one transaction. */
const now = sql`clock_timestamp()`;

/** Whether the error is the database refusing a technology whose group disagrees with its tier. */
function isInconsistentGroup(error: unknown): boolean {
  const cause = error instanceof Error ? error.cause : undefined;
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    "constraint" in cause &&
    cause.code === "23514" &&
    cause.constraint === "technologies_group_matches_tier"
  );
}

/**
 * The ordered technology and topic catalogs. Slugs are unique in the database, so concurrent
 * creates of one slug leave exactly one row, and the tier/group rule is a check constraint.
 */
export function createCatalogPersistence(db: NodePgDatabase): CatalogPersistence {
  return {
    listTechnologies() {
      // Enum columns sort in declaration order: primary, secondary; core, ai_engineering_focus.
      // A secondary technology has no group, and nulls sort last, after both groups.
      return db
        .select(technologyColumns)
        .from(technologies)
        .orderBy(
          asc(technologies.tier),
          asc(technologies.group),
          asc(technologies.position),
          asc(technologies.slug),
        );
    },
    async findTechnology(slug) {
      const [row] = await db
        .select(technologyColumns)
        .from(technologies)
        .where(eq(technologies.slug, slug));
      return row ?? null;
    },
    async createTechnology(fields) {
      try {
        const [row] = await db
          .insert(technologies)
          .values(fields)
          .onConflictDoNothing({ target: technologies.slug })
          .returning(technologyColumns);
        return row ? { ok: true, technology: row } : { ok: false, reason: "conflict" };
      } catch (error) {
        if (isInconsistentGroup(error)) return { ok: false, reason: "inconsistent" };
        throw error;
      }
    },
    async updateTechnology(slug, changes) {
      try {
        const [row] = await db
          .update(technologies)
          .set({ ...changes, updatedAt: now })
          .where(eq(technologies.slug, slug))
          .returning(technologyColumns);
        return row ? { ok: true, technology: row } : { ok: false, reason: "not_found" };
      } catch (error) {
        if (isInconsistentGroup(error)) return { ok: false, reason: "inconsistent" };
        throw error;
      }
    },
    async deleteTechnology(slug) {
      const rows = await db
        .delete(technologies)
        .where(eq(technologies.slug, slug))
        .returning({ id: technologies.id });
      return rows.length > 0;
    },
    listTopics() {
      return db.select(topicColumns).from(topics).orderBy(asc(topics.position), asc(topics.slug));
    },
    async findTopic(slug) {
      const [row] = await db.select(topicColumns).from(topics).where(eq(topics.slug, slug));
      return row ?? null;
    },
    async createTopic(fields) {
      const [row] = await db
        .insert(topics)
        .values(fields)
        .onConflictDoNothing({ target: topics.slug })
        .returning(topicColumns);
      return row ? { ok: true, topic: row } : { ok: false, reason: "conflict" };
    },
    async updateTopic(slug, changes) {
      const [row] = await db
        .update(topics)
        .set({ ...changes, updatedAt: now })
        .where(eq(topics.slug, slug))
        .returning(topicColumns);
      return row ?? null;
    },
    async deleteTopic(slug) {
      const rows = await db
        .delete(topics)
        .where(eq(topics.slug, slug))
        .returning({ id: topics.id });
      return rows.length > 0;
    },
  };
}
