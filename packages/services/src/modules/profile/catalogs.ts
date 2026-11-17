import type { Technology, Topic } from "@sebela/contracts";
import type {
  ProfilePersistence,
  TechnologyFields,
  TechnologyRecord,
  TopicFields,
  TopicRecord,
} from "@sebela/db";

import { DomainError } from "../../errors.js";
import { definedChanges } from "./changes.js";
import type { CatalogService } from "./types.js";

const missing = (kind: string, slug: string) =>
  new DomainError("not_found", `There is no ${kind} "${slug}".`);

const taken = (kind: string, slug: string) =>
  new DomainError("conflict", `A ${kind} "${slug}" already exists.`);

const inconsistent = () =>
  new DomainError(
    "validation_failed",
    "A primary technology needs a group and a secondary technology has none; send the group " +
      "that matches the tier.",
    [
      {
        path: "group",
        message: "Must be set for a primary technology and null for a secondary one.",
      },
    ],
  );

/** The technology in the contract shape; also used where another record resolves it. */
export function toTechnology(record: TechnologyRecord): Technology {
  return {
    ...record,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

/** The topic in the contract shape; also used where another record resolves it. */
export function toTopic(record: TopicRecord): Topic {
  return {
    ...record,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

/**
 * The ordered catalogs. The database decides slug uniqueness and the tier/group rule, so a racing
 * create or an update that combines with stored values is judged on the row that results.
 */
export function createCatalogService(persistence: ProfilePersistence): CatalogService {
  return {
    async listTechnologies() {
      return (await persistence.listTechnologies()).map(toTechnology);
    },
    async getTechnology(slug) {
      const record = await persistence.findTechnology(slug);
      if (!record) throw missing("technology", slug);
      return toTechnology(record);
    },
    async createTechnology(input) {
      const result = await persistence.createTechnology(input);
      if (result.ok) return toTechnology(result.technology);
      throw result.reason === "conflict" ? taken("technology", input.slug) : inconsistent();
    },
    async updateTechnology(slug, changes) {
      const result = await persistence.updateTechnology(
        slug,
        definedChanges<TechnologyFields>(changes),
      );
      if (result.ok) return toTechnology(result.technology);
      throw result.reason === "not_found" ? missing("technology", slug) : inconsistent();
    },
    async deleteTechnology(slug) {
      const result = await persistence.deleteTechnology(slug);
      if (result.ok) return;
      if (result.reason === "not_found") throw missing("technology", slug);
      throw new DomainError(
        "conflict",
        `The technology "${slug}" is still linked from other records; remove those links first.`,
      );
    },
    async listTopics() {
      return (await persistence.listTopics()).map(toTopic);
    },
    async getTopic(slug) {
      const record = await persistence.findTopic(slug);
      if (!record) throw missing("topic", slug);
      return toTopic(record);
    },
    async createTopic(input) {
      const result = await persistence.createTopic(input);
      if (!result.ok) throw taken("topic", input.slug);
      return toTopic(result.topic);
    },
    async updateTopic(slug, changes) {
      const record = await persistence.updateTopic(slug, definedChanges<TopicFields>(changes));
      if (!record) throw missing("topic", slug);
      return toTopic(record);
    },
    async deleteTopic(slug) {
      const result = await persistence.deleteTopic(slug);
      if (result.ok) return;
      if (result.reason === "not_found") throw missing("topic", slug);
      throw new DomainError(
        "conflict",
        `The topic "${slug}" is still linked from other records; remove those links first.`,
      );
    },
  };
}
