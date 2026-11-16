import { asc, eq, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { experienceOrder, type Executor, now, WriteRefused } from "./relations.js";
import { experiences, testimonials } from "./schema.js";
import type {
  TestimonialPersistence,
  TestimonialRecord,
  TestimonialWriteFailure,
} from "./types.js";

const testimonialColumns = {
  id: testimonials.id,
  slug: testimonials.slug,
  experience: experiences.slug,
  quote: testimonials.quote,
  authorName: testimonials.authorName,
  authorRole: testimonials.authorRole,
  position: testimonials.position,
  createdAt: testimonials.createdAt,
  updatedAt: testimonials.updatedAt,
};

/**
 * The testimonials, grouped by experience in the experience order, then by position and slug.
 * Within one experience that is position, then slug.
 */
export function loadTestimonials(
  db: Executor,
  where: SQL | undefined,
): Promise<TestimonialRecord[]> {
  return db
    .select(testimonialColumns)
    .from(testimonials)
    .innerJoin(experiences, eq(testimonials.experienceId, experiences.id))
    .where(where)
    .orderBy(...experienceOrder, asc(testimonials.position), asc(testimonials.slug));
}

async function loadTestimonial(db: Executor, id: string): Promise<TestimonialRecord> {
  const [record] = await loadTestimonials(db, eq(testimonials.id, id));
  if (!record) throw new Error("The written testimonial is missing.");
  return record;
}

/**
 * The id of the experience, locked against a concurrent delete until the transaction ends.
 * Refuses an unknown slug.
 */
async function experienceId(tx: Executor, slug: string): Promise<string> {
  const [row] = await tx
    .select({ id: experiences.id })
    .from(experiences)
    .where(eq(experiences.slug, slug))
    .for("key share");
  if (!row) {
    throw new WriteRefused<TestimonialWriteFailure>({ ok: false, reason: "unknown_experience" });
  }
  return row.id;
}

/** Runs a write; a refusal rolls it back and becomes its failure. */
async function refusable<T>(write: () => Promise<T>): Promise<T | TestimonialWriteFailure> {
  try {
    return await write();
  } catch (error) {
    // Every refusal thrown by the testimonial writes is a `TestimonialWriteFailure`.
    if (error instanceof WriteRefused) return error.failure as TestimonialWriteFailure;
    throw error;
  }
}

/**
 * The testimonials, each belonging to exactly one experience. The experience is a required foreign
 * key without a cascade: a write locks it against a concurrent delete, and an experience with a
 * testimonial cannot be deleted. Slugs are unique in the database; each write runs in one
 * transaction, so a refused move changes nothing.
 */
export function createTestimonialPersistence(db: NodePgDatabase): TestimonialPersistence {
  return {
    listTestimonials() {
      return loadTestimonials(db, undefined);
    },
    async findTestimonial(slug) {
      const [record] = await loadTestimonials(db, eq(testimonials.slug, slug));
      return record ?? null;
    },
    createTestimonial({ experience, ...fields }) {
      return refusable(() =>
        db.transaction(async (tx) => {
          const [row] = await tx
            .insert(testimonials)
            .values({ ...fields, experienceId: await experienceId(tx, experience) })
            .onConflictDoNothing({ target: testimonials.slug })
            .returning({ id: testimonials.id });
          if (!row) return { ok: false, reason: "conflict" } as const;
          return { ok: true, testimonial: await loadTestimonial(tx, row.id) } as const;
        }),
      );
    },
    updateTestimonial(slug, { experience, ...fields }) {
      return refusable(() =>
        db.transaction(async (tx) => {
          const [current] = await tx
            .select({ id: testimonials.id })
            .from(testimonials)
            .where(eq(testimonials.slug, slug))
            .for("update");
          if (!current) return { ok: false, reason: "not_found" } as const;

          const owner =
            experience === undefined ? {} : { experienceId: await experienceId(tx, experience) };
          await tx
            .update(testimonials)
            .set({ ...fields, ...owner, updatedAt: now })
            .where(eq(testimonials.id, current.id));
          return { ok: true, testimonial: await loadTestimonial(tx, current.id) } as const;
        }),
      );
    },
    async deleteTestimonial(slug) {
      const rows = await db
        .delete(testimonials)
        .where(eq(testimonials.slug, slug))
        .returning({ id: testimonials.id });
      return rows.length > 0 ? { ok: true } : { ok: false, reason: "not_found" };
    },
  };
}
