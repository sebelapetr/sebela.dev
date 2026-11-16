import type { Education } from "@sebela/contracts";
import type {
  EducationFields,
  EducationRecord,
  EducationWriteFailure,
  ProfilePersistence,
} from "@sebela/db";

import { DomainError } from "../../errors.js";
import { definedChanges } from "./changes.js";
import type { EducationService } from "./types.js";

const missing = (slug: string) =>
  new DomainError("not_found", `There is no education record "${slug}".`);

export function toEducation(record: EducationRecord): Education {
  return {
    ...record,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

const PERIOD_RULE = "The end cannot be before the start.";
const DATE_RULE = "Give the start, the end or both.";

/** A refused period as a `validation_failed` naming the dates at fault. */
function refused(failure: EducationWriteFailure): DomainError {
  switch (failure.reason) {
    case "invalid_period":
      return new DomainError("validation_failed", PERIOD_RULE, [
        { path: "endedOn", message: PERIOD_RULE },
      ]);
    case "undated_period":
      return new DomainError("validation_failed", DATE_RULE, [
        { path: "startedOn", message: DATE_RULE },
        { path: "endedOn", message: DATE_RULE },
      ]);
  }
}

/**
 * The education records with their kind exactly as stored. Persistence judges the period and slug
 * uniqueness on the resulting row, so a refused write leaves nothing behind.
 */
export function createEducationService(persistence: ProfilePersistence): EducationService {
  return {
    async listEducation() {
      return (await persistence.listEducation()).map(toEducation);
    },
    async getEducation(slug) {
      const record = await persistence.findEducation(slug);
      if (!record) throw missing(slug);
      return toEducation(record);
    },
    async createEducation(input) {
      const result = await persistence.createEducation(input);
      if (result.ok) return toEducation(result.education);
      if (result.reason === "conflict") {
        throw new DomainError("conflict", `An education record "${input.slug}" already exists.`);
      }
      throw refused(result);
    },
    async updateEducation(slug, changes) {
      const result = await persistence.updateEducation(
        slug,
        definedChanges<EducationFields>(changes),
      );
      if (result.ok) return toEducation(result.education);
      if (result.reason === "not_found") throw missing(slug);
      throw refused(result);
    },
    async deleteEducation(slug) {
      const result = await persistence.deleteEducation(slug);
      if (!result.ok) throw missing(slug);
    },
  };
}
