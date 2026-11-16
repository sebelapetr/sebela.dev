import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import type { PersonLinkRecord } from "./index.js";

export const profileSchema = pgSchema("profile");

/**
 * The one person the site is about. `singleton` is always `true` and unique, so the database itself
 * refuses a second row, also when two creates race.
 */
export const persons = profileSchema.table(
  "persons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    singleton: boolean("singleton").notNull().default(true).unique(),
    name: text("name").notNull(),
    headline: text("headline").notNull(),
    shortBio: text("short_bio").notNull(),
    longBio: text("long_bio"),
    location: text("location"),
    email: text("email"),
    links: jsonb("links").$type<PersonLinkRecord[]>().notNull().default([]),
    availability: text("availability"),
    careerStartedOn: date("career_started_on", { mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check("persons_singleton_is_true", sql`${table.singleton}`)],
);

/** Listed in this order: primary technologies before secondary ones. */
export const technologyTier = profileSchema.enum("technology_tier", ["primary", "secondary"]);

/** Listed in this order: `core` before `ai_engineering_focus`. */
export const technologyGroup = profileSchema.enum("technology_group", [
  "core",
  "ai_engineering_focus",
]);

/**
 * The technology catalog. A primary technology belongs to exactly one group, a secondary one to
 * none; the database refuses anything else, so no write path can store an inconsistent row.
 */
export const technologies = profileSchema.table(
  "technologies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    tier: technologyTier("tier").notNull(),
    group: technologyGroup("group"),
    logoKey: text("logo_key"),
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "technologies_group_matches_tier",
      sql`(${table.tier} = 'primary') = (${table.group} IS NOT NULL)`,
    ),
    check("technologies_position_not_negative", sql`${table.position} >= 0`),
  ],
);

/** The topic catalog: subjects that later profile records refer to. */
export const topics = profileSchema.table(
  "topics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check("topics_position_not_negative", sql`${table.position} >= 0`)],
);
