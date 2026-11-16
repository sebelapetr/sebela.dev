import { asc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { breaksCheck } from "./database-errors.js";
import { now } from "./relations.js";
import { education } from "./schema.js";
import type { EducationPersistence, EducationWriteFailure } from "./types.js";

const columns = {
  id: education.id,
  slug: education.slug,
  kind: education.kind,
  title: education.title,
  institution: education.institution,
  startedOn: education.startedOn,
  endedOn: education.endedOn,
  description: education.description,
  position: education.position,
  createdAt: education.createdAt,
  updatedAt: education.updatedAt,
};

/** Runs one write and turns a broken period check into its failure; other errors propagate. */
async function refusable<Result>(write: () => Promise<Result>) {
  try {
    return await write();
  } catch (error) {
    if (breaksCheck(error, "education_period_is_ordered")) {
      return { ok: false, reason: "invalid_period" } satisfies EducationWriteFailure;
    }
    if (breaksCheck(error, "education_period_is_dated")) {
      return { ok: false, reason: "undated_period" } satisfies EducationWriteFailure;
    }
    throw error;
  }
}

/**
 * The education records. Slugs are unique in the database, so concurrent creates of one slug
 * leave exactly one row. Each write is one statement and the period checks apply to the
 * resulting row, so an update that would leave an invalid period changes nothing.
 */
export function createEducationPersistence(db: NodePgDatabase): EducationPersistence {
  return {
    listEducation() {
      return db
        .select(columns)
        .from(education)
        .orderBy(asc(education.position), asc(education.slug));
    },
    async findEducation(slug) {
      const [row] = await db.select(columns).from(education).where(eq(education.slug, slug));
      return row ?? null;
    },
    createEducation(fields) {
      return refusable(async () => {
        const [row] = await db
          .insert(education)
          .values(fields)
          .onConflictDoNothing({ target: education.slug })
          .returning(columns);
        return row
          ? ({ ok: true, education: row } as const)
          : ({ ok: false, reason: "conflict" } as const);
      });
    },
    updateEducation(slug, changes) {
      return refusable(async () => {
        const [row] = await db
          .update(education)
          .set({ ...changes, updatedAt: now })
          .where(eq(education.slug, slug))
          .returning(columns);
        return row
          ? ({ ok: true, education: row } as const)
          : ({ ok: false, reason: "not_found" } as const);
      });
    },
    async deleteEducation(slug) {
      const rows = await db
        .delete(education)
        .where(eq(education.slug, slug))
        .returning({ id: education.id });
      return rows.length > 0 ? { ok: true } : { ok: false, reason: "not_found" };
    },
  };
}
