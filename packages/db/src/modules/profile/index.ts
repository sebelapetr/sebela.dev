import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { createCaseStudyPersistence } from "./case-studies.js";
import { createCatalogPersistence } from "./catalogs.js";
import { createExperiencePersistence } from "./experiences.js";
import { createExplorationPersistence } from "./explorations.js";
import { createOrganizationPersistence } from "./organizations.js";
import { createProjectPersistence } from "./projects.js";
import { persons } from "./schema.js";
import type {
  CaseStudyPersistence,
  CatalogPersistence,
  ExperiencePersistence,
  ExplorationPersistence,
  OrganizationPersistence,
  ProjectPersistence,
} from "./types.js";

export type {
  CaseStudyFields,
  CaseStudyPersistence,
  CaseStudyRecord,
  CatalogPersistence,
  CreateCaseStudyResult,
  CreateOrganizationResult,
  CreateProjectResult,
  CreateTechnologyResult,
  CreateExperienceResult,
  CreateExplorationResult,
  CreateTopicResult,
  DeleteCaseStudyResult,
  DeleteExperienceResult,
  DeleteExplorationResult,
  DeleteOrganizationResult,
  DeleteProjectResult,
  DeleteTechnologyResult,
  DeleteTopicResult,
  ExperienceFields,
  ExperienceKind,
  ExperiencePersistence,
  ExperienceRecord,
  ExperienceRelations,
  ExperienceWriteFailure,
  ExplorationFields,
  ExplorationPersistence,
  ExplorationRecord,
  ExplorationRelations,
  ExplorationStatus,
  ExplorationWriteFailure,
  OrganizationFields,
  OrganizationPersistence,
  OrganizationRecord,
  ProjectFields,
  ProjectLinkRecord,
  ProjectPersistence,
  ProjectRecord,
  ProjectRelations,
  ProjectWriteFailure,
  TechnologyFields,
  TechnologyGroup,
  TechnologyRecord,
  TechnologyTier,
  TopicFields,
  TopicRecord,
  UpdateCaseStudyResult,
  UpdateExperienceResult,
  UpdateExplorationResult,
  UpdateProjectResult,
  UpdateTechnologyResult,
} from "./types.js";

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

/** Persistence operations of the profile domain. */
export interface ProfilePersistence
  extends
    CatalogPersistence,
    OrganizationPersistence,
    ExperiencePersistence,
    ExplorationPersistence,
    ProjectPersistence,
    CaseStudyPersistence {
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
    ...createOrganizationPersistence(db),
    ...createExperiencePersistence(db),
    ...createExplorationPersistence(db),
    ...createProjectPersistence(db),
    ...createCaseStudyPersistence(db),
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
