import { eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { type Executor, now } from "./relations.js";
import { caseStudies, projects } from "./schema.js";
import type { CaseStudyPersistence, CaseStudyRecord } from "./types.js";

const columns = {
  id: caseStudies.id,
  role: caseStudies.role,
  body: caseStudies.body,
  createdAt: caseStudies.createdAt,
  updatedAt: caseStudies.updatedAt,
};

/** The case studies of the given projects by project id, each naming its project by slug. */
export async function loadCaseStudies(
  db: Executor,
  projectIds: string[],
): Promise<Map<string, CaseStudyRecord>> {
  if (projectIds.length === 0) return new Map();
  const rows = await db
    .select({ projectId: caseStudies.projectId, project: projects.slug, ...columns })
    .from(caseStudies)
    .innerJoin(projects, eq(caseStudies.projectId, projects.id))
    .where(inArray(caseStudies.projectId, projectIds));
  return new Map(rows.map(({ projectId, ...record }) => [projectId, record]));
}

/** The ids of the project with the slug; a subquery, so a write needs no separate lookup. */
const projectIdOf = (db: Executor, slug: string) =>
  db.select({ id: projects.id }).from(projects).where(eq(projects.slug, slug));

/**
 * The case studies, at most one per project and addressed by the project's slug. The unique
 * project reference decides racing creates inside the database; the reference has no cascade, so
 * a project keeps its case study until the case study itself is deleted.
 */
export function createCaseStudyPersistence(db: NodePgDatabase): CaseStudyPersistence {
  return {
    async findCaseStudy(project) {
      const [row] = await db
        .select(columns)
        .from(caseStudies)
        .where(inArray(caseStudies.projectId, projectIdOf(db, project)));
      return row ? { ...row, project } : null;
    },
    createCaseStudy(project, fields) {
      return db.transaction(async (tx) => {
        // Locked against a concurrent delete of the project until the case study is stored.
        const [owner] = await projectIdOf(tx, project).for("key share");
        if (!owner) return { ok: false, reason: "unknown_project" } as const;
        const [row] = await tx
          .insert(caseStudies)
          .values({ ...fields, projectId: owner.id })
          .onConflictDoNothing({ target: caseStudies.projectId })
          .returning(columns);
        if (!row) return { ok: false, reason: "conflict" } as const;
        return { ok: true, caseStudy: { ...row, project } } as const;
      });
    },
    async updateCaseStudy(project, changes) {
      const [row] = await db
        .update(caseStudies)
        .set({ ...changes, updatedAt: now })
        .where(inArray(caseStudies.projectId, projectIdOf(db, project)))
        .returning(columns);
      return row
        ? { ok: true, caseStudy: { ...row, project } }
        : { ok: false, reason: "not_found" };
    },
    async deleteCaseStudy(project) {
      const rows = await db
        .delete(caseStudies)
        .where(inArray(caseStudies.projectId, projectIdOf(db, project)))
        .returning({ id: caseStudies.id });
      return rows.length > 0 ? { ok: true } : { ok: false, reason: "not_found" };
    },
  };
}
