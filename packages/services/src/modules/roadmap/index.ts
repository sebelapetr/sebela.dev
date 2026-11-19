import type {
  Roadmap,
  RoadmapArea,
  RoadmapAreaCreate,
  RoadmapAreaDetail,
  RoadmapAreaUpdate,
  RoadmapCurrent,
  RoadmapCurrentArea,
  RoadmapCurrentModule,
  RoadmapModule,
  RoadmapModuleCreate,
  RoadmapModuleDetail,
  RoadmapModuleUpdate,
  RoadmapProgress,
  RoadmapResource,
  RoadmapResourceCreate,
  RoadmapResourceUpdate,
  RoadmapTreeArea,
  RoadmapTreeModule,
  RoadmapTreeResource,
  Topic,
} from "@sebela/contracts";
import type {
  RoadmapAreaFields,
  RoadmapAreaNode,
  RoadmapAreaRecord,
  RoadmapModuleFields,
  RoadmapModuleNode,
  RoadmapModuleRecord,
  RoadmapModuleRelations,
  RoadmapPersistence,
  RoadmapResourceFields,
  RoadmapResourceRecord,
  RoadmapResourceRelations,
  RoadmapResourceWriteFailure,
  TopicRecord,
} from "@sebela/db";

import { DomainError } from "../../errors.js";
import type { MediaAddress } from "../profile/index.js";
import { createBookshelf, type Bookshelf } from "./books.js";
import { createLearningDiary, type LearningDiary } from "./diary.js";
import { createEventCalendar, type EventCalendar } from "./events.js";
import { areaProgress, moduleProgress, roadmapSummary } from "./progress.js";
import { createLearningStatistics, type LearningStatistics } from "./statistics.js";

/**
 * The AI roadmap: its areas, their modules and the resources in them, and the learning diary of
 * time spent on those resources (see `LearningDiary`), and the bookshelf of books that resources of
 * type `book` read (see `Bookshelf`), and the attended events, which are not resources and show
 * on their diary days without adding time (see `EventCalendar`), and the learning statistics
 * over the logged time (see `LearningStatistics`). Reads return contract
 * records; the whole tree carries progress derived on every read and is never stored. Expected
 * refusals are `DomainError`s: `not_found` for a missing slug, `conflict` for a taken slug or a
 * record that still has children or links, and `validation_failed` naming the offending field for
 * a reserved area slug, an unknown parent or topic, a repeated topic, a finish before the start or
 * an unusable book link (an unknown book, one another resource links, or a type other than `book`).
 */
export interface RoadmapService
  extends LearningDiary, Bookshelf, EventCalendar, LearningStatistics {
  /** The whole roadmap in one consistent read, with derived progress and totals. */
  getRoadmap(): Promise<Roadmap>;
  /** One area node of the whole roadmap, unchanged; a missing area is `not_found`. */
  getAreaDetail(area: string): Promise<RoadmapAreaDetail>;
  /**
   * One module node of the whole roadmap, unchanged, with its area; a missing area or module,
   * or a module of another area, is `not_found`.
   */
  getModuleDetail(area: string, module: string): Promise<RoadmapModuleDetail>;
  /** The areas and modules whose derived status is `in-progress`, in roadmap order; may be empty. */
  getCurrentLearning(): Promise<RoadmapCurrent>;
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
  /** Removes the resource with its topic links; refused with `conflict` while it has time entries. */
  deleteResource(slug: string): Promise<void>;
}

export type { Bookshelf } from "./books.js";
export type { LearningDiary, TimeEntryDeletion } from "./diary.js";
export type { EventCalendar } from "./events.js";
export type { LearningStatistics } from "./statistics.js";

export interface RoadmapServiceOptions {
  /**
   * The public address of a media key, used for book covers. Without it no key can be addressed
   * and a cover's `url` is `null`, as for a key the storage cannot address.
   */
  readonly mediaAddress?: MediaAddress;
}

const iso = (instant: Date | null) => (instant === null ? null : instant.toISOString());
const instant = (value: string | null) => (value === null ? null : new Date(value));

const missing = (kind: string, slug: string) =>
  new DomainError("not_found", `There is no roadmap ${kind} "${slug}".`);
const taken = (kind: string, slug: string) =>
  new DomainError("conflict", `A roadmap ${kind} with the slug "${slug}" already exists.`);
const invalid = (path: string, message: string) =>
  new DomainError("validation_failed", message, [{ path, message }]);

function stillReferenced(kind: string, slug: string, children: string): DomainError {
  return new DomainError(
    "conflict",
    `The roadmap ${kind} "${slug}" still has ${children}; move or delete them first.`,
  );
}

/** Why a resource write was refused; `module` is the parent slug the write named, if any. */
function resourceRefusal(failure: RoadmapResourceWriteFailure, module?: string): DomainError {
  switch (failure.reason) {
    case "unknown_module":
      return invalid("module", `There is no roadmap module "${module ?? ""}"; create it first.`);
    case "unknown_topics":
      return invalid("topics", `There is no topic ${failure.slugs.join(", ")}; create it first.`);
    case "repeated_topics":
      return invalid("topics", "List each topic once.");
    case "invalid_period":
      return invalid("finishedAt", "The finish cannot be before the start.");
    case "unknown_book":
      return invalid("book", "There is no such book on the bookshelf; create it first.");
    case "book_taken":
      return invalid("book", "Another resource already reads this book; a book has one resource.");
    case "book_requires_book_type":
      return invalid("book", "Only a resource of type book can link a book.");
  }
}

const unknownArea = (area?: string) =>
  invalid("area", `There is no roadmap area "${area ?? ""}"; create it first.`);

/** Drops fields that are absent or `undefined`, so they stay unchanged. */
function definedChanges<Fields extends object>(changes: object): Partial<Fields> {
  return Object.fromEntries(
    Object.entries(changes).filter(([, value]) => value !== undefined),
  ) as Partial<Fields>;
}

/** Converts the given date fields of a resource write from ISO strings to instants. */
function withInstants<
  Write extends { startedAt?: string | null | undefined; finishedAt?: string | null | undefined },
>(
  write: Write,
): Omit<Write, "startedAt" | "finishedAt"> & {
  startedAt?: Date | null;
  finishedAt?: Date | null;
} {
  const { startedAt, finishedAt, ...rest } = write;
  return {
    ...rest,
    ...(startedAt === undefined ? {} : { startedAt: instant(startedAt) }),
    ...(finishedAt === undefined ? {} : { finishedAt: instant(finishedAt) }),
  };
}

function toTopic(record: TopicRecord): Topic {
  return {
    ...record,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function toArea(record: RoadmapAreaRecord): RoadmapArea {
  return {
    id: record.id,
    slug: record.slug,
    name: record.name,
    description: record.description,
    weight: record.weight,
    position: record.position,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

/** A module without its area, as it appears inside its area in the tree. */
function toTreeModule(record: RoadmapModuleRecord): Omit<RoadmapModule, "area"> {
  return {
    id: record.id,
    slug: record.slug,
    name: record.name,
    description: record.description,
    position: record.position,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function toModule(record: RoadmapModuleRecord): RoadmapModule {
  return { ...toTreeModule(record), area: record.area };
}

/** A resource without its module, as it appears inside its module in the tree. */
function toTreeResource(record: RoadmapResourceRecord): RoadmapTreeResource {
  return {
    id: record.id,
    slug: record.slug,
    name: record.name,
    description: record.description,
    type: record.type,
    status: record.status,
    estimatedMinutes: record.estimatedMinutes,
    startedAt: iso(record.startedAt),
    finishedAt: iso(record.finishedAt),
    link: record.link,
    position: record.position,
    book: record.book,
    topics: record.topics.map(toTopic),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function toResource(record: RoadmapResourceRecord): RoadmapResource {
  return { ...toTreeResource(record), module: record.module };
}

/** A module node of the tree with its derived progress and its resources. */
function toTreeModuleNode(module: RoadmapModuleNode): RoadmapTreeModule {
  return {
    ...toTreeModule(module),
    progress: moduleProgress(module.resources),
    resources: module.resources.map(toTreeResource),
  };
}

/** An area node of the tree with its derived progress and its modules. */
function toTreeArea(area: RoadmapAreaNode): RoadmapTreeArea {
  return {
    ...toArea(area),
    progress: areaProgress(area.modules.map((module) => module.resources)),
    modules: area.modules.map(toTreeModuleNode),
  };
}

/** The contract tree with progress derived from the stored resources. */
function toRoadmap(tree: readonly RoadmapAreaNode[]): Roadmap {
  return {
    summary: roadmapSummary(tree.map((area) => area.modules.map((module) => module.resources))),
    areas: tree.map(toTreeArea),
  };
}

function isInProgress(
  progress: RoadmapProgress,
): progress is RoadmapProgress & { status: "in-progress" } {
  return progress.status === "in-progress";
}

/** The in-progress areas and modules of the tree, in its order, without resources. */
function toCurrentLearning(tree: readonly RoadmapAreaNode[]): RoadmapCurrent {
  const areas: RoadmapCurrentArea[] = [];
  for (const area of tree) {
    const progress = areaProgress(area.modules.map((module) => module.resources));
    if (!isInProgress(progress)) continue;
    const modules: RoadmapCurrentModule[] = [];
    for (const module of area.modules) {
      const current = moduleProgress(module.resources);
      if (isInProgress(current)) modules.push({ ...toTreeModule(module), progress: current });
    }
    areas.push({ ...toArea(area), progress, modules });
  }
  return { areas };
}

/**
 * The roadmap over its persistence. The database decides slug uniqueness, reserved area slugs,
 * parents, topics and the ordered period, so a racing write is judged on the row that results.
 */
export function createRoadmapService(
  persistence: RoadmapPersistence,
  options: RoadmapServiceOptions = {},
): RoadmapService {
  return {
    async getRoadmap() {
      return toRoadmap(await persistence.loadRoadmapTree());
    },
    async getAreaDetail(slug) {
      const area = (await persistence.loadRoadmapTree()).find((node) => node.slug === slug);
      if (!area) throw missing("area", slug);
      return { area: toTreeArea(area) };
    },
    async getModuleDetail(areaSlug, moduleSlug) {
      const area = (await persistence.loadRoadmapTree()).find((node) => node.slug === areaSlug);
      if (!area) throw missing("area", areaSlug);
      const module = area.modules.find((node) => node.slug === moduleSlug);
      if (!module) {
        throw new DomainError(
          "not_found",
          `There is no roadmap module "${moduleSlug}" in the area "${areaSlug}".`,
        );
      }
      return { area: toArea(area), module: toTreeModuleNode(module) };
    },
    async getCurrentLearning() {
      return toCurrentLearning(await persistence.loadRoadmapTree());
    },

    async getArea(slug) {
      const record = await persistence.findRoadmapArea(slug);
      if (!record) throw missing("area", slug);
      return toArea(record);
    },
    async createArea(input) {
      const result = await persistence.createRoadmapArea(input);
      if (result.ok) return toArea(result.area);
      if (result.reason === "reserved_slug") {
        throw invalid("slug", "This slug is reserved for a roadmap page.");
      }
      throw taken("area", input.slug);
    },
    async updateArea(slug, changes) {
      const result = await persistence.updateRoadmapArea(
        slug,
        definedChanges<RoadmapAreaFields>(changes),
      );
      if (!result.ok) throw missing("area", slug);
      return toArea(result.area);
    },
    async deleteArea(slug) {
      const result = await persistence.deleteRoadmapArea(slug);
      if (result.ok) return;
      if (result.reason === "not_found") throw missing("area", slug);
      throw stillReferenced("area", slug, "modules");
    },

    async getModule(slug) {
      const record = await persistence.findRoadmapModule(slug);
      if (!record) throw missing("module", slug);
      return toModule(record);
    },
    async createModule(input) {
      const result = await persistence.createRoadmapModule(input);
      if (result.ok) return toModule(result.module);
      if (result.reason === "unknown_area") throw unknownArea(input.area);
      throw taken("module", input.slug);
    },
    async updateModule(slug, changes) {
      const result = await persistence.updateRoadmapModule(
        slug,
        definedChanges<RoadmapModuleFields & RoadmapModuleRelations>(changes),
      );
      if (result.ok) return toModule(result.module);
      if (result.reason === "unknown_area") throw unknownArea(changes.area);
      throw missing("module", slug);
    },
    async deleteModule(slug) {
      const result = await persistence.deleteRoadmapModule(slug);
      if (result.ok) return;
      if (result.reason === "not_found") throw missing("module", slug);
      throw stillReferenced("module", slug, "resources");
    },

    async getResource(slug) {
      const record = await persistence.findRoadmapResource(slug);
      if (!record) throw missing("resource", slug);
      return toResource(record);
    },
    async createResource(input) {
      const result = await persistence.createRoadmapResource({
        ...input,
        startedAt: instant(input.startedAt),
        finishedAt: instant(input.finishedAt),
      });
      if (result.ok) return toResource(result.resource);
      if (result.reason === "conflict") throw taken("resource", input.slug);
      throw resourceRefusal(result, input.module);
    },
    async updateResource(slug, changes) {
      const result = await persistence.updateRoadmapResource(
        slug,
        definedChanges<RoadmapResourceFields & RoadmapResourceRelations>(withInstants(changes)),
      );
      if (result.ok) return toResource(result.resource);
      if (result.reason === "not_found") throw missing("resource", slug);
      throw resourceRefusal(result, changes.module);
    },
    async deleteResource(slug) {
      const result = await persistence.deleteRoadmapResource(slug);
      if (result.ok) return;
      if (result.reason === "not_found") throw missing("resource", slug);
      throw stillReferenced("resource", slug, "records linking to it");
    },

    ...createLearningDiary(persistence),
    ...createBookshelf(persistence, options.mediaAddress ?? (() => null)),
    ...createEventCalendar(persistence),
    ...createLearningStatistics(persistence),
  };
}
