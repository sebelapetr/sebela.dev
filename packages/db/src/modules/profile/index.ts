import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { createCaseStudyPersistence } from "./case-studies.js";
import { createCatalogPersistence } from "./catalogs.js";
import { createCurrentFocusPersistence } from "./current-focus.js";
import { createEducationPersistence } from "./education.js";
import { createExperiencePersistence } from "./experiences.js";
import { createExplorationPersistence } from "./explorations.js";
import { createCvPersistence, type CvPersistence } from "./cv.js";
import { createMediaPersistence } from "./media.js";
import { createOrganizationPersistence } from "./organizations.js";
import { createProjectPersistence } from "./projects.js";
import { createPersonPersistence, type PersonPersistence } from "./person.js";
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
export type { CvPersistence, CvRecord } from "./cv.js";
export type {
  CreatePersonResult,
  PersonFields,
  PersonLinkRecord,
  PersonMedia,
  PersonPersistence,
  PersonRecord,
  UpdatePersonResult,
} from "./person.js";

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
    MediaPersistence,
    PersonPersistence,
    CvPersistence {}

/** Every profile persistence operation over one database connection. */
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
    ...createPersonPersistence(db),
    ...createCvPersistence(db),
  };
}
