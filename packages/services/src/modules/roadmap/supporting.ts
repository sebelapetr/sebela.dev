// The supporting content of the roadmap, private to the roadmap module: project ideas, followed
// sources and glossary terms, each an ordered list of its own beside the roadmap.
import type {
  RoadmapFollowedSource,
  RoadmapFollowedSourceCreate,
  RoadmapFollowedSourceList,
  RoadmapFollowedSourceUpdate,
  RoadmapGlossaryTerm,
  RoadmapGlossaryTermCreate,
  RoadmapGlossaryTermList,
  RoadmapGlossaryTermUpdate,
  RoadmapProjectIdea,
  RoadmapProjectIdeaCreate,
  RoadmapProjectIdeaList,
  RoadmapProjectIdeaUpdate,
} from "@sebela/contracts";
import type {
  RoadmapFollowedSourceFields,
  RoadmapFollowedSourceRecord,
  RoadmapGlossaryTermFields,
  RoadmapGlossaryTermRecord,
  RoadmapPersistence,
  RoadmapProjectIdeaFields,
  RoadmapProjectIdeaRecord,
  RoadmapProjectIdeaRelations,
  RoadmapProjectIdeaWriteFailure,
} from "@sebela/db";

import { DomainError } from "../../errors.js";

/**
 * The supporting content: project ideas with their shared topics, followed sources and glossary
 * terms. Lists are ordered by position, then slug. Expected refusals are `DomainError`s:
 * `not_found`, `conflict` for a taken slug and `validation_failed` naming `topics` for an unknown
 * or repeated topic of a project idea. Nothing references these records, so a delete is refused
 * only when the record is missing. Updates change only the given fields; `null` clears an optional
 * one and given `topics` replace all. A refused write changes nothing.
 */
export interface SupportingContent {
  listProjectIdeas(): Promise<RoadmapProjectIdeaList>;
  getProjectIdea(slug: string): Promise<RoadmapProjectIdea>;
  createProjectIdea(input: RoadmapProjectIdeaCreate): Promise<RoadmapProjectIdea>;
  updateProjectIdea(slug: string, changes: RoadmapProjectIdeaUpdate): Promise<RoadmapProjectIdea>;
  deleteProjectIdea(slug: string): Promise<void>;
  listFollowedSources(): Promise<RoadmapFollowedSourceList>;
  getFollowedSource(slug: string): Promise<RoadmapFollowedSource>;
  createFollowedSource(input: RoadmapFollowedSourceCreate): Promise<RoadmapFollowedSource>;
  updateFollowedSource(
    slug: string,
    changes: RoadmapFollowedSourceUpdate,
  ): Promise<RoadmapFollowedSource>;
  deleteFollowedSource(slug: string): Promise<void>;
  listGlossaryTerms(): Promise<RoadmapGlossaryTermList>;
  getGlossaryTerm(slug: string): Promise<RoadmapGlossaryTerm>;
  createGlossaryTerm(input: RoadmapGlossaryTermCreate): Promise<RoadmapGlossaryTerm>;
  updateGlossaryTerm(
    slug: string,
    changes: RoadmapGlossaryTermUpdate,
  ): Promise<RoadmapGlossaryTerm>;
  deleteGlossaryTerm(slug: string): Promise<void>;
}

const missing = (kind: string, slug: string) =>
  new DomainError("not_found", `There is no ${kind} "${slug}".`);
const taken = (kind: string, slug: string) =>
  new DomainError("conflict", `A ${kind} with the slug "${slug}" already exists.`);

/** Why a project idea's topics were refused, as a `validation_failed` naming `topics`. */
function topicRefusal(failure: RoadmapProjectIdeaWriteFailure): DomainError {
  const message =
    failure.reason === "unknown_topics"
      ? `There is no topic ${failure.slugs.join(", ")}; create it first.`
      : "List each topic once.";
  return new DomainError("validation_failed", message, [{ path: "topics", message }]);
}

/** Drops fields that are absent or `undefined`, so they stay unchanged. */
function definedChanges<Fields extends object>(changes: object): Partial<Fields> {
  return Object.fromEntries(
    Object.entries(changes).filter(([, value]) => value !== undefined),
  ) as Partial<Fields>;
}

const timestamps = (record: { createdAt: Date; updatedAt: Date }) => ({
  createdAt: record.createdAt.toISOString(),
  updatedAt: record.updatedAt.toISOString(),
});

function toProjectIdea(record: RoadmapProjectIdeaRecord): RoadmapProjectIdea {
  return {
    id: record.id,
    slug: record.slug,
    title: record.title,
    whyItMatters: record.whyItMatters,
    howToStart: record.howToStart,
    position: record.position,
    topics: record.topics.map((topic) => ({ ...topic, ...timestamps(topic) })),
    ...timestamps(record),
  };
}

function toFollowedSource(record: RoadmapFollowedSourceRecord): RoadmapFollowedSource {
  return {
    id: record.id,
    slug: record.slug,
    title: record.title,
    description: record.description,
    link: record.link,
    kind: record.kind,
    position: record.position,
    ...timestamps(record),
  };
}

function toGlossaryTerm(record: RoadmapGlossaryTermRecord): RoadmapGlossaryTerm {
  return {
    id: record.id,
    slug: record.slug,
    term: record.term,
    description: record.description,
    position: record.position,
    ...timestamps(record),
  };
}

/**
 * The supporting content over the roadmap persistence. The database decides slug uniqueness and
 * topic references while the record is locked, so a racing write is judged on the row that results.
 */
export function createSupportingContent(persistence: RoadmapPersistence): SupportingContent {
  return {
    async listProjectIdeas() {
      return (await persistence.listRoadmapProjectIdeas()).map(toProjectIdea);
    },
    async getProjectIdea(slug) {
      const record = await persistence.findRoadmapProjectIdea(slug);
      if (!record) throw missing("project idea", slug);
      return toProjectIdea(record);
    },
    async createProjectIdea(input) {
      const result = await persistence.createRoadmapProjectIdea(input);
      if (result.ok) return toProjectIdea(result.projectIdea);
      if (result.reason === "conflict") throw taken("project idea", input.slug);
      throw topicRefusal(result);
    },
    async updateProjectIdea(slug, changes) {
      const result = await persistence.updateRoadmapProjectIdea(
        slug,
        definedChanges<RoadmapProjectIdeaFields & RoadmapProjectIdeaRelations>(changes),
      );
      if (result.ok) return toProjectIdea(result.projectIdea);
      if (result.reason === "not_found") throw missing("project idea", slug);
      throw topicRefusal(result);
    },
    async deleteProjectIdea(slug) {
      const result = await persistence.deleteRoadmapProjectIdea(slug);
      if (!result.ok) throw missing("project idea", slug);
    },

    async listFollowedSources() {
      return (await persistence.listRoadmapFollowedSources()).map(toFollowedSource);
    },
    async getFollowedSource(slug) {
      const record = await persistence.findRoadmapFollowedSource(slug);
      if (!record) throw missing("followed source", slug);
      return toFollowedSource(record);
    },
    async createFollowedSource(input) {
      const result = await persistence.createRoadmapFollowedSource(input);
      if (!result.ok) throw taken("followed source", input.slug);
      return toFollowedSource(result.followedSource);
    },
    async updateFollowedSource(slug, changes) {
      const result = await persistence.updateRoadmapFollowedSource(
        slug,
        definedChanges<RoadmapFollowedSourceFields>(changes),
      );
      if (!result.ok) throw missing("followed source", slug);
      return toFollowedSource(result.followedSource);
    },
    async deleteFollowedSource(slug) {
      const result = await persistence.deleteRoadmapFollowedSource(slug);
      if (!result.ok) throw missing("followed source", slug);
    },

    async listGlossaryTerms() {
      return (await persistence.listRoadmapGlossaryTerms()).map(toGlossaryTerm);
    },
    async getGlossaryTerm(slug) {
      const record = await persistence.findRoadmapGlossaryTerm(slug);
      if (!record) throw missing("glossary term", slug);
      return toGlossaryTerm(record);
    },
    async createGlossaryTerm(input) {
      const result = await persistence.createRoadmapGlossaryTerm(input);
      if (!result.ok) throw taken("glossary term", input.slug);
      return toGlossaryTerm(result.glossaryTerm);
    },
    async updateGlossaryTerm(slug, changes) {
      const result = await persistence.updateRoadmapGlossaryTerm(
        slug,
        definedChanges<RoadmapGlossaryTermFields>(changes),
      );
      if (!result.ok) throw missing("glossary term", slug);
      return toGlossaryTerm(result.glossaryTerm);
    },
    async deleteGlossaryTerm(slug) {
      const result = await persistence.deleteRoadmapGlossaryTerm(slug);
      if (!result.ok) throw missing("glossary term", slug);
    },
  };
}
