// The catalog and organization service interfaces, private to the profile module and re-exported
// by its index.
import type {
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
 * - `delete…`: removes the record; `not_found` for an unknown slug.
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
