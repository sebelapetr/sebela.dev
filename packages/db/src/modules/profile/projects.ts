import { asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { loadCaseStudies } from "./case-studies.js";
import { technologyColumns } from "./catalogs.js";
import { breaksCheck, isStillReferenced } from "./database-errors.js";
import { experienceOrder, type Executor, now, technologyIds, WriteRefused } from "./relations.js";
import { experiences, projectTechnologies, projects, technologies } from "./schema.js";
import type {
  ProjectFields,
  ProjectPersistence,
  ProjectRecord,
  ProjectRelations,
  ProjectWriteFailure,
  TechnologyRecord,
} from "./types.js";

const projectColumns = {
  id: projects.id,
  slug: projects.slug,
  experience: experiences.slug,
  name: projects.name,
  summary: projects.summary,
  problem: projects.problem,
  workDone: projects.workDone,
  result: projects.result,
  startedOn: projects.startedOn,
  endedOn: projects.endedOn,
  links: projects.links,
  selectedForHomepage: projects.selectedForHomepage,
  position: projects.position,
  coverId: sql<string | null>`null`,
  createdAt: projects.createdAt,
  updatedAt: projects.updatedAt,
};

const PERIOD_CHECK = "projects_period_is_ordered";

/**
 * The projects with their technologies in link order and their case study: grouped by owning experience in the
 * experience order, then by position and slug. Within one experience that is position, then slug.
 */
export async function loadProjects(db: Executor, where: SQL | undefined): Promise<ProjectRecord[]> {
  const rows = await db
    .select(projectColumns)
    .from(projects)
    .innerJoin(experiences, eq(projects.experienceId, experiences.id))
    .where(where)
    .orderBy(...experienceOrder, asc(projects.position), asc(projects.slug));
  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);
  const caseStudies = await loadCaseStudies(db, ids);
  const links = await db
    .select({ projectId: projectTechnologies.projectId, technology: technologyColumns })
    .from(projectTechnologies)
    .innerJoin(technologies, eq(projectTechnologies.technologyId, technologies.id))
    .where(inArray(projectTechnologies.projectId, ids))
    .orderBy(asc(projectTechnologies.projectId), asc(projectTechnologies.position));
  const linked = new Map<string, TechnologyRecord[]>();
  for (const { projectId, technology } of links) {
    linked.set(projectId, [...(linked.get(projectId) ?? []), technology]);
  }
  return rows.map((row) => ({
    ...row,
    technologies: linked.get(row.id) ?? [],
    caseStudy: caseStudies.get(row.id) ?? null,
  }));
}

async function loadProject(db: Executor, id: string): Promise<ProjectRecord> {
  const [record] = await loadProjects(db, eq(projects.id, id));
  if (!record) throw new Error("The written project is missing.");
  return record;
}

/**
 * The id of the owning experience, locked against a concurrent delete until the transaction
 * ends. Refuses an unknown slug.
 */
async function experienceId(tx: Executor, slug: string): Promise<string> {
  const [row] = await tx
    .select({ id: experiences.id })
    .from(experiences)
    .where(eq(experiences.slug, slug))
    .for("key share");
  if (!row) {
    throw new WriteRefused<ProjectWriteFailure>({ ok: false, reason: "unknown_experience" });
  }
  return row.id;
}

/** Replaces the technology links of the project with the given slugs in their order. */
async function linkTechnologies(tx: Executor, projectId: string, slugs: string[]) {
  const ids = await technologyIds(tx, slugs);
  await tx.delete(projectTechnologies).where(eq(projectTechnologies.projectId, projectId));
  if (ids.length === 0) return;
  await tx
    .insert(projectTechnologies)
    .values(ids.map((technologyId, position) => ({ projectId, technologyId, position })));
}

/** Runs a write; a refusal or a broken period rolls it back and becomes its failure. */
async function refusable<T>(write: () => Promise<T>): Promise<T | ProjectWriteFailure> {
  try {
    return await write();
  } catch (error) {
    // Every refusal thrown by the project writes is a `ProjectWriteFailure`.
    if (error instanceof WriteRefused) return error.failure as ProjectWriteFailure;
    if (breaksCheck(error, PERIOD_CHECK)) return { ok: false, reason: "invalid_period" };
    throw error;
  }
}

/** Scalar changes without the relations, which are written separately. */
function scalarChanges(changes: Partial<ProjectFields & ProjectRelations>): Partial<ProjectFields> {
  const fields: Partial<ProjectFields & ProjectRelations> = { ...changes };
  delete fields.experience;
  delete fields.technologies;
  return fields;
}

/**
 * The projects, each owned by exactly one experience, and their ordered technology links. Every
 * write runs in one transaction, so a project and its links are stored completely or not at all.
 * The owning experience is a required foreign key without a cascade: a write locks it against a
 * concurrent delete, and an experience that owns a project cannot be deleted. Slugs are unique in
 * the database, the period rule is a check constraint, an update locks its project so concurrent
 * replacements of the links serialize, and the links cascade only with their project.
 */
export function createProjectPersistence(db: NodePgDatabase): ProjectPersistence {
  return {
    listProjects() {
      return loadProjects(db, undefined);
    },
    async findProject(slug) {
      const [record] = await loadProjects(db, eq(projects.slug, slug));
      return record ?? null;
    },
    createProject({ experience, technologies: slugs, ...fields }) {
      return refusable(() =>
        db.transaction(async (tx) => {
          const [row] = await tx
            .insert(projects)
            .values({ ...fields, experienceId: await experienceId(tx, experience) })
            .onConflictDoNothing({ target: projects.slug })
            .returning({ id: projects.id });
          if (!row) return { ok: false, reason: "conflict" } as const;
          await linkTechnologies(tx, row.id, slugs);
          return { ok: true, project: await loadProject(tx, row.id) } as const;
        }),
      );
    },
    updateProject(slug, changes) {
      return refusable(() =>
        db.transaction(async (tx) => {
          const [current] = await tx
            .select({ id: projects.id })
            .from(projects)
            .where(eq(projects.slug, slug))
            .for("update");
          if (!current) return { ok: false, reason: "not_found" } as const;

          const owner =
            changes.experience === undefined
              ? {}
              : { experienceId: await experienceId(tx, changes.experience) };
          await tx
            .update(projects)
            .set({ ...scalarChanges(changes), ...owner, updatedAt: now })
            .where(eq(projects.id, current.id));
          if (changes.technologies !== undefined) {
            await linkTechnologies(tx, current.id, changes.technologies);
          }
          return { ok: true, project: await loadProject(tx, current.id) } as const;
        }),
      );
    },
    async deleteProject(slug) {
      try {
        const rows = await db
          .delete(projects)
          .where(eq(projects.slug, slug))
          .returning({ id: projects.id });
        return rows.length > 0 ? { ok: true } : { ok: false, reason: "not_found" };
      } catch (error) {
        if (isStillReferenced(error)) return { ok: false, reason: "referenced" };
        throw error;
      }
    },
  };
}
