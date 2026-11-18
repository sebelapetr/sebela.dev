import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { media, topics } from "../profile/index.js";

export const roadmapSchema = pgSchema("ai_roadmap");

/** The slugs of the roadmap's own pages, which an area may never take. */
export const RESERVED_SLUG_CHECK = "areas_slug_not_reserved";
/** A resource finishes no earlier than it starts. */
export const PERIOD_CHECK = "resources_period_is_ordered";
/**
 * No two time entries overlap, whatever their learning target; touching endpoints do not overlap.
 * The exclusion constraint is added by hand in migration `0016_learning_diary.sql`, because
 * drizzle-kit cannot express it.
 */
export const TIME_ENTRY_OVERLAP_EXCLUSION = "time_entries_do_not_overlap";

/** A book ends no earlier than it starts. */
export const BOOK_PERIOD_CHECK = "books_period_is_ordered";
/** At most one resource links a book. */
export const BOOK_LINK_UNIQUE = "resources_book_id_unique";
/** Only a resource of type `book` links a book. */
export const BOOK_LINK_TYPE_CHECK = "resources_book_needs_book_type";

export const resourceType = roadmapSchema.enum("resource_type", [
  "youtube-video",
  "youtube-playlist",
  "google-drive",
  "video",
  "link",
  "text",
  "project",
  "book",
]);

export const resourceStatus = roadmapSchema.enum("resource_status", [
  "planned",
  "in-progress",
  "completed",
  "paused",
  "skipped",
]);

/**
 * Areas: the top level of the roadmap. Slugs are unique, the database refuses the slugs of the
 * roadmap's own pages, and the weight is the recommended share of effort from 1 to 100.
 */
export const areas = roadmapSchema.table(
  "areas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    weight: integer("weight").notNull(),
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("areas_position_not_negative", sql`${table.position} >= 0`),
    check("areas_weight_in_range", sql`${table.weight} BETWEEN 1 AND 100`),
    check(
      RESERVED_SLUG_CHECK,
      sql`${table.slug} NOT IN ('diary', 'bookshelf', 'events', 'how-to-read-effectively')`,
    ),
  ],
);

/** Modules of an area. The plain foreign key keeps an area with modules from being deleted. */
export const modules = roadmapSchema.table(
  "modules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    areaId: uuid("area_id")
      .notNull()
      .references(() => areas.id),
    name: text("name").notNull(),
    description: text("description"),
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check("modules_position_not_negative", sql`${table.position} >= 0`)],
);

/**
 * Books on the bookshelf. The optional cover refers to an uploaded image without a cascade, so a
 * cover in use cannot be deleted. Reading dates are calendar dates; the status is derived from
 * them on read, and the reading time comes from the linking resource's time entries.
 */
export const books = roadmapSchema.table(
  "books",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    author: text("author"),
    description: text("description"),
    pages: integer("pages"),
    year: integer("year"),
    isbn: text("isbn"),
    priority: integer("priority").notNull(),
    startedOn: date("started_on", { mode: "string" }),
    endedOn: date("ended_on", { mode: "string" }),
    summary: text("summary"),
    coverId: uuid("cover_id").references(() => media.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("books_priority_not_negative", sql`${table.priority} >= 0`),
    check("books_pages_positive", sql`${table.pages} IS NULL OR ${table.pages} > 0`),
    check(
      BOOK_PERIOD_CHECK,
      sql`${table.startedOn} IS NULL OR ${table.endedOn} IS NULL OR ${table.endedOn} >= ${table.startedOn}`,
    ),
  ],
);

/**
 * Learning resources of a module. The plain foreign key keeps a module with resources from being
 * deleted; a missing estimate stays unknown rather than zero. A resource of type `book` may link
 * one book, and each book is linked by at most one resource; a linked book cannot be deleted.
 */
export const resources = roadmapSchema.table(
  "resources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    moduleId: uuid("module_id")
      .notNull()
      .references(() => modules.id),
    name: text("name").notNull(),
    description: text("description"),
    type: resourceType("type").notNull(),
    status: resourceStatus("status").notNull(),
    estimatedMinutes: integer("estimated_minutes"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    link: text("link"),
    position: integer("position").notNull(),
    bookId: uuid("book_id").references(() => books.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique(BOOK_LINK_UNIQUE).on(table.bookId),
    check(BOOK_LINK_TYPE_CHECK, sql`${table.bookId} IS NULL OR ${table.type} = 'book'`),
    check("resources_position_not_negative", sql`${table.position} >= 0`),
    check(
      "resources_estimate_not_negative",
      sql`${table.estimatedMinutes} IS NULL OR ${table.estimatedMinutes} >= 0`,
    ),
    check(
      PERIOD_CHECK,
      sql`${table.startedAt} IS NULL OR ${table.finishedAt} IS NULL OR ${table.finishedAt} >= ${table.startedAt}`,
    ),
  ],
);

/**
 * The ordered topic links of a resource: pure link rows. They disappear with their resource; a
 * linked topic cannot be deleted. Each topic is linked once.
 */
export const resourceTopics = roadmapSchema.table(
  "resource_topics",
  {
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    topicId: uuid("topic_id")
      .notNull()
      .references(() => topics.id),
    position: integer("position").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.resourceId, table.topicId] }),
    unique("resource_topics_position_unique").on(table.resourceId, table.position),
  ],
);

/**
 * Diary days: one row per calendar date in Europe/Prague with its optional Markdown notes. A day
 * is part of the diary only while it has notes or time entries.
 */
export const diaryEntries = roadmapSchema.table("diary_entries", {
  date: date("date", { mode: "string" }).primaryKey(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Logged study intervals, each within one diary day: it starts on that Prague date and ends no
 * later than the next Prague midnight. Its resource cannot be deleted while it exists. Durations
 * are derived from the endpoints, never stored.
 */
export const timeEntries = roadmapSchema.table(
  "time_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    diaryDate: date("diary_date", { mode: "string" })
      .notNull()
      .references(() => diaryEntries.date),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("time_entries_diary_date_index").on(table.diaryDate),
    index("time_entries_resource_id_index").on(table.resourceId),
    check("time_entries_period_is_ordered", sql`${table.endedAt} > ${table.startedAt}`),
    check(
      "time_entries_within_diary_day",
      sql`${table.diaryDate} = (${table.startedAt} AT TIME ZONE 'Europe/Prague')::date AND ${table.endedAt} <= ((${table.diaryDate} + 1)::timestamp AT TIME ZONE 'Europe/Prague')`,
    ),
  ],
);
