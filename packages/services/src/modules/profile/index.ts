import type { Person, PersonCreate, PersonUpdate } from "@sebela/contracts";
import type { PersonFields, ProfilePersistence } from "@sebela/db";

import { DomainError } from "../../errors.js";
import { createCaseStudyService } from "./case-studies.js";
import { createCatalogService } from "./catalogs.js";
import { createCurrentFocusService } from "./current-focus.js";
import { definedChanges } from "./changes.js";
import { createCvService, type MediaAddress } from "./cv.js";
import { createEducationService } from "./education.js";
import { createExperienceService } from "./experiences.js";
import { createExplorationService } from "./explorations.js";
import { isMediaRefusal, mediaRefused } from "./media-references.js";
import { createOrganizationService } from "./organizations.js";
import { toPerson } from "./person.js";
import { createProjectService } from "./projects.js";
import { createServiceService } from "./services.js";
import { createTestimonialService } from "./testimonials.js";
import type {
  CaseStudyService,
  CatalogService,
  CurrentFocusService,
  CvService,
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
  CurrentFocusService,
  CvService,
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
 * - Create and update refuse, as `validation_failed` naming the field and writing nothing, a
 *   `photoId` that names no media or a PDF and a `cvPdfId` that names no media or an image; `null`
 *   clears either.
 * - `deletePerson`: removes the person; `not_found` while there is none.
 *
 * It also includes the catalog operations of `CatalogService`, the organization operations of
 * `OrganizationService`, the experience operations of `ExperienceService`, the project
 * operations of `ProjectService`, the case-study operations of `CaseStudyService`, the
 * exploration operations of `ExplorationService`, the service operations of `ServiceService`, the
 * education operations of `EducationService`, the testimonial operations of
 * `TestimonialService`, the current-focus operations of `CurrentFocusService` and the assembled
 * CV of `CvService`.
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
    TestimonialService,
    CurrentFocusService,
    CvService {
  getPerson(): Promise<Person>;
  createPerson(input: PersonCreate): Promise<Person>;
  updatePerson(changes: PersonUpdate): Promise<Person>;
  deletePerson(): Promise<void>;
}

const missing = () => new DomainError("not_found", "There is no person yet.");

export interface ProfileServiceOptions {
  /**
   * The public address of a media key, used for the CV PDF in the assembled CV. Without it no key
   * can be addressed and the PDF's `url` is `null`, as for a key the storage cannot address.
   */
  readonly mediaAddress?: MediaAddress;
}

export function createProfileService(
  persistence: ProfilePersistence,
  options: ProfileServiceOptions = {},
): ProfileService {
  return {
    ...createCvService(persistence, options.mediaAddress ?? (() => null)),
    ...createCatalogService(persistence),
    ...createOrganizationService(persistence),
    ...createExperienceService(persistence),
    ...createProjectService(persistence),
    ...createCaseStudyService(persistence),
    ...createExplorationService(persistence),
    ...createServiceService(persistence),
    ...createEducationService(persistence),
    ...createTestimonialService(persistence),
    ...createCurrentFocusService(persistence),
    async getPerson() {
      const record = await persistence.findPerson();
      if (!record) throw missing();
      return toPerson(record);
    },
    async createPerson(input) {
      const result = await persistence.createPerson(input);
      if (!result.ok) {
        if (isMediaRefusal(result)) throw mediaRefused(result);
        throw new DomainError("conflict", "The person already exists.");
      }
      return toPerson(result.person);
    },
    async updatePerson(changes) {
      const result = await persistence.updatePerson(definedChanges<PersonFields>(changes));
      if (!result.ok) throw isMediaRefusal(result) ? mediaRefused(result) : missing();
      return toPerson(result.person);
    },
    async deletePerson() {
      if (!(await persistence.deletePerson())) throw missing();
    },
  };
}
