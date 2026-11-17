import { asc, eq, inArray } from "drizzle-orm";

import type { Database } from "../../database.js";
import { technologyColumns } from "./catalogs.js";
import { breaksCheck, isStillReferenced } from "./database-errors.js";
import { organizationColumns } from "./organizations.js";
import { loadProjects } from "./projects.js";
import { experienceOrder, type Executor, now, technologyIds, WriteRefused } from "./relations.js";
import {
  experienceTechnologies,
  experiences,
  organizations,
  projects,
  technologies,
  testimonials,
} from "./schema.js";
import { loadTestimonials } from "./testimonials.js";
import type {
  ExperienceFields,
  ExperiencePersistence,
  ExperienceRecord,
  ExperienceRelations,
  ExperienceWriteFailure,
  ProjectRecord,
  TechnologyRecord,
  TestimonialRecord,
} from "./types.js";

const experienceColumns = {
  id: experiences.id,
  slug: experiences.slug,
  title: experiences.title,
  kind: experiences.kind,
  startedOn: experiences.startedOn,
  endedOn: experiences.endedOn,
  summary: experiences.summary,
  responsibilities: experiences.responsibilities,
  inCv: experiences.inCv,
  createdAt: experiences.createdAt,
  updatedAt: experiences.updatedAt,
  organization: organizationColumns,
};

const PERIOD_CHECK = "experiences_period_is_ordered";

/**
 * The experiences with their organization, their technologies in link order, and their projects
 * and testimonials, each by position, then slug.
 */
export async function loadExperiences(
  db: Executor,
  where: ReturnType<typeof eq> | undefined,
): Promise<ExperienceRecord[]> {
  const rows = await db
    .select(experienceColumns)
    .from(experiences)
    .innerJoin(organizations, eq(experiences.organizationId, organizations.id))
    .where(where)
    .orderBy(...experienceOrder);
  if (rows.length === 0) return [];

  const links = await db
    .select({ experienceId: experienceTechnologies.experienceId, technology: technologyColumns })
    .from(experienceTechnologies)
    .innerJoin(technologies, eq(experienceTechnologies.technologyId, technologies.id))
    .where(
      inArray(
        experienceTechnologies.experienceId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(asc(experienceTechnologies.experienceId), asc(experienceTechnologies.position));
  const linked = new Map<string, TechnologyRecord[]>();
  for (const { experienceId, technology } of links) {
    linked.set(experienceId, [...(linked.get(experienceId) ?? []), technology]);
  }

  const owned = new Map<string, ProjectRecord[]>();
  const ids = rows.map((row) => row.id);
  for (const project of await loadProjects(db, inArray(projects.experienceId, ids))) {
    owned.set(project.experience, [...(owned.get(project.experience) ?? []), project]);
  }
  const quoted = new Map<string, TestimonialRecord[]>();
  for (const testimonial of await loadTestimonials(db, inArray(testimonials.experienceId, ids))) {
    quoted.set(testimonial.experience, [
      ...(quoted.get(testimonial.experience) ?? []),
      testimonial,
    ]);
  }
  return rows.map((row) => ({
    ...row,
    technologies: linked.get(row.id) ?? [],
    projects: owned.get(row.slug) ?? [],
    testimonials: quoted.get(row.slug) ?? [],
  }));
}

async function loadExperience(db: Executor, id: string): Promise<ExperienceRecord> {
  const [record] = await loadExperiences(db, eq(experiences.id, id));
  if (!record) throw new Error("The written experience is missing.");
  return record;
}

/**
 * The id of the organization, locked against a concurrent delete until the transaction ends.
 * Refuses an unknown slug.
 */
async function organizationId(tx: Executor, slug: string): Promise<string> {
  const [row] = await tx
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .for("key share");
  if (!row) {
    throw new WriteRefused<ExperienceWriteFailure>({ ok: false, reason: "unknown_organization" });
  }
  return row.id;
}

/** Replaces the technology links of the experience with the given slugs in their order. */
async function linkTechnologies(tx: Executor, experienceId: string, slugs: string[]) {
  const ids = await technologyIds(tx, slugs);
  await tx
    .delete(experienceTechnologies)
    .where(eq(experienceTechnologies.experienceId, experienceId));
  if (ids.length === 0) return;
  await tx
    .insert(experienceTechnologies)
    .values(ids.map((technologyId, position) => ({ experienceId, technologyId, position })));
}

/** Runs a write; a refusal or a broken period rolls it back and becomes its failure. */
async function refusable<T>(write: () => Promise<T>): Promise<T | ExperienceWriteFailure> {
  try {
    return await write();
  } catch (error) {
    // Every refusal thrown by the experience writes is an `ExperienceWriteFailure`.
    if (error instanceof WriteRefused) return error.failure as ExperienceWriteFailure;
    if (breaksCheck(error, PERIOD_CHECK)) return { ok: false, reason: "invalid_period" };
    throw error;
  }
}

/** Scalar changes without the relations, which are written separately. */
function scalarChanges(
  changes: Partial<ExperienceFields & ExperienceRelations>,
): Partial<ExperienceFields> {
  const fields: Partial<ExperienceFields & ExperienceRelations> = { ...changes };
  delete fields.organization;
  delete fields.technologies;
  return fields;
}

/**
 * The experiences and their ordered technology links. Every write runs in one transaction, so an
 * experience and its links are stored completely or not at all. Slugs are unique in the database,
 * the period rule is a check constraint, an update locks its experience so concurrent
 * replacements of the links serialize, and the links cascade only with their experience. Projects
 * and testimonials refer to their experience without a cascade, so an experience with one is not
 * deleted.
 */
export function createExperiencePersistence(db: Database): ExperiencePersistence {
  return {
    listExperiences() {
      return loadExperiences(db, undefined);
    },
    async findExperience(slug) {
      const [record] = await loadExperiences(db, eq(experiences.slug, slug));
      return record ?? null;
    },
    createExperience({ organization, technologies: slugs, ...fields }) {
      return refusable(() =>
        db.transaction(async (tx) => {
          const [row] = await tx
            .insert(experiences)
            .values({ ...fields, organizationId: await organizationId(tx, organization) })
            .onConflictDoNothing({ target: experiences.slug })
            .returning({ id: experiences.id });
          if (!row) return { ok: false, reason: "conflict" } as const;
          await linkTechnologies(tx, row.id, slugs);
          return { ok: true, experience: await loadExperience(tx, row.id) } as const;
        }),
      );
    },
    updateExperience(slug, changes) {
      return refusable(() =>
        db.transaction(async (tx) => {
          const [current] = await tx
            .select({ id: experiences.id })
            .from(experiences)
            .where(eq(experiences.slug, slug))
            .for("update");
          if (!current) return { ok: false, reason: "not_found" } as const;

          const organization =
            changes.organization === undefined
              ? {}
              : { organizationId: await organizationId(tx, changes.organization) };
          await tx
            .update(experiences)
            .set({ ...scalarChanges(changes), ...organization, updatedAt: now })
            .where(eq(experiences.id, current.id));
          if (changes.technologies !== undefined) {
            await linkTechnologies(tx, current.id, changes.technologies);
          }
          return { ok: true, experience: await loadExperience(tx, current.id) } as const;
        }),
      );
    },
    async deleteExperience(slug) {
      try {
        const rows = await db
          .delete(experiences)
          .where(eq(experiences.slug, slug))
          .returning({ id: experiences.id });
        return rows.length > 0 ? { ok: true } : { ok: false, reason: "not_found" };
      } catch (error) {
        if (isStillReferenced(error)) return { ok: false, reason: "referenced" };
        throw error;
      }
    },
  };
}
