import type { Exploration } from "@sebela/contracts";
import type {
  ExplorationFields,
  ExplorationRecord,
  ExplorationRelations,
  ExplorationWriteFailure,
  ProfilePersistence,
} from "@sebela/db";

import { DomainError } from "../../errors.js";
import { toTechnology, toTopic } from "./catalogs.js";
import { definedChanges } from "./changes.js";
import type { ExplorationService } from "./types.js";

const missing = (slug: string) =>
  new DomainError("not_found", `There is no exploration "${slug}".`);

function toExploration(record: ExplorationRecord): Exploration {
  return {
    ...record,
    technologies: record.technologies.map(toTechnology),
    topics: record.topics.map(toTopic),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

/** A refused write of the given relations as a `validation_failed` naming the offending field. */
function refused(failure: ExplorationWriteFailure): DomainError {
  const invalid = (path: string, message: string) =>
    new DomainError("validation_failed", message, [{ path, message }]);
  switch (failure.reason) {
    case "unknown_technologies":
      return invalid(
        "technologies",
        `There is no technology ${failure.slugs.join(", ")}; create it first.`,
      );
    case "repeated_technologies":
      return invalid("technologies", "List each technology once.");
    case "unknown_topics":
      return invalid("topics", `There is no topic ${failure.slugs.join(", ")}; create it first.`);
    case "repeated_topics":
      return invalid("topics", "List each topic once.");
    case "invalid_period":
      return invalid("endedOn", "The end cannot be before the start.");
  }
}

/**
 * The explorations with their technologies and topics resolved and their status exactly as
 * stored. Persistence writes an exploration and its links in one transaction and judges relation
 * targets, the period and slug uniqueness on stored rows, so a refused write leaves nothing behind.
 */
export function createExplorationService(persistence: ProfilePersistence): ExplorationService {
  return {
    async listExplorations() {
      return (await persistence.listExplorations()).map(toExploration);
    },
    async getExploration(slug) {
      const record = await persistence.findExploration(slug);
      if (!record) throw missing(slug);
      return toExploration(record);
    },
    async createExploration(input) {
      const result = await persistence.createExploration(input);
      if (result.ok) return toExploration(result.exploration);
      if (result.reason === "conflict") {
        throw new DomainError("conflict", `An exploration "${input.slug}" already exists.`);
      }
      throw refused(result);
    },
    async updateExploration(slug, changes) {
      const result = await persistence.updateExploration(
        slug,
        definedChanges<ExplorationFields & ExplorationRelations>(changes),
      );
      if (result.ok) return toExploration(result.exploration);
      if (result.reason === "not_found") throw missing(slug);
      throw refused(result);
    },
    async deleteExploration(slug) {
      const result = await persistence.deleteExploration(slug);
      if (result.ok) return;
      if (result.reason === "not_found") throw missing(slug);
      throw new DomainError(
        "conflict",
        `The exploration "${slug}" is still named as evidence by a service; remove it from that service first.`,
      );
    },
  };
}
