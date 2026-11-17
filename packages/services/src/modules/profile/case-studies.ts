import type { CaseStudy } from "@sebela/contracts";
import type { CaseStudyFields, CaseStudyRecord, ProfilePersistence } from "@sebela/db";

import { DomainError } from "../../errors.js";
import { definedChanges } from "./changes.js";
import type { CaseStudyService } from "./types.js";

const missing = (project: string) =>
  new DomainError("not_found", `The project "${project}" has no case study.`);

/** A stored case study in the contract shape; the project stays its slug. */
export function toCaseStudy(record: CaseStudyRecord): CaseStudy {
  return {
    ...record,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

/**
 * The case studies, at most one per project and addressed by the project's slug. Persistence
 * decides uniqueness, also of racing creates, on the stored project reference.
 */
export function createCaseStudyService(persistence: ProfilePersistence): CaseStudyService {
  return {
    async getCaseStudy(project) {
      const record = await persistence.findCaseStudy(project);
      if (!record) throw missing(project);
      return toCaseStudy(record);
    },
    async createCaseStudy(project, input) {
      const result = await persistence.createCaseStudy(project, input);
      if (result.ok) return toCaseStudy(result.caseStudy);
      if (result.reason === "unknown_project") {
        throw new DomainError("not_found", `There is no project "${project}".`);
      }
      throw new DomainError("conflict", `The project "${project}" already has a case study.`);
    },
    async updateCaseStudy(project, changes) {
      const result = await persistence.updateCaseStudy(
        project,
        definedChanges<CaseStudyFields>(changes),
      );
      if (!result.ok) throw missing(project);
      return toCaseStudy(result.caseStudy);
    },
    async deleteCaseStudy(project) {
      const result = await persistence.deleteCaseStudy(project);
      if (!result.ok) throw missing(project);
    },
  };
}
