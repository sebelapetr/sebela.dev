// The catalog, organization, experience, project, case-study and exploration service interfaces,
// private to the profile module and re-exported by its index.
import type {
  CaseStudy,
  CaseStudyCreate,
  CaseStudyUpdate,
  Experience,
  ExperienceCreate,
  ExperienceUpdate,
  Exploration,
  ExplorationCreate,
  ExplorationUpdate,
  Organization,
  OrganizationCreate,
  OrganizationUpdate,
  Project,
  ProjectCreate,
  ProjectUpdate,
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
 * Operations on the experiences, addressed by slug, with their organization, technologies and
 * projects (by position, then slug) resolved. Results are in the contract shape; expected failures are `DomainError`s:
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
 *   unknown slug; `conflict` (and nothing deleted) while it owns a project or another record
 *   still refers to it.
 */
export interface ExperienceService {
  listExperiences(): Promise<Experience[]>;
  getExperience(slug: string): Promise<Experience>;
  createExperience(input: ExperienceCreate): Promise<Experience>;
  updateExperience(slug: string, changes: ExperienceUpdate): Promise<Experience>;
  deleteExperience(slug: string): Promise<void>;
}

/**
 * Operations on the projects, addressed by slug. Every project belongs to exactly one experience,
 * named by its slug; its technologies are resolved. Results are in the contract shape; expected
 * failures are `DomainError`s:
 *
 * - `listProjects`: every project, grouped by owning experience in the experience order, then by
 *   position, then by slug.
 * - `getProject`: the project, or `not_found`.
 * - `createProject`: stores the project and its technology links together; `conflict` when the
 *   slug is taken, also when creates race.
 * - `updateProject`: changes only the given fields, keeps `id`, `slug` and `createdAt` and advances
 *   `updatedAt`. A given `experience` moves the project to that experience; a given `technologies`
 *   list replaces every link in its order and an omitted one keeps them. `not_found` for an
 *   unknown slug.
 * - Create and update refuse, as `validation_failed` naming the field and writing nothing, an
 *   unknown `experience`, unknown or repeated `technologies` and an `endedOn` before the (stored
 *   or given) start.
 * - Every project carries its case study, or `null` without one; it is written only through
 *   `CaseStudyService`.
 * - `deleteProject`: removes the project and its technology links, never its experience or
 *   technologies; `not_found` for an unknown slug; `conflict` (and nothing deleted) while it has a
 *   case study or another record still refers to it.
 */
export interface ProjectService {
  listProjects(): Promise<Project[]>;
  getProject(slug: string): Promise<Project>;
  createProject(input: ProjectCreate): Promise<Project>;
  updateProject(slug: string, changes: ProjectUpdate): Promise<Project>;
  deleteProject(slug: string): Promise<void>;
}

/**
 * Operations on the case studies, at most one per project and addressed by the project's slug.
 * Results are in the contract shape; expected failures are `DomainError`s:
 *
 * - `getCaseStudy`: the case study of the project, or `not_found` for an unknown project or a
 *   project without one.
 * - `createCaseStudy`: stores the case study of the project; `not_found` for an unknown project;
 *   `conflict` when the project has one, also when creates race.
 * - `updateCaseStudy`: changes only the given fields, keeps `id` and `createdAt` and advances
 *   `updatedAt`; `not_found` for an unknown project or a project without one.
 * - `deleteCaseStudy`: removes the case study and leaves its project; `not_found` for an unknown
 *   project or a project without one.
 *
 * A project that has a case study cannot be deleted (`ProjectService.deleteProject` answers
 * `conflict`); the case study goes first.
 */
export interface CaseStudyService {
  getCaseStudy(project: string): Promise<CaseStudy>;
  createCaseStudy(project: string, input: CaseStudyCreate): Promise<CaseStudy>;
  updateCaseStudy(project: string, changes: CaseStudyUpdate): Promise<CaseStudy>;
  deleteCaseStudy(project: string): Promise<void>;
}

/**
 * Operations on the explorations, addressed by slug, with their technologies and topics resolved.
 * An exploration is independent work outside the career timeline: it refers to no experience and
 * no project. Results are in the contract shape, the status exactly as stored; expected failures
 * are `DomainError`s:
 *
 * - `listExplorations`: every exploration, ordered by position, then slug.
 * - `getExploration`: the exploration, or `not_found`.
 * - `createExploration`: stores the exploration and its technology and topic links together;
 *   `conflict` when the slug is taken, also when creates race.
 * - `updateExploration`: changes only the given fields, keeps `id`, `slug` and `createdAt` and
 *   advances `updatedAt`. A given `technologies` or `topics` list replaces every link of that kind
 *   in its order; an omitted one keeps them. `not_found` for an unknown slug.
 * - Create and update refuse, as `validation_failed` naming the field and writing nothing, unknown
 *   or repeated `technologies` or `topics` and an `endedOn` before the (stored or given) start.
 * - `deleteExploration`: removes the exploration and its links, never the technologies or topics;
 *   `not_found` for an unknown slug.
 */
export interface ExplorationService {
  listExplorations(): Promise<Exploration[]>;
  getExploration(slug: string): Promise<Exploration>;
  createExploration(input: ExplorationCreate): Promise<Exploration>;
  updateExploration(slug: string, changes: ExplorationUpdate): Promise<Exploration>;
  deleteExploration(slug: string): Promise<void>;
}
