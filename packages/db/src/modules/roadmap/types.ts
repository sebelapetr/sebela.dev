import type { MediaRecord, MediaReferenceFailure, TopicRecord } from "../profile/index.js";

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

/**
 * A resource's relations as written: the slugs of an existing module and topics, in order, and of
 * the existing book it reads or `null`.
 */
export interface RoadmapResourceRelations {
  module: string;
  topics: string[];
  book: string | null;
}

export interface RoadmapResourceRecord extends RoadmapResourceFields {
  id: string;
  slug: string;
  /** The slug of its module. */
  module: string;
  /** Its topics in link order. */
  topics: TopicRecord[];
  /** The slug of the book it reads, or `null`. */
  book: string | null;
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
  | { ok: false; reason: "invalid_period" }
  | { ok: false; reason: "unknown_book" }
  | { ok: false; reason: "book_requires_book_type" }
  | { ok: false; reason: "book_taken" };

export type CreateRoadmapResourceResult =
  | { ok: true; resource: RoadmapResourceRecord }
  | { ok: false; reason: "conflict" }
  | RoadmapResourceWriteFailure;

export type UpdateRoadmapResourceResult =
  | { ok: true; resource: RoadmapResourceRecord }
  | { ok: false; reason: "not_found" }
  | RoadmapResourceWriteFailure;

export interface RoadmapBookFields {
  title: string;
  author: string | null;
  description: string | null;
  pages: number | null;
  year: number | null;
  isbn: string | null;
  /** Shelf order: ascending, ties by slug. */
  priority: number;
  /** `YYYY-MM-DD`, or `null`. */
  startedOn: string | null;
  /** `YYYY-MM-DD`, not before `startedOn`, or `null`. */
  endedOn: string | null;
  summary: string | null;
  /** The cover image's media id, or `null`. */
  coverId: string | null;
}

/** The resource of type `book` that links a book, with the slugs of its module and area. */
export interface RoadmapBookResourceRecord {
  slug: string;
  name: string;
  module: string;
  area: string;
}

export interface RoadmapBookRecord extends RoadmapBookFields {
  id: string;
  slug: string;
  /** The media record of the cover, or `null`. */
  cover: MediaRecord | null;
  /** The resource that links the book, or `null`. */
  resource: RoadmapBookResourceRecord | null;
  /** The elapsed seconds of the linking resource's time entries; `0` without one. */
  readingSeconds: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Why a book write was refused: an unusable cover or an end before the start. */
export type RoadmapBookWriteFailure =
  MediaReferenceFailure | { ok: false; reason: "invalid_period" };

export type CreateRoadmapBookResult =
  | { ok: true; book: RoadmapBookRecord }
  | { ok: false; reason: "conflict" }
  | RoadmapBookWriteFailure;

export type UpdateRoadmapBookResult =
  | { ok: true; book: RoadmapBookRecord }
  | { ok: false; reason: "not_found" }
  | RoadmapBookWriteFailure;

/** `referenced` while a child or another record still points to it. */
export type DeleteRoadmapRecordResult =
  { ok: true } | { ok: false; reason: "not_found" | "referenced" };

/** One piece of a study session within one diary day, as the caller split it. */
export interface TimeEntryPiece {
  /** The diary day, `YYYY-MM-DD` in Europe/Prague, in which the piece starts. */
  date: string;
  startedAt: Date;
  endedAt: Date;
}

/** The resource a time entry belongs to, with the slugs of its module and area. */
export interface DiaryResourceRecord {
  slug: string;
  name: string;
  type: RoadmapResourceType;
  link: string | null;
  module: string;
  area: string;
}

export interface TimeEntryRecord {
  id: string;
  /** Its diary day, `YYYY-MM-DD`. */
  date: string;
  resource: DiaryResourceRecord;
  startedAt: Date;
  endedAt: Date;
}

/** A diary day with its notes and its time entries in start order. */
export interface DiaryDayRecord {
  date: string;
  notes: string | null;
  entries: TimeEntryRecord[];
}

/**
 * Why a time-entry write was refused: the resource does not exist, or a piece overlaps a stored
 * interval of any learning target.
 */
export type TimeEntryWriteFailure =
  { ok: false; reason: "unknown_resource" } | { ok: false; reason: "overlap" };

export type CreateTimeEntriesResult =
  { ok: true; entries: TimeEntryRecord[] } | TimeEntryWriteFailure;

/** What replaces a time entry: the resource slug and the new pieces, the first keeping the id. */
export interface TimeEntryReplacement {
  resource: string;
  pieces: TimeEntryPiece[];
}

export type ReplaceTimeEntryResult<Refusal> =
  | { ok: true; entries: TimeEntryRecord[]; previousDate: string }
  | { ok: false; reason: "not_found" }
  | TimeEntryWriteFailure
  | Refusal;

export type DeleteTimeEntryResult = { ok: true; date: string } | { ok: false; reason: "not_found" };

export type ClearDiaryNotesResult = { ok: true } | { ok: false; reason: "not_found" };

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
  /**
   * Deletes the resource and its topic links; `referenced` while a time entry belongs to it.
   */
  deleteRoadmapResource(slug: string): Promise<DeleteRoadmapRecordResult>;

  /**
   * Every book by priority, then slug, each with its cover, linking resource and reading time,
   * read in one consistent snapshot.
   */
  listRoadmapBooks(): Promise<RoadmapBookRecord[]>;
  /** The book with the slug, or `null`. */
  findRoadmapBook(slug: string): Promise<RoadmapBookRecord | null>;
  /** `conflict` when the slug is taken; a cover must be an existing image. */
  createRoadmapBook(fields: RoadmapBookFields & { slug: string }): Promise<CreateRoadmapBookResult>;
  /** Changes only the given fields; `null` clears an optional one. */
  updateRoadmapBook(
    slug: string,
    changes: Partial<RoadmapBookFields>,
  ): Promise<UpdateRoadmapBookResult>;
  /** `referenced` while a resource links the book; its cover media stays. */
  deleteRoadmapBook(slug: string): Promise<DeleteRoadmapRecordResult>;

  /**
   * Every diary day that has notes or time entries, newest first, read in one consistent
   * snapshot. A day without either is not part of the diary.
   */
  loadDiary(): Promise<DiaryDayRecord[]>;
  /** The diary day, or `null` when it has neither notes nor time entries. */
  findDiaryDay(date: string): Promise<DiaryDayRecord | null>;
  /** Creates the day or replaces its notes; its time entries stay. */
  writeDiaryNotes(date: string, notes: string): Promise<DiaryDayRecord>;
  /** Clears the day's notes and keeps its time entries; `not_found` when it has no notes. */
  clearDiaryNotes(date: string): Promise<ClearDiaryNotesResult>;
  /** The time entry, or `null`. */
  findTimeEntry(id: string): Promise<TimeEntryRecord | null>;
  /**
   * Stores the pieces of one session on the resource, all or nothing, creating missing days also
   * under concurrent writes. The database refuses a piece that overlaps any stored interval,
   * including one committed concurrently, as `overlap`; touching endpoints do not overlap. Each
   * piece must lie within its diary day and end after it starts, or the write throws.
   */
  createTimeEntries(resource: string, pieces: TimeEntryPiece[]): Promise<CreateTimeEntriesResult>;
  /**
   * Replaces the time entry, locked against concurrent writes, with what `plan` derives from its
   * current state, all or nothing; `plan` may instead return its own refusal, which writes nothing.
   * The first piece keeps the entry's id. The same guarantees as `createTimeEntries` hold.
   */
  replaceTimeEntry<Refusal extends { ok: false }>(
    id: string,
    plan: (current: TimeEntryRecord) => TimeEntryReplacement | Refusal,
  ): Promise<ReplaceTimeEntryResult<Refusal>>;
  /** Deletes the time entry and returns its day, whose notes stay. */
  deleteTimeEntry(id: string): Promise<DeleteTimeEntryResult>;
}
