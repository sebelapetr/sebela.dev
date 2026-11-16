import { asc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { isStillReferenced } from "./database-errors.js";
import { checkMediaReferences, type MediaReference, refusingMedia } from "./media.js";
import { organizations } from "./schema.js";
import type { OrganizationMedia, OrganizationPersistence } from "./types.js";

/** The returned columns of an organization, also when another record resolves it. */
export const organizationColumns = {
  id: organizations.id,
  slug: organizations.slug,
  name: organizations.name,
  website: organizations.website,
  description: organizations.description,
  logoId: organizations.logoId,
  createdAt: organizations.createdAt,
  updatedAt: organizations.updatedAt,
};

/** The logo must be an image. */
const logo = (fields: Partial<OrganizationMedia>): MediaReference[] => [
  { field: "logoId", id: fields.logoId, kind: "image" },
];

/** `clock_timestamp()`, not `now()`: it advances also within one transaction. */
const now = sql`clock_timestamp()`;

/**
 * The organizations. Slugs are unique in the database, so concurrent creates of one slug leave
 * exactly one row; referencing tables hold foreign keys, so a referenced row is never deleted. A
 * write that sets a logo checks it and locks it in the same transaction.
 */
export function createOrganizationPersistence(db: NodePgDatabase): OrganizationPersistence {
  return {
    listOrganizations() {
      return db
        .select(organizationColumns)
        .from(organizations)
        .orderBy(asc(sql`lower(${organizations.name})`), asc(organizations.slug));
    },
    async findOrganization(slug) {
      const [row] = await db
        .select(organizationColumns)
        .from(organizations)
        .where(eq(organizations.slug, slug));
      return row ?? null;
    },
    createOrganization(fields) {
      return refusingMedia(() =>
        db.transaction(async (tx) => {
          await checkMediaReferences(tx, logo(fields));
          const [row] = await tx
            .insert(organizations)
            .values(fields)
            .onConflictDoNothing({ target: organizations.slug })
            .returning(organizationColumns);
          return row
            ? ({ ok: true, organization: row } as const)
            : ({ ok: false, reason: "conflict" } as const);
        }),
      );
    },
    updateOrganization(slug, changes) {
      return refusingMedia(() =>
        db.transaction(async (tx) => {
          await checkMediaReferences(tx, logo(changes));
          const [row] = await tx
            .update(organizations)
            .set({ ...changes, updatedAt: now })
            .where(eq(organizations.slug, slug))
            .returning(organizationColumns);
          return row
            ? ({ ok: true, organization: row } as const)
            : ({ ok: false, reason: "not_found" } as const);
        }),
      );
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
