import type { Organization } from "@sebela/contracts";
import type { OrganizationFields, OrganizationRecord, ProfilePersistence } from "@sebela/db";

import { DomainError } from "../../errors.js";
import { definedChanges } from "./changes.js";
import { isMediaRefusal, mediaRefused } from "./media-references.js";
import type { OrganizationService } from "./types.js";

const missing = (slug: string) =>
  new DomainError("not_found", `There is no organization "${slug}".`);

/** The organization in the contract shape; also used where another record resolves it. */
export function toOrganization(record: OrganizationRecord): Organization {
  return {
    ...record,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

/**
 * The organizations. The database decides slug uniqueness and whether a record still refers to an
 * organization, so a racing create or a delete during a new reference is judged on stored rows.
 */
export function createOrganizationService(persistence: ProfilePersistence): OrganizationService {
  return {
    async listOrganizations() {
      return (await persistence.listOrganizations()).map(toOrganization);
    },
    async getOrganization(slug) {
      const record = await persistence.findOrganization(slug);
      if (!record) throw missing(slug);
      return toOrganization(record);
    },
    async createOrganization(input) {
      const result = await persistence.createOrganization(input);
      if (!result.ok) {
        if (isMediaRefusal(result)) throw mediaRefused(result);
        throw new DomainError("conflict", `An organization "${input.slug}" already exists.`);
      }
      return toOrganization(result.organization);
    },
    async updateOrganization(slug, changes) {
      const result = await persistence.updateOrganization(
        slug,
        definedChanges<OrganizationFields>(changes),
      );
      if (!result.ok) throw isMediaRefusal(result) ? mediaRefused(result) : missing(slug);
      return toOrganization(result.organization);
    },
    async deleteOrganization(slug) {
      const result = await persistence.deleteOrganization(slug);
      if (result.ok) return;
      if (result.reason === "not_found") throw missing(slug);
      throw new DomainError(
        "conflict",
        `The organization "${slug}" is still referenced by other records; remove those references first.`,
      );
    },
  };
}
