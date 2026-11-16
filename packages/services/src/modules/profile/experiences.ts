import type { Experience } from "@sebela/contracts";
import type {
  ExperienceFields,
  ExperienceRecord,
  ExperienceRelations,
  ExperienceWriteFailure,
  ProfilePersistence,
} from "@sebela/db";

import { DomainError } from "../../errors.js";
import { toTechnology } from "./catalogs.js";
import { definedChanges } from "./changes.js";
import { toOrganization } from "./organizations.js";
import type { ExperienceService } from "./types.js";

const missing = (slug: string) => new DomainError("not_found", `There is no experience "${slug}".`);

function toExperience(record: ExperienceRecord): Experience {
  return {
    ...record,
    organization: toOrganization(record.organization),
    technologies: record.technologies.map(toTechnology),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

/** A refused write of the given relations as a `validation_failed` naming the offending field. */
function refused(
  failure: ExperienceWriteFailure,
  written: { organization?: string | undefined },
): DomainError {
  const invalid = (path: string, message: string) =>
    new DomainError("validation_failed", message, [{ path, message }]);
  switch (failure.reason) {
    case "unknown_organization":
      return invalid(
        "organization",
        `There is no organization "${written.organization ?? ""}"; create it first.`,
      );
    case "unknown_technologies":
      return invalid(
        "technologies",
        `There is no technology ${failure.slugs.join(", ")}; create it first.`,
      );
    case "repeated_technologies":
      return invalid("technologies", "List each technology once.");
    case "invalid_period":
      return invalid("endedOn", "The end cannot be before the start.");
  }
}

/**
 * The experiences with their organization and technologies resolved. Persistence writes an
 * experience and its technology links in one transaction and judges relation targets, the period
 * and slug uniqueness on stored rows, so a refused write leaves nothing behind.
 */
export function createExperienceService(persistence: ProfilePersistence): ExperienceService {
  return {
    async listExperiences() {
      return (await persistence.listExperiences()).map(toExperience);
    },
    async getExperience(slug) {
      const record = await persistence.findExperience(slug);
      if (!record) throw missing(slug);
      return toExperience(record);
    },
    async createExperience(input) {
      const result = await persistence.createExperience(input);
      if (result.ok) return toExperience(result.experience);
      if (result.reason === "conflict") {
        throw new DomainError("conflict", `An experience "${input.slug}" already exists.`);
      }
      throw refused(result, input);
    },
    async updateExperience(slug, changes) {
      const result = await persistence.updateExperience(
        slug,
        definedChanges<ExperienceFields & ExperienceRelations>(changes),
      );
      if (result.ok) return toExperience(result.experience);
      if (result.reason === "not_found") throw missing(slug);
      throw refused(result, changes);
    },
    async deleteExperience(slug) {
      const result = await persistence.deleteExperience(slug);
      if (result.ok) return;
      if (result.reason === "not_found") throw missing(slug);
      throw new DomainError(
        "conflict",
        `The experience "${slug}" is still referenced by other records; remove those references first.`,
      );
    },
  };
}
