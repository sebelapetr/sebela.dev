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

/** Kinds of attended event. */
export type RoadmapEventKind = "conference" | "meetup" | "workshop" | "lecture";

export interface RoadmapEventFields {
  name: string;
  kind: RoadmapEventKind;
  organizer: string | null;
  /** The first day, `YYYY-MM-DD` in Europe/Prague, inclusive. */
  startsOn: string;
  /** The last day, `YYYY-MM-DD`, inclusive and not before `startsOn`. */
  endsOn: string;
  place: string | null;
  online: boolean;
  link: string | null;
  takeaways: string | null;
}

/** An event's relations as written: the slugs of existing shared topics, in order. */
export interface RoadmapEventRelations {
  topics: string[];
}

export interface RoadmapEventRecord extends RoadmapEventFields {
  id: string;
  slug: string;
  /** Its topics in link order. */
  topics: TopicRecord[];
  /** The elapsed seconds of the time entries logged on it; its date range adds nothing. */
  attendanceSeconds: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Why an event write was refused. */
export type RoadmapEventWriteFailure =
  | { ok: false; reason: "unknown_topics"; slugs: string[] }
  | { ok: false; reason: "repeated_topics" }
  | { ok: false; reason: "invalid_period" };

export type CreateRoadmapEventResult =
  | { ok: true; event: RoadmapEventRecord }
  | { ok: false; reason: "conflict" }
  | RoadmapEventWriteFailure;

export type UpdateRoadmapEventResult =
  | { ok: true; event: RoadmapEventRecord }
  | { ok: false; reason: "not_found" }
  /** The new dates would leave attendance on the listed days, ascending, outside the event. */
  | { ok: false; reason: "strands_attendance"; dates: string[] }
  | RoadmapEventWriteFailure;

export interface RoadmapProjectIdeaFields {
  title: string;
  /** Markdown. */
  whyItMatters: string;
  /** Markdown; `null` when there is no advice yet. */
  howToStart: string | null;
  position: number;
}

/** A project idea's relations as written: the slugs of existing shared topics, in order. */
export interface RoadmapProjectIdeaRelations {
  topics: string[];
}

export interface RoadmapProjectIdeaRecord extends RoadmapProjectIdeaFields {
  id: string;
  slug: string;
  /** Its topics in link order. */
  topics: TopicRecord[];
  createdAt: Date;
  updatedAt: Date;
}

/** Why a project idea's topic links were refused. */
export type RoadmapProjectIdeaWriteFailure =
  | { ok: false; reason: "unknown_topics"; slugs: string[] }
  | { ok: false; reason: "repeated_topics" };

export type CreateRoadmapProjectIdeaResult =
  | { ok: true; projectIdea: RoadmapProjectIdeaRecord }
  | { ok: false; reason: "conflict" }
  | RoadmapProjectIdeaWriteFailure;

export type UpdateRoadmapProjectIdeaResult =
  | { ok: true; projectIdea: RoadmapProjectIdeaRecord }
  | { ok: false; reason: "not_found" }
  | RoadmapProjectIdeaWriteFailure;

export interface RoadmapFollowedSourceFields {
  title: string;
  /** Markdown; `null` when there is none. */
  description: string | null;
  link: string | null;
  /** A free short label such as `newsletter`. */
  kind: string;
  position: number;
}

export interface RoadmapFollowedSourceRecord extends RoadmapFollowedSourceFields {
  id: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
}

export type CreateRoadmapFollowedSourceResult =
  { ok: true; followedSource: RoadmapFollowedSourceRecord } | { ok: false; reason: "conflict" };

export type UpdateRoadmapFollowedSourceResult =
  { ok: true; followedSource: RoadmapFollowedSourceRecord } | { ok: false; reason: "not_found" };

export interface RoadmapGlossaryTermFields {
  term: string;
  /** Markdown. */
  description: string;
  position: number;
}

export interface RoadmapGlossaryTermRecord extends RoadmapGlossaryTermFields {
  id: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
}

export type CreateRoadmapGlossaryTermResult =
  { ok: true; glossaryTerm: RoadmapGlossaryTermRecord } | { ok: false; reason: "conflict" };

export type UpdateRoadmapGlossaryTermResult =
  { ok: true; glossaryTerm: RoadmapGlossaryTermRecord } | { ok: false; reason: "not_found" };

/** Supporting content is referenced by nothing, so a delete is refused only for a missing slug. */
export type DeleteRoadmapSupportingResult = { ok: true } | { ok: false; reason: "not_found" };

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

/** The event a time entry belongs to or a diary day shows. */
export interface DiaryEventRecord {
  slug: string;
  name: string;
  kind: RoadmapEventKind;
  startsOn: string;
  endsOn: string;
  link: string | null;
}

/** What a time entry is logged on: one resource by slug or one event by slug. */
export type TimeEntryTarget = { resource: string } | { event: string };

export interface TimeEntryRecord {
  id: string;
  /** Its diary day, `YYYY-MM-DD`. */
  date: string;
  /** The resource studied, or `null` for attendance at an event. */
  resource: DiaryResourceRecord | null;
  /** The event attended, or `null` for a study session. */
  event: DiaryEventRecord | null;
  startedAt: Date;
  endedAt: Date;
}

/**
 * A diary day with its notes, its time entries in start order and the events whose date range
 * covers it, by start date, then slug.
 */
export interface DiaryDayRecord {
  date: string;
  notes: string | null;
  entries: TimeEntryRecord[];
  events: DiaryEventRecord[];
}

/**
 * Why a time-entry write was refused: the resource or event does not exist, a piece of attendance
 * falls on a day outside the event's dates, or a piece overlaps a stored interval of any target.
 */
export type TimeEntryWriteFailure =
  | { ok: false; reason: "unknown_resource" }
  | { ok: false; reason: "unknown_event" }
  | { ok: false; reason: "outside_event"; startsOn: string; endsOn: string }
  | { ok: false; reason: "overlap" };

export type CreateTimeEntriesResult =
  { ok: true; entries: TimeEntryRecord[] } | TimeEntryWriteFailure;

/** What replaces a time entry: its target and the new pieces, the first keeping the id. */
export interface TimeEntryReplacement {
  target: TimeEntryTarget;
  pieces: TimeEntryPiece[];
}

export type ReplaceTimeEntryResult<Refusal> =
  | { ok: true; entries: TimeEntryRecord[]; previousDate: string }
  | { ok: false; reason: "not_found" }
  | TimeEntryWriteFailure
  | Refusal;

export type DeleteTimeEntryResult = { ok: true; date: string } | { ok: false; reason: "not_found" };

export type ClearDiaryNotesResult = { ok: true } | { ok: false; reason: "not_found" };

/** Logged time split into its three categories, in whole seconds; they sum to `totalSeconds`. */
export interface LearningTimeSplitRecord {
  totalSeconds: number;
  /** Time on resources whose type is not `book`. */
  resourceSeconds: number;
  /** Time on resources of type `book`. */
  bookSeconds: number;
  /** Attendance on events. */
  eventSeconds: number;
}

/** Study time of an area or module: resource and book time, never event attendance. */
export interface LearningStudyTimeRecord {
  slug: string;
  name: string;
  /** `resourceSeconds` plus `bookSeconds`. */
  totalSeconds: number;
  resourceSeconds: number;
  bookSeconds: number;
}

export interface LearningTimeAreaRecord extends LearningStudyTimeRecord {
  /** Its modules with study time, by total (largest first), then slug. */
  modules: LearningStudyTimeRecord[];
}

/** A resource with logged time, in its current module and area. */
export interface LearningTimeResourceRecord {
  slug: string;
  name: string;
  type: RoadmapResourceType;
  module: { slug: string; name: string };
  area: { slug: string; name: string };
  /** The book it reads, or `null`. */
  book: { slug: string; title: string } | null;
  totalSeconds: number;
}

/** An event with attendance. */
export interface LearningTimeEventRecord {
  slug: string;
  name: string;
  kind: RoadmapEventKind;
  startsOn: string;
  endsOn: string;
  totalSeconds: number;
}

/**
 * The learning statistics, aggregated in one consistent snapshot. Every time entry counts exactly
 * once in each view: its Europe/Prague diary day, that day's Monday-start week and its month.
 */
export interface LearningStatisticsRecord {
  totals: LearningTimeSplitRecord & { activeDays: number };
  /** Every diary day with logged time, oldest first. */
  days: (LearningTimeSplitRecord & { date: string })[];
  /** Every week from the first to the last with time, oldest first; a gap week has zeros. */
  weeks: (LearningTimeSplitRecord & { startsOn: string })[];
  /** Every month (`YYYY-MM`) from the first to the last with time, oldest first; gaps have zeros. */
  months: (LearningTimeSplitRecord & { month: string })[];
  /** The areas with study time, by total (largest first), then slug. */
  areas: LearningTimeAreaRecord[];
  /** The resources with logged time, by total (largest first), then slug. */
  resources: LearningTimeResourceRecord[];
  /** The events with attendance, by total (largest first), then slug. */
  events: LearningTimeEventRecord[];
}

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
   * Every attended event, newest start first, then latest end and slug, each with its topics and
   * attendance time, read in one consistent snapshot.
   */
  listRoadmapEvents(): Promise<RoadmapEventRecord[]>;
  /** The event with the slug, or `null`. */
  findRoadmapEvent(slug: string): Promise<RoadmapEventRecord | null>;
  /**
   * Creates an event with its topic links, all or nothing; `conflict` when the slug is taken and
   * `invalid_period` when it ends before it starts.
   */
  createRoadmapEvent(
    fields: RoadmapEventFields & RoadmapEventRelations & { slug: string },
  ): Promise<CreateRoadmapEventResult>;
  /**
   * Changes only the given fields, locked against concurrent attendance writes; given `topics`
   * replace its links. Refused with `strands_attendance`, changing nothing, when a time entry on
   * the event would fall outside its new dates.
   */
  updateRoadmapEvent(
    slug: string,
    changes: Partial<RoadmapEventFields & RoadmapEventRelations>,
  ): Promise<UpdateRoadmapEventResult>;
  /** Deletes the event and its topic links; `referenced` while a time entry belongs to it. */
  deleteRoadmapEvent(slug: string): Promise<DeleteRoadmapRecordResult>;

  /** Every project idea by position, then slug, each with its topics, in one consistent snapshot. */
  listRoadmapProjectIdeas(): Promise<RoadmapProjectIdeaRecord[]>;
  /** The project idea with the slug, or `null`. */
  findRoadmapProjectIdea(slug: string): Promise<RoadmapProjectIdeaRecord | null>;
  /** Creates a project idea with its topic links, all or nothing; `conflict` for a taken slug. */
  createRoadmapProjectIdea(
    fields: RoadmapProjectIdeaFields & RoadmapProjectIdeaRelations & { slug: string },
  ): Promise<CreateRoadmapProjectIdeaResult>;
  /**
   * Changes only the given fields, all or nothing; given `topics` replace its links. Its update
   * time changes with every write.
   */
  updateRoadmapProjectIdea(
    slug: string,
    changes: Partial<RoadmapProjectIdeaFields & RoadmapProjectIdeaRelations>,
  ): Promise<UpdateRoadmapProjectIdeaResult>;
  /** Deletes the project idea and its topic links; its topics stay. */
  deleteRoadmapProjectIdea(slug: string): Promise<DeleteRoadmapSupportingResult>;

  /** Every followed source by position, then slug. */
  listRoadmapFollowedSources(): Promise<RoadmapFollowedSourceRecord[]>;
  /** The followed source with the slug, or `null`. */
  findRoadmapFollowedSource(slug: string): Promise<RoadmapFollowedSourceRecord | null>;
  /** `conflict` when the slug is taken. */
  createRoadmapFollowedSource(
    fields: RoadmapFollowedSourceFields & { slug: string },
  ): Promise<CreateRoadmapFollowedSourceResult>;
  /** Changes only the given fields; `null` clears an optional one. */
  updateRoadmapFollowedSource(
    slug: string,
    changes: Partial<RoadmapFollowedSourceFields>,
  ): Promise<UpdateRoadmapFollowedSourceResult>;
  deleteRoadmapFollowedSource(slug: string): Promise<DeleteRoadmapSupportingResult>;

  /** Every glossary term by position, then slug. */
  listRoadmapGlossaryTerms(): Promise<RoadmapGlossaryTermRecord[]>;
  /** The glossary term with the slug, or `null`. */
  findRoadmapGlossaryTerm(slug: string): Promise<RoadmapGlossaryTermRecord | null>;
  /** `conflict` when the slug is taken. */
  createRoadmapGlossaryTerm(
    fields: RoadmapGlossaryTermFields & { slug: string },
  ): Promise<CreateRoadmapGlossaryTermResult>;
  /** Changes only the given fields. */
  updateRoadmapGlossaryTerm(
    slug: string,
    changes: Partial<RoadmapGlossaryTermFields>,
  ): Promise<UpdateRoadmapGlossaryTermResult>;
  deleteRoadmapGlossaryTerm(slug: string): Promise<DeleteRoadmapSupportingResult>;

  /**
   * Every diary day that has notes, time entries or an event covering it, newest first, read in
   * one consistent snapshot. A day without any of them is not part of the diary.
   */
  loadDiary(): Promise<DiaryDayRecord[]>;
  /** The diary day, or `null` when it has no notes, no time entries and no covering event. */
  findDiaryDay(date: string): Promise<DiaryDayRecord | null>;
  /** Creates the day or replaces its notes; its time entries stay. */
  writeDiaryNotes(date: string, notes: string): Promise<DiaryDayRecord>;
  /** Clears the day's notes and keeps its time entries; `not_found` when it has no notes. */
  clearDiaryNotes(date: string): Promise<ClearDiaryNotesResult>;
  /** The time entry, or `null`. */
  findTimeEntry(id: string): Promise<TimeEntryRecord | null>;
  /**
   * Stores the pieces of one session on the resource or event, all or nothing, creating missing
   * days also under concurrent writes. Attendance must fall on the event's days (`outside_event`),
   * judged against the event locked against a concurrent date edit. The database refuses a piece
   * that overlaps any stored interval of either target, including one committed concurrently, as
   * `overlap`; touching endpoints do not overlap. Each piece must lie within its diary day and end
   * after it starts, or the write throws.
   */
  createTimeEntries(
    target: TimeEntryTarget,
    pieces: TimeEntryPiece[],
  ): Promise<CreateTimeEntriesResult>;
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

  /**
   * The learning statistics over every time entry, aggregated in the database in one read-only,
   * consistent snapshot. An empty diary gives zero totals and empty lists.
   */
  loadLearningStatistics(): Promise<LearningStatisticsRecord>;
}
