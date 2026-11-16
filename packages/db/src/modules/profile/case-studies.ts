import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { CaseStudyPersistence } from "./types.js";

// Not yet implemented: the case-study persistence follows its tests.
export function createCaseStudyPersistence(db: NodePgDatabase): CaseStudyPersistence {
  const notYet = (project: string) =>
    Promise.reject(new Error(`Case studies of "${project}" are not stored yet (${typeof db}).`));
  return {
    findCaseStudy: notYet,
    createCaseStudy: notYet,
    updateCaseStudy: notYet,
    deleteCaseStudy: notYet,
  };
}
