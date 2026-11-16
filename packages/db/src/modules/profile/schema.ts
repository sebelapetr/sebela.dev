import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import type { PersonLinkRecord } from "./index.js";
import type { ProjectLinkRecord } from "./types.js";

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

/**
 * Organizations that experiences and other records refer to. Referencing tables use plain foreign
 * keys, so the database refuses to delete an organization that is still referenced.
 */
export const organizations = profileSchema.table("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  website: text("website"),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** The kinds of an experience. */
export const experienceKind = profileSchema.enum("experience_kind", [
  "main_job",
  "side_project",
  "own_business",
]);

/**
 * Experiences: roles at an organization over a period. The organization key has no cascade, so an
 * organization is never deleted while an experience refers to it; a missing end marks a current
 * role, and the database refuses an end before the start.
 */
export const experiences = profileSchema.table(
  "experiences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    kind: experienceKind("kind").notNull(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    startedOn: date("started_on", { mode: "string" }).notNull(),
    endedOn: date("ended_on", { mode: "string" }),
    summary: text("summary").notNull(),
    responsibilities: jsonb("responsibilities").$type<string[]>().notNull().default([]),
    inCv: boolean("in_cv").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "experiences_period_is_ordered",
      sql`${table.endedOn} IS NULL OR ${table.endedOn} >= ${table.startedOn}`,
    ),
  ],
);

/**
 * The ordered technology links of an experience: pure link rows. They disappear with their
 * experience; a linked technology cannot be deleted. Each technology is linked once.
 */
export const experienceTechnologies = profileSchema.table(
  "experience_technologies",
  {
    experienceId: uuid("experience_id")
      .notNull()
      .references(() => experiences.id, { onDelete: "cascade" }),
    technologyId: uuid("technology_id")
      .notNull()
      .references(() => technologies.id),
    position: integer("position").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.experienceId, table.technologyId] }),
    unique("experience_technologies_position_unique").on(table.experienceId, table.position),
  ],
);

/**
 * Projects delivered within an experience. The experience key is required and has no cascade, so
 * every project has exactly one owner and an experience is never deleted while it owns a project.
 * A missing end marks an ongoing project, and the database refuses an end before the start.
 */
export const projects = profileSchema.table(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    experienceId: uuid("experience_id")
      .notNull()
      .references(() => experiences.id),
    name: text("name").notNull(),
    summary: text("summary").notNull(),
    problem: text("problem").notNull(),
    workDone: text("work_done").notNull(),
    result: text("result").notNull(),
    startedOn: date("started_on", { mode: "string" }).notNull(),
    endedOn: date("ended_on", { mode: "string" }),
    links: jsonb("links").$type<ProjectLinkRecord[]>().notNull().default([]),
    selectedForHomepage: boolean("selected_for_homepage").notNull().default(false),
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("projects_experience_id_index").on(table.experienceId),
    check("projects_position_not_negative", sql`${table.position} >= 0`),
    check(
      "projects_period_is_ordered",
      sql`${table.endedOn} IS NULL OR ${table.endedOn} >= ${table.startedOn}`,
    ),
  ],
);

/**
 * The ordered technology links of a project: pure link rows. They disappear with their project; a
 * linked technology cannot be deleted. Each technology is linked once.
 */
export const projectTechnologies = profileSchema.table(
  "project_technologies",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    technologyId: uuid("technology_id")
      .notNull()
      .references(() => technologies.id),
    position: integer("position").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.technologyId] }),
    unique("project_technologies_position_unique").on(table.projectId, table.position),
  ],
);

/**
 * The long-form case study of a project. The unique `project_id` keeps at most one per project,
 * also against racing creates; the foreign key has no cascade, so a project with a case study
 * cannot be deleted until the case study is removed.
 */
export const caseStudies = profileSchema.table("case_studies", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .unique()
    .references(() => projects.id),
  role: text("role").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
