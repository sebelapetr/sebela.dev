import { asc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { organizations } from "./schema.js";
import type { OrganizationPersistence } from "./types.js";

const columns = {
  id: organizations.id,
  slug: organizations.slug,
  name: organizations.name,
  website: organizations.website,
  description: organizations.description,
  createdAt: organizations.createdAt,
  updatedAt: organizations.updatedAt,
};

/** `clock_timestamp()`, not `now()`: it advances also within one transaction. */
const now = sql`clock_timestamp()`;

/** Whether the error is the database refusing a delete because a foreign key still refers to it. */
function isStillReferenced(error: unknown): boolean {
  const cause = error instanceof Error ? error.cause : undefined;
  return typeof cause === "object" && cause !== null && "code" in cause && cause.code === "23503";
}

/**
 * The organizations. Slugs are unique in the database, so concurrent creates of one slug leave
 * exactly one row; referencing tables hold foreign keys, so a referenced row is never deleted.
 */
export function createOrganizationPersistence(db: NodePgDatabase): OrganizationPersistence {
  return {
    listOrganizations() {
      return db
        .select(columns)
        .from(organizations)
        .orderBy(asc(sql`lower(${organizations.name})`), asc(organizations.slug));
    },
    async findOrganization(slug) {
      const [row] = await db
        .select(columns)
        .from(organizations)
        .where(eq(organizations.slug, slug));
      return row ?? null;
    },
    async createOrganization(fields) {
      const [row] = await db
        .insert(organizations)
        .values(fields)
        .onConflictDoNothing({ target: organizations.slug })
        .returning(columns);
      return row ? { ok: true, organization: row } : { ok: false, reason: "conflict" };
    },
    async updateOrganization(slug, changes) {
      const [row] = await db
        .update(organizations)
        .set({ ...changes, updatedAt: now })
        .where(eq(organizations.slug, slug))
        .returning(columns);
      return row ?? null;
    },
    async deleteOrganization(slug) {
      try {
        const rows = await db
          .delete(organizations)
          .where(eq(organizations.slug, slug))
          .returning({ id: organizations.id });
        return rows.length > 0 ? { ok: true } : { ok: false, reason: "not_found" };
      } catch (error) {
        if (isStillReferenced(error)) return { ok: false, reason: "referenced" };
        throw error;
      }
    },
  };
}
