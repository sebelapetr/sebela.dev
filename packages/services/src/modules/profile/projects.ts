import type { Project } from "@sebela/contracts";
import type {
  ProfilePersistence,
  ProjectFields,
  ProjectRecord,
  ProjectRelations,
  ProjectWriteFailure,
} from "@sebela/db";

import { DomainError } from "../../errors.js";
import { toCaseStudy } from "./case-studies.js";
import { toTechnology } from "./catalogs.js";
import { definedChanges } from "./changes.js";
import type { ProjectService } from "./types.js";

const missing = (slug: string) => new DomainError("not_found", `There is no project "${slug}".`);

/** A stored project in the contract shape with its case study; the experience stays its slug. */
export function toProject(record: ProjectRecord): Project {
  return {
    ...record,
    links: record.links.map(({ label, url }) => ({ label, url })),
    technologies: record.technologies.map(toTechnology),
    caseStudy: record.caseStudy ? toCaseStudy(record.caseStudy) : null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

/** A refused write of the given relations as a `validation_failed` naming the offending field. */
function refused(
  failure: ProjectWriteFailure,
  written: { experience?: string | undefined },
): DomainError {
  const invalid = (path: string, message: string) =>
    new DomainError("validation_failed", message, [{ path, message }]);
  switch (failure.reason) {
    case "unknown_experience":
      return invalid(
        "experience",
        `There is no experience "${written.experience ?? ""}"; create it first.`,
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
 * The projects, each owned by exactly one experience, with their technologies resolved.
 * Persistence writes a project and its technology links in one transaction and judges the owning
 * experience, relation targets, the period and slug uniqueness on stored rows, so a refused write
 * leaves nothing behind.
 */
export function createProjectService(persistence: ProfilePersistence): ProjectService {
  return {
    async listProjects() {
      return (await persistence.listProjects()).map(toProject);
    },
    async getProject(slug) {
      const record = await persistence.findProject(slug);
      if (!record) throw missing(slug);
      return toProject(record);
    },
    async createProject(input) {
      const result = await persistence.createProject(input);
      if (result.ok) return toProject(result.project);
      if (result.reason === "conflict") {
        throw new DomainError("conflict", `A project "${input.slug}" already exists.`);
      }
      throw refused(result, input);
    },
    async updateProject(slug, changes) {
      const result = await persistence.updateProject(
        slug,
        definedChanges<ProjectFields & ProjectRelations>(changes),
      );
      if (result.ok) return toProject(result.project);
      if (result.reason === "not_found") throw missing(slug);
      throw refused(result, changes);
    },
    async deleteProject(slug) {
      const result = await persistence.deleteProject(slug);
      if (result.ok) return;
      if (result.reason === "not_found") throw missing(slug);
      throw new DomainError(
        "conflict",
        `The project "${slug}" still has a case study or is named as evidence by a service; remove those first.`,
      );
    },
  };
}
