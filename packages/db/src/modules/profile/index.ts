import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { createCaseStudyPersistence } from "./case-studies.js";
import { createCatalogPersistence } from "./catalogs.js";
import { createCurrentFocusPersistence } from "./current-focus.js";
import { createEducationPersistence } from "./education.js";
import { createExperiencePersistence } from "./experiences.js";
import { createExplorationPersistence } from "./explorations.js";
import {
  checkMediaReferences,
  createMediaPersistence,
  type MediaReference,
  refusingMedia,
} from "./media.js";
import { createOrganizationPersistence } from "./organizations.js";
import { createProjectPersistence } from "./projects.js";
import { persons } from "./schema.js";
import { createServicePersistence } from "./services.js";
import { createTestimonialPersistence } from "./testimonials.js";
import type {
  CaseStudyPersistence,
  CatalogPersistence,
  CurrentFocusPersistence,
  EducationPersistence,
  ExperiencePersistence,
  ExplorationPersistence,
  MediaPersistence,
  MediaReferenceFailure,
  OrganizationPersistence,
  ProjectPersistence,
  ServicePersistence,
  TestimonialPersistence,
} from "./types.js";

export type {
  CaseStudyFields,
  CaseStudyPersistence,
  CaseStudyRecord,
  CatalogPersistence,
  CurrentFocusFields,
  CurrentFocusPersistence,
  CurrentFocusProjectRecord,
  CurrentFocusRecord,
  CurrentFocusRelations,
  CurrentFocusWriteFailure,
  CreateCaseStudyResult,
  CreateCurrentFocusResult,
  CreateEducationResult,
  CreateOrganizationResult,
  CreateProjectResult,
  CreateServiceResult,
  CreateTechnologyResult,
  CreateTestimonialResult,
  CreateExperienceResult,
  CreateExplorationResult,
  CreateTopicResult,
  DeleteCaseStudyResult,
  DeleteCurrentFocusResult,
  DeleteEducationResult,
  DeleteExperienceResult,
  DeleteExplorationResult,
  DeleteOrganizationResult,
  DeleteProjectResult,
  DeleteServiceResult,
  DeleteTechnologyResult,
  DeleteTestimonialResult,
  DeleteTopicResult,
  EducationFields,
  EducationKind,
  EducationPersistence,
  EducationRecord,
  EducationWriteFailure,
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
  DeleteMediaResult,
  MediaFields,
  MediaPersistence,
  MediaRecord,
  MediaReferenceFailure,
  MediaType,
  OrganizationFields,
  OrganizationMedia,
  OrganizationPersistence,
  OrganizationRecord,
  ProjectFields,
  ProjectLinkRecord,
  ProjectMedia,
  ProjectPersistence,
  ProjectRecord,
  ProjectRelations,
  ProjectWriteFailure,
  ServiceEvidence,
  ServiceEvidenceRecord,
  ServiceFields,
  ServicePersistence,
  ServiceRecord,
  ServiceWriteFailure,
  TechnologyFields,
  TechnologyGroup,
  TechnologyRecord,
  TechnologyTier,
  TestimonialFields,
  TestimonialPersistence,
  TestimonialRecord,
  TestimonialRelations,
  TestimonialWriteFailure,
  TopicFields,
  TopicRecord,
  UpdateCaseStudyResult,
  UpdateCurrentFocusResult,
  UpdateEducationResult,
  UpdateExperienceResult,
  UpdateExplorationResult,
  UpdateOrganizationResult,
  UpdateProjectResult,
  UpdateServiceResult,
  UpdateTechnologyResult,
  UpdateTestimonialResult,
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

/** Media attached to the person, by media id; `null` while none is attached. */
export interface PersonMedia {
  /** An image. */
  photoId: string | null;
  /** A PDF: the current, manually prepared CV PDF. */
  cvPdfId: string | null;
}

export interface PersonRecord extends PersonFields, PersonMedia {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

export type CreatePersonResult =
  { ok: true; person: PersonRecord } | { ok: false; reason: "conflict" } | MediaReferenceFailure;

export type UpdatePersonResult =
  { ok: true; person: PersonRecord } | { ok: false; reason: "not_found" } | MediaReferenceFailure;

/** Persistence operations of the profile domain. */
export interface ProfilePersistence
  extends
    CatalogPersistence,
    OrganizationPersistence,
    ExperiencePersistence,
    ExplorationPersistence,
    ProjectPersistence,
    CaseStudyPersistence,
    ServicePersistence,
    EducationPersistence,
    TestimonialPersistence,
    CurrentFocusPersistence,
    MediaPersistence {
  /** The person, or `null` when none exists. */
  findPerson(): Promise<PersonRecord | null>;
  /**
   * Creates the person; `conflict` when one already exists, also for a racing create; see
   * `MediaReferenceFailure`. Omitted media is `null`.
   */
  createPerson(fields: PersonFields & Partial<PersonMedia>): Promise<CreatePersonResult>;
  /** Changes only the given fields; `not_found` when there is no person. */
  updatePerson(changes: Partial<PersonFields & PersonMedia>): Promise<UpdatePersonResult>;
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
  photoId: persons.photoId,
  cvPdfId: persons.cvPdfId,
  createdAt: persons.createdAt,
  updatedAt: persons.updatedAt,
};

/** The photo must be an image and the CV PDF a PDF. */
const personMedia = (fields: Partial<PersonMedia>): MediaReference[] => [
  { field: "photoId", id: fields.photoId, kind: "image" },
  { field: "cvPdfId", id: fields.cvPdfId, kind: "pdf" },
];

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
    ...createServicePersistence(db),
    ...createEducationPersistence(db),
    ...createTestimonialPersistence(db),
    ...createCurrentFocusPersistence(db),
    ...createMediaPersistence(db),
    async findPerson() {
      const [row] = await db.select(columns).from(persons).limit(1);
      return row ?? null;
    },
    createPerson(fields) {
      return refusingMedia(() =>
        db.transaction(async (tx) => {
          await checkMediaReferences(tx, personMedia(fields));
          const [row] = await tx
            .insert(persons)
            .values(fields)
            .onConflictDoNothing({ target: persons.singleton })
            .returning(columns);
          return row
            ? ({ ok: true, person: row } as const)
            : ({ ok: false, reason: "conflict" } as const);
        }),
      );
    },
    updatePerson(changes) {
      return refusingMedia(() =>
        db.transaction(async (tx) => {
          await checkMediaReferences(tx, personMedia(changes));
          // `clock_timestamp()`, not `now()`: it advances also within one transaction.
          const [row] = await tx
            .update(persons)
            .set({ ...changes, updatedAt: sql`clock_timestamp()` })
            .returning(columns);
          return row
            ? ({ ok: true, person: row } as const)
            : ({ ok: false, reason: "not_found" } as const);
        }),
      );
    },
    async deletePerson() {
      const rows = await db.delete(persons).returning({ id: persons.id });
      return rows.length > 0;
    },
  };
}
