import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { technologyColumns } from "./catalogs.js";
import { breaksCheck, isStillReferenced } from "./database-errors.js";
import { organizationColumns } from "./organizations.js";
import { experienceTechnologies, experiences, organizations, technologies } from "./schema.js";
import type {
  ExperienceFields,
  ExperiencePersistence,
  ExperienceRecord,
  ExperienceRelations,
  ExperienceWriteFailure,
  TechnologyRecord,
} from "./types.js";

/** A connection or an open transaction; both run the same queries. */
type Executor = Pick<NodePgDatabase, "select" | "insert" | "update" | "delete">;

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

/** Current roles (no end) first, then the latest start, the latest end and the slug. */
const listOrder = [
  asc(sql`${experiences.endedOn} IS NOT NULL`),
  desc(experiences.startedOn),
  desc(experiences.endedOn),
  asc(experiences.slug),
];

/** `clock_timestamp()`, not `now()`: it advances also within one transaction. */
const now = sql`clock_timestamp()`;

const PERIOD_CHECK = "experiences_period_is_ordered";

/** Thrown inside a transaction to roll it back and return the failure instead. */
class WriteRefused extends Error {
  constructor(readonly failure: ExperienceWriteFailure) {
    super(failure.reason);
  }
}

/** The experiences with their organization and their technologies in link order. */
async function loadExperiences(
  db: Executor,
  where: ReturnType<typeof eq> | undefined,
): Promise<ExperienceRecord[]> {
  const rows = await db
    .select(experienceColumns)
    .from(experiences)
    .innerJoin(organizations, eq(experiences.organizationId, organizations.id))
    .where(where)
    .orderBy(...listOrder);
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
  return rows.map((row) => ({ ...row, technologies: linked.get(row.id) ?? [], projects: [] }));
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
  if (!row) throw new WriteRefused({ ok: false, reason: "unknown_organization" });
  return row.id;
}

/**
 * Replaces the technology links of the experience with the given slugs in their order. The
 * technologies are locked against a concurrent delete; repeated or unknown slugs are refused.
 */
async function linkTechnologies(tx: Executor, experienceId: string, slugs: string[]) {
  if (new Set(slugs).size !== slugs.length) {
    throw new WriteRefused({ ok: false, reason: "repeated_technologies" });
  }
  await tx
    .delete(experienceTechnologies)
    .where(eq(experienceTechnologies.experienceId, experienceId));
  if (slugs.length === 0) return;

  const rows = await tx
    .select({ id: technologies.id, slug: technologies.slug })
    .from(technologies)
    .where(inArray(technologies.slug, slugs))
    .for("key share");
  const ids = new Map(rows.map((row) => [row.slug, row.id]));
  const unknown = slugs.filter((slug) => !ids.has(slug));
  if (unknown.length > 0) {
    throw new WriteRefused({ ok: false, reason: "unknown_technologies", slugs: unknown });
  }
  await tx.insert(experienceTechnologies).values(
    slugs.map((slug, position) => ({
      experienceId,
      technologyId: ids.get(slug) ?? "",
      position,
    })),
  );
}

/** Runs a write; a refusal or a broken period rolls it back and becomes its failure. */
async function refusable<T>(write: () => Promise<T>): Promise<T | ExperienceWriteFailure> {
  try {
    return await write();
  } catch (error) {
    if (error instanceof WriteRefused) return error.failure;
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
 * replacements of the links serialize, and the links cascade only with their experience.
 */
export function createExperiencePersistence(db: NodePgDatabase): ExperiencePersistence {
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
