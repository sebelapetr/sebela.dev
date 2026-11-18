import { sql } from "drizzle-orm";
import {
  check,
  integer,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { topics } from "../profile/index.js";

export const roadmapSchema = pgSchema("ai_roadmap");

/** The slugs of the roadmap's own pages, which an area may never take. */
export const RESERVED_SLUG_CHECK = "areas_slug_not_reserved";
/** A resource finishes no earlier than it starts. */
export const PERIOD_CHECK = "resources_period_is_ordered";

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
 * Learning resources of a module. The plain foreign key keeps a module with resources from being
 * deleted; a missing estimate stays unknown rather than zero.
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
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
