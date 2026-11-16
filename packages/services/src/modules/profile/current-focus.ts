import type { CurrentFocus } from "@sebela/contracts";
import type {
  CurrentFocusFields,
  CurrentFocusRecord,
  CurrentFocusRelations,
  CurrentFocusWriteFailure,
  ProfilePersistence,
} from "@sebela/db";

import { DomainError } from "../../errors.js";
import { toTopic } from "./catalogs.js";
import { definedChanges } from "./changes.js";
import type { CurrentFocusService } from "./types.js";

const missing = (slug: string) =>
  new DomainError("not_found", `There is no current-focus entry "${slug}".`);

function toCurrentFocus(record: CurrentFocusRecord): CurrentFocus {
  return {
    ...record,
    project: record.project && { ...record.project },
    topics: record.topics.map(toTopic),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

/** A refused write of the given relations as a `validation_failed` naming the offending field. */
function refused(failure: CurrentFocusWriteFailure, project: string | null | undefined) {
  const invalid = (path: string, message: string) =>
    new DomainError("validation_failed", message, [{ path, message }]);
  switch (failure.reason) {
    case "unknown_project":
      return invalid("project", `There is no project "${project ?? ""}"; create it first.`);
    case "unknown_topics":
      return invalid("topics", `There is no topic ${failure.slugs.join(", ")}; create it first.`);
    case "repeated_topics":
      return invalid("topics", "List each topic once.");
  }
}

/**
 * The current-focus entries with their optional project and topics resolved. Persistence writes an
 * entry and its relations in one transaction and judges relation targets and slug uniqueness on
 * stored rows, so a refused write leaves nothing behind.
 */
export function createCurrentFocusService(persistence: ProfilePersistence): CurrentFocusService {
  return {
    async listCurrentFocus() {
      return (await persistence.listCurrentFocus()).map(toCurrentFocus);
    },
    async getCurrentFocus(slug) {
      const record = await persistence.findCurrentFocus(slug);
      if (!record) throw missing(slug);
      return toCurrentFocus(record);
    },
    async createCurrentFocus(input) {
      const result = await persistence.createCurrentFocus(input);
      if (result.ok) return toCurrentFocus(result.focus);
      if (result.reason === "conflict") {
        throw new DomainError("conflict", `A current-focus entry "${input.slug}" already exists.`);
      }
      throw refused(result, input.project);
    },
    async updateCurrentFocus(slug, changes) {
      const result = await persistence.updateCurrentFocus(
        slug,
        definedChanges<CurrentFocusFields & CurrentFocusRelations>(changes),
      );
      if (result.ok) return toCurrentFocus(result.focus);
      if (result.reason === "not_found") throw missing(slug);
      throw refused(result, changes.project);
    },
    async deleteCurrentFocus(slug) {
      const result = await persistence.deleteCurrentFocus(slug);
      if (!result.ok) throw missing(slug);
    },
  };
}
