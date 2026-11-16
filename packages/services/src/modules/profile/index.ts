import type { Person, PersonCreate, PersonUpdate } from "@sebela/contracts";
import type { PersonFields, PersonRecord, ProfilePersistence } from "@sebela/db";

import { DomainError } from "../../errors.js";
import { createCaseStudyService } from "./case-studies.js";
import { createCatalogService } from "./catalogs.js";
import { definedChanges } from "./changes.js";
import { createEducationService } from "./education.js";
import { createExperienceService } from "./experiences.js";
import { createExplorationService } from "./explorations.js";
import { createOrganizationService } from "./organizations.js";
import { createProjectService } from "./projects.js";
import { createServiceService } from "./services.js";
import { createTestimonialService } from "./testimonials.js";
import type {
  CaseStudyService,
  CatalogService,
  EducationService,
  ExperienceService,
  ExplorationService,
  OrganizationService,
  ProjectService,
  ServiceService,
  TestimonialService,
} from "./types.js";

export type {
  CaseStudyService,
  CatalogService,
  EducationService,
  ExperienceService,
  ExplorationService,
  OrganizationService,
  ProjectService,
  ServiceService,
  TestimonialService,
} from "./types.js";

/**
 * Operations on the person, the one profile record. Results are in the contract shape of
 * `@sebela/contracts`; expected failures are `DomainError`s:
 *
 * - `getPerson`: the person, or `not_found` while there is none.
 * - `createPerson`: creates the person; `conflict` when one exists, also when creates race.
 * - `updatePerson`: changes only the given fields, keeps `id` and `createdAt` and advances
 *   `updatedAt`; `not_found` while there is no person.
 * - `deletePerson`: removes the person; `not_found` while there is none.
 *
 * It also includes the catalog operations of `CatalogService`, the organization operations of
 * `OrganizationService`, the experience operations of `ExperienceService`, the project
 * operations of `ProjectService`, the case-study operations of `CaseStudyService`, the
 * exploration operations of `ExplorationService`, the service operations of `ServiceService`, the
 * education operations of `EducationService` and the testimonial operations of
 * `TestimonialService`.
 */
export interface ProfileService
  extends
    CatalogService,
    OrganizationService,
    ExperienceService,
    ProjectService,
    CaseStudyService,
    ExplorationService,
    ServiceService,
    EducationService,
    TestimonialService {
  getPerson(): Promise<Person>;
  createPerson(input: PersonCreate): Promise<Person>;
  updatePerson(changes: PersonUpdate): Promise<Person>;
  deletePerson(): Promise<void>;
}

const missing = () => new DomainError("not_found", "There is no person yet.");

function toPerson(record: PersonRecord): Person {
  return {
    ...record,
    links: record.links.map(({ label, url }) => ({ label, url })),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function createProfileService(persistence: ProfilePersistence): ProfileService {
  return {
    ...createCatalogService(persistence),
    ...createOrganizationService(persistence),
    ...createExperienceService(persistence),
    ...createProjectService(persistence),
    ...createCaseStudyService(persistence),
    ...createExplorationService(persistence),
    ...createServiceService(persistence),
    ...createEducationService(persistence),
    ...createTestimonialService(persistence),
    async getPerson() {
      const record = await persistence.findPerson();
      if (!record) throw missing();
      return toPerson(record);
    },
    async createPerson(input) {
      const result = await persistence.createPerson(input);
      if (!result.ok) throw new DomainError("conflict", "The person already exists.");
      return toPerson(result.person);
    },
    async updatePerson(changes) {
      const record = await persistence.updatePerson(definedChanges<PersonFields>(changes));
      if (!record) throw missing();
      return toPerson(record);
    },
    async deletePerson() {
      if (!(await persistence.deletePerson())) throw missing();
    },
  };
}
