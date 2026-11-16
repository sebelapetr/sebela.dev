import type { Service } from "@sebela/contracts";
import type {
  ProfilePersistence,
  ServiceEvidence,
  ServiceFields,
  ServiceRecord,
  ServiceWriteFailure,
} from "@sebela/db";

import { DomainError } from "../../errors.js";
import { definedChanges } from "./changes.js";
import type { ServiceService } from "./types.js";

const missing = (slug: string) => new DomainError("not_found", `There is no service "${slug}".`);

function toService(record: ServiceRecord): Service {
  return {
    ...record,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

/** A refused evidence write as a `validation_failed` naming the evidence. */
function refused(failure: ServiceWriteFailure): DomainError {
  const invalid = (message: string) =>
    new DomainError("validation_failed", message, [{ path: "evidence", message }]);
  switch (failure.reason) {
    case "unknown_projects":
      return invalid(`There is no project ${failure.slugs.join(", ")}; create it first.`);
    case "repeated_projects":
      return invalid("List each project once.");
    case "unknown_explorations":
      return invalid(`There is no exploration ${failure.slugs.join(", ")}; create it first.`);
    case "repeated_explorations":
      return invalid("List each exploration once.");
  }
}

/**
 * The services with their evidence resolved in its stored order. Persistence writes a service and
 * its evidence in one transaction and judges the named projects, explorations and slug uniqueness
 * on stored rows, so a refused write leaves the previous service and evidence intact.
 */
export function createServiceService(persistence: ProfilePersistence): ServiceService {
  return {
    async listServices() {
      return (await persistence.listServices()).map(toService);
    },
    async getService(slug) {
      const record = await persistence.findService(slug);
      if (!record) throw missing(slug);
      return toService(record);
    },
    async createService(input) {
      const result = await persistence.createService(input);
      if (result.ok) return toService(result.service);
      if (result.reason === "conflict") {
        throw new DomainError("conflict", `A service "${input.slug}" already exists.`);
      }
      throw refused(result);
    },
    async updateService(slug, changes) {
      const result = await persistence.updateService(
        slug,
        definedChanges<ServiceFields & { evidence: ServiceEvidence[] }>(changes),
      );
      if (result.ok) return toService(result.service);
      if (result.reason === "not_found") throw missing(slug);
      throw refused(result);
    },
    async deleteService(slug) {
      const result = await persistence.deleteService(slug);
      if (!result.ok) throw missing(slug);
    },
  };
}
