import type { TopicRecord } from "../profile/index.js";

/** Kinds of learning resource. */
export type RoadmapResourceType =
  | "youtube-video"
  | "youtube-playlist"
  | "google-drive"
  | "video"
  | "link"
  | "text"
  | "project"
  | "book";

/** Where a resource stands. */
export type RoadmapResourceStatus = "planned" | "in-progress" | "completed" | "paused" | "skipped";

export interface RoadmapAreaFields {
  name: string;
  description: string | null;
  /** The recommended share of learning effort, 1 to 100. */
  weight: number;
  position: number;
}

export interface RoadmapAreaRecord extends RoadmapAreaFields {
  id: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface RoadmapModuleFields {
  name: string;
  description: string | null;
  position: number;
}

/** A module's parent as written: the slug of an existing area. */
export interface RoadmapModuleRelations {
  area: string;
}

export interface RoadmapModuleRecord extends RoadmapModuleFields {
  id: string;
  slug: string;
  /** The slug of its area. */
  area: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface RoadmapResourceFields {
  name: string;
  description: string | null;
  type: RoadmapResourceType;
  status: RoadmapResourceStatus;
  estimatedMinutes: number | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  link: string | null;
  position: number;
}

/** A resource's relations as written: the slugs of an existing module and topics, in order. */
export interface RoadmapResourceRelations {
  module: string;
  topics: string[];
}

export interface RoadmapResourceRecord extends RoadmapResourceFields {
  id: string;
  slug: string;
  /** The slug of its module. */
  module: string;
  /** Its topics in link order. */
  topics: TopicRecord[];
  createdAt: Date;
  updatedAt: Date;
}

/** A module with its ordered resources. */
export interface RoadmapModuleNode extends RoadmapModuleRecord {
  resources: RoadmapResourceRecord[];
}

/** An area with its ordered modules. */
export interface RoadmapAreaNode extends RoadmapAreaRecord {
  modules: RoadmapModuleNode[];
}

export type CreateRoadmapAreaResult =
  { ok: true; area: RoadmapAreaRecord } | { ok: false; reason: "conflict" | "reserved_slug" };

export type UpdateRoadmapAreaResult =
  { ok: true; area: RoadmapAreaRecord } | { ok: false; reason: "not_found" };

/** Why a module write was refused. */
export interface RoadmapModuleWriteFailure {
  ok: false;
  reason: "unknown_area";
}

export type CreateRoadmapModuleResult =
  | { ok: true; module: RoadmapModuleRecord }
  | { ok: false; reason: "conflict" }
  | RoadmapModuleWriteFailure;

export type UpdateRoadmapModuleResult =
  | { ok: true; module: RoadmapModuleRecord }
  | { ok: false; reason: "not_found" }
  | RoadmapModuleWriteFailure;

/** Why a resource write was refused. */
export type RoadmapResourceWriteFailure =
  | { ok: false; reason: "unknown_module" }
  | { ok: false; reason: "unknown_topics"; slugs: string[] }
  | { ok: false; reason: "repeated_topics" }
  | { ok: false; reason: "invalid_period" };

export type CreateRoadmapResourceResult =
  | { ok: true; resource: RoadmapResourceRecord }
  | { ok: false; reason: "conflict" }
  | RoadmapResourceWriteFailure;

export type UpdateRoadmapResourceResult =
  | { ok: true; resource: RoadmapResourceRecord }
  | { ok: false; reason: "not_found" }
  | RoadmapResourceWriteFailure;

/** `referenced` while a child or another record still points to it. */
export type DeleteRoadmapRecordResult =
  { ok: true } | { ok: false; reason: "not_found" | "referenced" };

/**
 * Persistence of the AI roadmap: areas, their modules and the resources in them, with ordered
 * topic links to the profile's shared topics. Parents are real foreign keys without a cascade, so a
 * parent with children cannot be deleted; topic links cascade only with their resource. Every
 * level is ordered by position, then slug, and slugs are unique per kind of record.
 */
export interface RoadmapPersistence {
  /** Every area with its modules and their resources, read in one consistent snapshot. */
  loadRoadmapTree(): Promise<RoadmapAreaNode[]>;
  /** The area with the slug, or `null`. */
  findRoadmapArea(slug: string): Promise<RoadmapAreaRecord | null>;
  /** `conflict` when the slug is taken; `reserved_slug` when the database refuses the slug. */
  createRoadmapArea(fields: RoadmapAreaFields & { slug: string }): Promise<CreateRoadmapAreaResult>;
  /** Changes only the given fields. */
  updateRoadmapArea(
    slug: string,
    changes: Partial<RoadmapAreaFields>,
  ): Promise<UpdateRoadmapAreaResult>;
  /** `referenced` while the area has modules. */
  deleteRoadmapArea(slug: string): Promise<DeleteRoadmapRecordResult>;
  /** The module with the slug, or `null`. */
  findRoadmapModule(slug: string): Promise<RoadmapModuleRecord | null>;
  /** Creates a module in an existing area. */
  createRoadmapModule(
    fields: RoadmapModuleFields & RoadmapModuleRelations & { slug: string },
  ): Promise<CreateRoadmapModuleResult>;
  /** Changes only the given fields; a given `area` moves the module. */
  updateRoadmapModule(
    slug: string,
    changes: Partial<RoadmapModuleFields & RoadmapModuleRelations>,
  ): Promise<UpdateRoadmapModuleResult>;
  /** `referenced` while the module has resources. */
  deleteRoadmapModule(slug: string): Promise<DeleteRoadmapRecordResult>;
  /** The resource with the slug, or `null`. */
  findRoadmapResource(slug: string): Promise<RoadmapResourceRecord | null>;
  /** Creates a resource in an existing module with its topic links, all or nothing. */
  createRoadmapResource(
    fields: RoadmapResourceFields & RoadmapResourceRelations & { slug: string },
  ): Promise<CreateRoadmapResourceResult>;
  /**
   * Changes only the given fields; a given `module` moves the resource and given `topics` replace
   * its links. Its update time changes with every write.
   */
  updateRoadmapResource(
    slug: string,
    changes: Partial<RoadmapResourceFields & RoadmapResourceRelations>,
  ): Promise<UpdateRoadmapResourceResult>;
  /** Deletes the resource and its topic links. */
  deleteRoadmapResource(slug: string): Promise<DeleteRoadmapRecordResult>;
}
