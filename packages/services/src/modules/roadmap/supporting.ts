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
import type { RoadmapPersistence } from "@sebela/db";

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

/** The supporting content over the roadmap persistence. */
export function createSupportingContent(persistence: RoadmapPersistence): SupportingContent {
  const unimplemented = () =>
    Promise.reject(new Error(`Supporting content over ${typeof persistence} is not implemented.`));
  return {
    listProjectIdeas: unimplemented,
    getProjectIdea: unimplemented,
    createProjectIdea: unimplemented,
    updateProjectIdea: unimplemented,
    deleteProjectIdea: unimplemented,
    listFollowedSources: unimplemented,
    getFollowedSource: unimplemented,
    createFollowedSource: unimplemented,
    updateFollowedSource: unimplemented,
    deleteFollowedSource: unimplemented,
    listGlossaryTerms: unimplemented,
    getGlossaryTerm: unimplemented,
    createGlossaryTerm: unimplemented,
    updateGlossaryTerm: unimplemented,
    deleteGlossaryTerm: unimplemented,
  };
}
