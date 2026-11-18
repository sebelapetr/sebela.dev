// Interface stub for the failing roadmap persistence tests; the implementation replaces it.
import type { Database } from "../../database.js";
import type { RoadmapPersistence } from "./types.js";

export type {
  CreateRoadmapAreaResult,
  CreateRoadmapModuleResult,
  CreateRoadmapResourceResult,
  DeleteRoadmapRecordResult,
  RoadmapAreaFields,
  RoadmapAreaNode,
  RoadmapAreaRecord,
  RoadmapModuleFields,
  RoadmapModuleNode,
  RoadmapModuleRecord,
  RoadmapModuleRelations,
  RoadmapModuleWriteFailure,
  RoadmapPersistence,
  RoadmapResourceFields,
  RoadmapResourceRecord,
  RoadmapResourceRelations,
  RoadmapResourceStatus,
  RoadmapResourceType,
  RoadmapResourceWriteFailure,
  UpdateRoadmapAreaResult,
  UpdateRoadmapModuleResult,
  UpdateRoadmapResourceResult,
} from "./types.js";

export function createRoadmapPersistence(db: Database): RoadmapPersistence {
  const missing = () => Promise.reject(new Error(`Not implemented over ${typeof db}.`));
  return {
    loadRoadmapTree: missing,
    findRoadmapArea: missing,
    createRoadmapArea: missing,
    updateRoadmapArea: missing,
    deleteRoadmapArea: missing,
    findRoadmapModule: missing,
    createRoadmapModule: missing,
    updateRoadmapModule: missing,
    deleteRoadmapModule: missing,
    findRoadmapResource: missing,
    createRoadmapResource: missing,
    updateRoadmapResource: missing,
    deleteRoadmapResource: missing,
  };
}
