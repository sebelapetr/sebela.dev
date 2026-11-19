// Supporting-content persistence, private to the roadmap module.
import type { Database } from "../../database.js";
import type { RoadmapPersistence } from "./types.js";

type SupportingPersistence = Pick<
  RoadmapPersistence,
  | "listRoadmapProjectIdeas"
  | "findRoadmapProjectIdea"
  | "createRoadmapProjectIdea"
  | "updateRoadmapProjectIdea"
  | "deleteRoadmapProjectIdea"
  | "listRoadmapFollowedSources"
  | "findRoadmapFollowedSource"
  | "createRoadmapFollowedSource"
  | "updateRoadmapFollowedSource"
  | "deleteRoadmapFollowedSource"
  | "listRoadmapGlossaryTerms"
  | "findRoadmapGlossaryTerm"
  | "createRoadmapGlossaryTerm"
  | "updateRoadmapGlossaryTerm"
  | "deleteRoadmapGlossaryTerm"
>;

/** Every supporting-content operation over one connection or transaction. */
export function createSupportingPersistence(db: Database): SupportingPersistence {
  const pending = () => Promise.reject(new Error(`not implemented: ${typeof db}`));
  return {
    listRoadmapProjectIdeas: pending,
    findRoadmapProjectIdea: pending,
    createRoadmapProjectIdea: pending,
    updateRoadmapProjectIdea: pending,
    deleteRoadmapProjectIdea: pending,
    listRoadmapFollowedSources: pending,
    findRoadmapFollowedSource: pending,
    createRoadmapFollowedSource: pending,
    updateRoadmapFollowedSource: pending,
    deleteRoadmapFollowedSource: pending,
    listRoadmapGlossaryTerms: pending,
    findRoadmapGlossaryTerm: pending,
    createRoadmapGlossaryTerm: pending,
    updateRoadmapGlossaryTerm: pending,
    deleteRoadmapGlossaryTerm: pending,
  };
}
