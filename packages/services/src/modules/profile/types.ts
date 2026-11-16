// The catalog, organization and experience service interfaces, private to the profile module and re-exported
// by its index.
import type {
  Experience,
  ExperienceCreate,
  ExperienceUpdate,
  Organization,
  OrganizationCreate,
  OrganizationUpdate,
  Technology,
  TechnologyCreate,
  TechnologyUpdate,
  Topic,
  TopicCreate,
  TopicUpdate,
} from "@sebela/contracts";

/**
 * Operations on the ordered technology and topic catalogs, addressed by slug. Results are in the
 * contract shape; expected failures are `DomainError`s:
 *
 * - `listTechnologies`/`listTopics`: every record in catalog order, possibly none.
 * - `get…`: the record, or `not_found`.
 * - `create…`: `conflict` when the slug is taken, also when creates race; a technology whose group
 *   disagrees with its tier is `validation_failed`.
 * - `update…`: changes only the given fields, keeps `id`, `slug` and `createdAt` and advances
 *   `updatedAt`; `not_found` for an unknown slug; a technology change that leaves group and tier
 *   disagreeing (for example only `tier: "secondary"` on a `core` technology) is
 *   `validation_failed`.
 * - `delete…`: removes the record; `not_found` for an unknown slug; deleting a technology that an
 *   experience links to is `conflict`, and nothing is deleted.
 */
export interface CatalogService {
  listTechnologies(): Promise<Technology[]>;
  getTechnology(slug: string): Promise<Technology>;
  createTechnology(input: TechnologyCreate): Promise<Technology>;
  updateTechnology(slug: string, changes: TechnologyUpdate): Promise<Technology>;
  deleteTechnology(slug: string): Promise<void>;
  listTopics(): Promise<Topic[]>;
  getTopic(slug: string): Promise<Topic>;
  createTopic(input: TopicCreate): Promise<Topic>;
  updateTopic(slug: string, changes: TopicUpdate): Promise<Topic>;
  deleteTopic(slug: string): Promise<void>;
}

/**
 * Operations on the organizations, addressed by slug. Results are in the contract shape; expected
 * failures are `DomainError`s:
 *
 * - `listOrganizations`: every organization, ordered by name ignoring case, then by slug.
 * - `getOrganization`: the organization, or `not_found`.
 * - `createOrganization`: `conflict` when the slug is taken, also when creates race.
 * - `updateOrganization`: changes only the given fields, keeps `id`, `slug` and `createdAt` and
 *   advances `updatedAt`; `not_found` for an unknown slug.
 * - `deleteOrganization`: removes the organization; `not_found` for an unknown slug; `conflict`
 *   (and nothing deleted) while another record, such as an experience, still refers to it.
 */
export interface OrganizationService {
  listOrganizations(): Promise<Organization[]>;
  getOrganization(slug: string): Promise<Organization>;
  createOrganization(input: OrganizationCreate): Promise<Organization>;
  updateOrganization(slug: string, changes: OrganizationUpdate): Promise<Organization>;
  deleteOrganization(slug: string): Promise<void>;
}

/**
 * Operations on the experiences, addressed by slug, with their organization and technologies
 * resolved. Results are in the contract shape; expected failures are `DomainError`s:
 *
 * - `listExperiences`: every experience, current roles (no end) first, then by start, latest
 *   first, then by end, latest first, then by slug.
 * - `getExperience`: the experience, or `not_found`.
 * - `createExperience`: stores the experience and its technology links together; `conflict` when
 *   the slug is taken, also when creates race.
 * - `updateExperience`: changes only the given fields, keeps `id`, `slug` and `createdAt` and
 *   advances `updatedAt`. A given `technologies` list replaces every link in its order; an omitted
 *   one keeps them. `not_found` for an unknown slug.
 * - Create and update refuse, as `validation_failed` naming the field and writing nothing, an
 *   unknown `organization`, unknown or repeated `technologies` and an `endedOn` before the
 *   (stored or given) start.
 * - `deleteExperience`: removes the experience and its technology links; `not_found` for an
 *   unknown slug; `conflict` (and nothing deleted) while another record still refers to it.
 */
export interface ExperienceService {
  listExperiences(): Promise<Experience[]>;
  getExperience(slug: string): Promise<Experience>;
  createExperience(input: ExperienceCreate): Promise<Experience>;
  updateExperience(slug: string, changes: ExperienceUpdate): Promise<Experience>;
  deleteExperience(slug: string): Promise<void>;
}
