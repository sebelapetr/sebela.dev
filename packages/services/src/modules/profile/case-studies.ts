import type { CaseStudyService } from "./types.js";

const pending = () => Promise.reject(new Error("The case-study service is not implemented yet."));

/** The case studies, at most one per project and addressed by the project's slug. */
export function createCaseStudyService(): CaseStudyService {
  return {
    getCaseStudy: pending,
    createCaseStudy: pending,
    updateCaseStudy: pending,
    deleteCaseStudy: pending,
  };
}
