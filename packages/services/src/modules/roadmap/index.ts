import type {
  Roadmap,
  RoadmapArea,
  RoadmapAreaCreate,
  RoadmapAreaUpdate,
  RoadmapModule,
  RoadmapModuleCreate,
  RoadmapModuleUpdate,
  RoadmapResource,
  RoadmapResourceCreate,
  RoadmapResourceUpdate,
} from "@sebela/contracts";
import type { RoadmapPersistence } from "@sebela/db";

/**
 * The AI roadmap: its areas, their modules and the resources in them. Reads return contract
 * records; the whole tree carries progress derived on every read and is never stored. Expected
 * refusals are `DomainError`s: `not_found` for a missing slug, `conflict` for a taken slug or a
 * record that still has children or links, and `validation_failed` naming the offending field for
 * a reserved area slug, an unknown parent or topic, a repeated topic or a finish before the start.
 */
export interface RoadmapService {
  /** The whole roadmap in one consistent read, with derived progress and totals. */
  getRoadmap(): Promise<Roadmap>;
  getArea(slug: string): Promise<RoadmapArea>;
  createArea(input: RoadmapAreaCreate): Promise<RoadmapArea>;
  updateArea(slug: string, changes: RoadmapAreaUpdate): Promise<RoadmapArea>;
  /** Refused with `conflict` while the area has modules. */
  deleteArea(slug: string): Promise<void>;
  getModule(slug: string): Promise<RoadmapModule>;
  createModule(input: RoadmapModuleCreate): Promise<RoadmapModule>;
  /** A given `area` moves the module. */
  updateModule(slug: string, changes: RoadmapModuleUpdate): Promise<RoadmapModule>;
  /** Refused with `conflict` while the module has resources. */
  deleteModule(slug: string): Promise<void>;
  getResource(slug: string): Promise<RoadmapResource>;
  createResource(input: RoadmapResourceCreate): Promise<RoadmapResource>;
  /** A given `module` moves the resource; given `topics` replace its links. */
  updateResource(slug: string, changes: RoadmapResourceUpdate): Promise<RoadmapResource>;
  /** Removes the resource with its topic links. */
  deleteResource(slug: string): Promise<void>;
}

export function createRoadmapService(persistence: RoadmapPersistence): RoadmapService {
  throw new Error(`Not implemented over ${typeof persistence}.`);
}
