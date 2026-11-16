import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { createCatalogPersistence } from "./catalogs.js";
import { persons } from "./schema.js";

export interface PersonLinkRecord {
  label: string;
  url: string;
}

/** Writable fields of the person as they are stored. */
export interface PersonFields {
  name: string;
  headline: string;
  shortBio: string;
  longBio: string | null;
  location: string | null;
  email: string | null;
  links: PersonLinkRecord[];
  availability: string | null;
  /** Calendar date, `YYYY-MM-DD`. */
  careerStartedOn: string | null;
}

export interface PersonRecord extends PersonFields {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

export type CreatePersonResult =
  { ok: true; person: PersonRecord } | { ok: false; reason: "conflict" };

export type TechnologyTier = "primary" | "secondary";
export type TechnologyGroup = "core" | "ai_engineering_focus";

/** Writable fields of a technology. The slug is fixed when it is created. */
export interface TechnologyFields {
  name: string;
  tier: TechnologyTier;
  /** Set exactly when the tier is `primary`; the database refuses anything else. */
  group: TechnologyGroup | null;
  /** A key into the website's static logos, not an upload. */
  logoKey: string | null;
  position: number;
}

export interface TechnologyRecord extends TechnologyFields {
  id: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
}

export type CreateTechnologyResult =
  { ok: true; technology: TechnologyRecord } | { ok: false; reason: "conflict" | "inconsistent" };

export type UpdateTechnologyResult =
  { ok: true; technology: TechnologyRecord } | { ok: false; reason: "not_found" | "inconsistent" };

/** Writable fields of a topic. The slug is fixed when it is created. */
export interface TopicFields {
  name: string;
  position: number;
}

export interface TopicRecord extends TopicFields {
  id: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
}

export type CreateTopicResult =
  { ok: true; topic: TopicRecord } | { ok: false; reason: "conflict" };

/** Persistence operations of the ordered technology and topic catalogs. */
export interface CatalogPersistence {
  /** Every technology: primary before secondary, `core` before `ai_engineering_focus`, then position and slug. */
  listTechnologies(): Promise<TechnologyRecord[]>;
  /** The technology with the slug, or `null`. */
  findTechnology(slug: string): Promise<TechnologyRecord | null>;
  /** `conflict` when the slug is taken, also for a racing create; `inconsistent` when group and tier disagree. */
  createTechnology(fields: TechnologyFields & { slug: string }): Promise<CreateTechnologyResult>;
  /** Changes only the given fields; `inconsistent` when the resulting group and tier disagree. */
  updateTechnology(
    slug: string,
    changes: Partial<TechnologyFields>,
  ): Promise<UpdateTechnologyResult>;
  /** `true` when the technology was deleted, `false` when there was none. */
  deleteTechnology(slug: string): Promise<boolean>;
  /** Every topic, ordered by position and slug. */
  listTopics(): Promise<TopicRecord[]>;
  /** The topic with the slug, or `null`. */
  findTopic(slug: string): Promise<TopicRecord | null>;
  /** `conflict` when the slug is taken, also for a racing create. */
  createTopic(fields: TopicFields & { slug: string }): Promise<CreateTopicResult>;
  /** Changes only the given fields; `null` when there is no such topic. */
  updateTopic(slug: string, changes: Partial<TopicFields>): Promise<TopicRecord | null>;
  /** `true` when the topic was deleted, `false` when there was none. */
  deleteTopic(slug: string): Promise<boolean>;
}

/** Persistence operations of the profile domain. */
export interface ProfilePersistence extends CatalogPersistence {
  /** The person, or `null` when none exists. */
  findPerson(): Promise<PersonRecord | null>;
  /** Creates the person; `conflict` when one already exists, also for a racing create. */
  createPerson(fields: PersonFields): Promise<CreatePersonResult>;
  /** Changes only the given fields; `null` when there is no person. */
  updatePerson(changes: Partial<PersonFields>): Promise<PersonRecord | null>;
  /** `true` when a person was deleted, `false` when there was none. */
  deletePerson(): Promise<boolean>;
}

const columns = {
  id: persons.id,
  name: persons.name,
  headline: persons.headline,
  shortBio: persons.shortBio,
  longBio: persons.longBio,
  location: persons.location,
  email: persons.email,
  links: persons.links,
  availability: persons.availability,
  careerStartedOn: persons.careerStartedOn,
  createdAt: persons.createdAt,
  updatedAt: persons.updatedAt,
};

/**
 * The singleton person in `profile.persons`. There is at most one row: the unique `singleton`
 * column decides concurrent creates inside the database, and the loser sees a conflict.
 */
export function createProfilePersistence(db: NodePgDatabase): ProfilePersistence {
  return {
    ...createCatalogPersistence(db),
    async findPerson() {
      const [row] = await db.select(columns).from(persons).limit(1);
      return row ?? null;
    },
    async createPerson(fields) {
      const [row] = await db
        .insert(persons)
        .values(fields)
        .onConflictDoNothing({ target: persons.singleton })
        .returning(columns);
      return row ? { ok: true, person: row } : { ok: false, reason: "conflict" };
    },
    async updatePerson(changes) {
      // `clock_timestamp()`, not `now()`: it advances also within one transaction.
      const [row] = await db
        .update(persons)
        .set({ ...changes, updatedAt: sql`clock_timestamp()` })
        .returning(columns);
      return row ?? null;
    },
    async deletePerson() {
      const rows = await db.delete(persons).returning({ id: persons.id });
      return rows.length > 0;
    },
  };
}
