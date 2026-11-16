import { sql } from "drizzle-orm";
import { boolean, check, date, jsonb, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";

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
