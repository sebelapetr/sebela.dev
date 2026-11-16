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
  uniqueIndex,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import type { PersonLinkRecord } from "./index.js";
import type { ProjectLinkRecord } from "./types.js";

export const profileSchema = pgSchema("profile");

/** The accepted media types: PNG, JPEG and WebP images and PDF documents. */
export const mediaType = profileSchema.enum("media_type", [
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
]);

/**
 * Metadata of uploaded files; the files live in storage under `key`, never under a
 * deployment-specific address. Images have positive dimensions and a PDF has none; the database
 * refuses anything else (the check spells out `IS NOT NULL`, because a check that is `NULL` passes). Referencing rows use foreign keys without a cascade, so referenced media
 * is never deleted.
 */
export const media = profileSchema.table(
  "media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull().unique(),
    mediaType: mediaType("media_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    width: integer("width"),
    height: integer("height"),
    altText: text("alt_text"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("media_byte_size_positive", sql`${table.byteSize} > 0`),
    check(
      "media_dimensions_match_type",
      sql`(${table.mediaType} = 'application/pdf' AND ${table.width} IS NULL AND ${table.height} IS NULL) OR (${table.mediaType} <> 'application/pdf' AND ${table.width} IS NOT NULL AND ${table.height} IS NOT NULL AND ${table.width} > 0 AND ${table.height} > 0)`,
    ),
  ],
);

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
    photoId: uuid("photo_id").references(() => media.id),
    cvPdfId: uuid("cv_pdf_id").references(() => media.id),
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
  logoId: uuid("logo_id").references(() => media.id),
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
    coverId: uuid("cover_id").references(() => media.id),
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

/** How far an exploration got; the database stores nothing else. */
export const explorationStatus = profileSchema.enum("exploration_status", [
  "built",
  "tested",
  "designed",
]);

/**
 * Explorations: independent work outside the career timeline, with an honest status. They refer
 * to no experience and no project. A missing end marks an ongoing exploration, and the database
 * refuses an end before the start.
 */
export const explorations = profileSchema.table(
  "explorations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    summary: text("summary").notNull(),
    status: explorationStatus("status").notNull(),
    concepts: jsonb("concepts").$type<string[]>().notNull().default([]),
    startedOn: date("started_on", { mode: "string" }).notNull(),
    endedOn: date("ended_on", { mode: "string" }),
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("explorations_position_not_negative", sql`${table.position} >= 0`),
    check(
      "explorations_period_is_ordered",
      sql`${table.endedOn} IS NULL OR ${table.endedOn} >= ${table.startedOn}`,
    ),
  ],
);

/**
 * The ordered technology links of an exploration: pure link rows. They disappear with their
 * exploration; a linked technology cannot be deleted. Each technology is linked once.
 */
export const explorationTechnologies = profileSchema.table(
  "exploration_technologies",
  {
    explorationId: uuid("exploration_id")
      .notNull()
      .references(() => explorations.id, { onDelete: "cascade" }),
    technologyId: uuid("technology_id")
      .notNull()
      .references(() => technologies.id),
    position: integer("position").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.explorationId, table.technologyId] }),
    unique("exploration_technologies_position_unique").on(table.explorationId, table.position),
  ],
);

/**
 * The ordered topic links of an exploration: pure link rows. They disappear with their
 * exploration; a linked topic cannot be deleted. Each topic is linked once.
 */
export const explorationTopics = profileSchema.table(
  "exploration_topics",
  {
    explorationId: uuid("exploration_id")
      .notNull()
      .references(() => explorations.id, { onDelete: "cascade" }),
    topicId: uuid("topic_id")
      .notNull()
      .references(() => topics.id),
    position: integer("position").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.explorationId, table.topicId] }),
    unique("exploration_topics_position_unique").on(table.explorationId, table.position),
  ],
);

/** A service: something a client can order. Slugs are unique; the order is by position. */
export const services = profileSchema.table(
  "services",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    summary: text("summary").notNull(),
    audience: text("audience").notNull(),
    deliverable: text("deliverable").notNull(),
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check("services_position_not_negative", sql`${table.position} >= 0`)],
);

/** What a piece of service evidence points at. */
export const serviceEvidenceKind = profileSchema.enum("service_evidence_kind", [
  "project",
  "exploration",
  "link",
]);

/**
 * The ordered evidence of a service. Each row is one kind and sets exactly that kind's columns: a
 * project, an exploration, or a link label and site path. The rows disappear with their service;
 * a project or exploration that a row names cannot be deleted. Each project and exploration
 * appears at most once per service.
 */
export const serviceEvidence = profileSchema.table(
  "service_evidence",
  {
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    kind: serviceEvidenceKind("kind").notNull(),
    projectId: uuid("project_id").references(() => projects.id),
    explorationId: uuid("exploration_id").references(() => explorations.id),
    linkLabel: text("link_label"),
    linkPath: text("link_path"),
  },
  (table) => [
    primaryKey({ columns: [table.serviceId, table.position] }),
    index("service_evidence_project_id_index").on(table.projectId),
    index("service_evidence_exploration_id_index").on(table.explorationId),
    uniqueIndex("service_evidence_project_unique")
      .on(table.serviceId, table.projectId)
      .where(sql`${table.projectId} IS NOT NULL`),
    uniqueIndex("service_evidence_exploration_unique")
      .on(table.serviceId, table.explorationId)
      .where(sql`${table.explorationId} IS NOT NULL`),
    check(
      "service_evidence_matches_kind",
      sql`CASE ${table.kind}
        WHEN 'project' THEN ${table.projectId} IS NOT NULL AND ${table.explorationId} IS NULL
          AND ${table.linkLabel} IS NULL AND ${table.linkPath} IS NULL
        WHEN 'exploration' THEN ${table.explorationId} IS NOT NULL AND ${table.projectId} IS NULL
          AND ${table.linkLabel} IS NULL AND ${table.linkPath} IS NULL
        ELSE ${table.linkLabel} IS NOT NULL AND ${table.linkPath} IS NOT NULL
          AND ${table.projectId} IS NULL AND ${table.explorationId} IS NULL
      END`,
    ),
  ],
);

/** What kind of learning an education record is; the database stores nothing else. */
export const educationKind = profileSchema.enum("education_kind", [
  "school",
  "course",
  "certification",
  "milestone",
]);

/**
 * Education: schools, courses, certifications and other learning milestones, in their intended
 * order. The period is flexible but never empty: a start alone marks ongoing learning, an end
 * alone a completion on that day, and the database refuses an end before the start.
 */
export const education = profileSchema.table(
  "education",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    kind: educationKind("kind").notNull(),
    title: text("title").notNull(),
    institution: text("institution"),
    startedOn: date("started_on", { mode: "string" }),
    endedOn: date("ended_on", { mode: "string" }),
    description: text("description"),
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("education_position_not_negative", sql`${table.position} >= 0`),
    check(
      "education_period_is_dated",
      sql`${table.startedOn} IS NOT NULL OR ${table.endedOn} IS NOT NULL`,
    ),
    check(
      "education_period_is_ordered",
      sql`${table.startedOn} IS NULL OR ${table.endedOn} IS NULL OR ${table.endedOn} >= ${table.startedOn}`,
    ),
  ],
);

/**
 * Testimonials: quotes from clients and colleagues, each tied to the experience it is about. The
 * experience key is required and has no cascade, so every testimonial belongs to exactly one
 * experience and an experience is never deleted while a testimonial belongs to it.
 */
export const testimonials = profileSchema.table(
  "testimonials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    experienceId: uuid("experience_id")
      .notNull()
      .references(() => experiences.id),
    quote: text("quote").notNull(),
    authorName: text("author_name").notNull(),
    authorRole: text("author_role").notNull(),
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("testimonials_experience_id_index").on(table.experienceId),
    check("testimonials_position_not_negative", sql`${table.position} >= 0`),
  ],
);

/**
 * The current focus: what is being built or learned right now. The project key is optional and
 * has no cascade, so a project is never deleted while a focus entry is about it.
 */
export const currentFocus = profileSchema.table(
  "current_focus",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    link: text("link"),
    projectId: uuid("project_id").references(() => projects.id),
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("current_focus_project_id_index").on(table.projectId),
    check("current_focus_position_not_negative", sql`${table.position} >= 0`),
  ],
);

/**
 * Ordered topic links of a focus entry. They cascade with the entry; a linked topic cannot be
 * deleted.
 */
export const currentFocusTopics = profileSchema.table(
  "current_focus_topics",
  {
    currentFocusId: uuid("current_focus_id")
      .notNull()
      .references(() => currentFocus.id, { onDelete: "cascade" }),
    topicId: uuid("topic_id")
      .notNull()
      .references(() => topics.id),
    position: integer("position").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.currentFocusId, table.topicId] }),
    unique("current_focus_topics_position_unique").on(table.currentFocusId, table.position),
  ],
);
