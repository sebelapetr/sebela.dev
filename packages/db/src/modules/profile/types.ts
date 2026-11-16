// The catalog types, private to the profile module and re-exported by its index.

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

export type DeleteTechnologyResult =
  { ok: true } | { ok: false; reason: "not_found" | "referenced" };

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
  /**
   * Deletes the technology; `not_found` when there is none, `referenced` (and nothing deleted)
   * while an experience or another record still links to it.
   */
  deleteTechnology(slug: string): Promise<DeleteTechnologyResult>;
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

/** Writable fields of an organization. The slug is fixed when it is created. */
export interface OrganizationFields {
  name: string;
  /** An absolute `http`/`https` address, or `null`. */
  website: string | null;
  /** Markdown, or `null`. */
  description: string | null;
}

export interface OrganizationRecord extends OrganizationFields {
  id: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
}

export type CreateOrganizationResult =
  { ok: true; organization: OrganizationRecord } | { ok: false; reason: "conflict" };

export type DeleteOrganizationResult =
  { ok: true } | { ok: false; reason: "not_found" | "referenced" };

/** Persistence operations of the organizations, addressed by slug. */
export interface OrganizationPersistence {
  /** Every organization, ordered by name ignoring case, then by slug. */
  listOrganizations(): Promise<OrganizationRecord[]>;
  /** The organization with the slug, or `null`. */
  findOrganization(slug: string): Promise<OrganizationRecord | null>;
  /** `conflict` when the slug is taken, also for a racing create. */
  createOrganization(
    fields: OrganizationFields & { slug: string },
  ): Promise<CreateOrganizationResult>;
  /** Changes only the given fields; `null` when there is no such organization. */
  updateOrganization(
    slug: string,
    changes: Partial<OrganizationFields>,
  ): Promise<OrganizationRecord | null>;
  /**
   * Deletes the organization; `not_found` when there is none, `referenced` (and nothing deleted)
   * while another record still refers to it through a foreign key.
   */
  deleteOrganization(slug: string): Promise<DeleteOrganizationResult>;
}

export type ExperienceKind = "main_job" | "side_project" | "own_business";

/** Writable scalar fields of an experience. The slug is fixed when it is created. */
export interface ExperienceFields {
  title: string;
  kind: ExperienceKind;
  /** Calendar date, `YYYY-MM-DD`. */
  startedOn: string;
  /** Calendar date, `YYYY-MM-DD`, not before the start; `null` marks a current role. */
  endedOn: string | null;
  /** Markdown. */
  summary: string;
  responsibilities: string[];
  inCv: boolean;
}

/** Relations of an experience as written: slugs of existing records. */
export interface ExperienceRelations {
  /** The slug of the organization. */
  organization: string;
  /** Slugs of the technologies, each once, in their intended order. */
  technologies: string[];
}

/**
 * An experience with its organization, technologies (in link order) and projects (by position,
 * then slug) resolved.
 */
export interface ExperienceRecord extends ExperienceFields {
  id: string;
  slug: string;
  organization: OrganizationRecord;
  technologies: TechnologyRecord[];
  projects: ProjectRecord[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Why a create or an update wrote nothing, besides `conflict` and `not_found`:
 *
 * - `unknown_organization`: no organization has the given slug.
 * - `unknown_technologies`: some technology slugs exist nowhere; `slugs` lists them.
 * - `repeated_technologies`: a technology slug is given more than once.
 * - `invalid_period`: the end would be before the start.
 */
export type ExperienceWriteFailure =
  | { ok: false; reason: "unknown_organization" }
  | { ok: false; reason: "unknown_technologies"; slugs: string[] }
  | { ok: false; reason: "repeated_technologies" }
  | { ok: false; reason: "invalid_period" };

export type CreateExperienceResult =
  | { ok: true; experience: ExperienceRecord }
  | { ok: false; reason: "conflict" }
  | ExperienceWriteFailure;

export type UpdateExperienceResult =
  | { ok: true; experience: ExperienceRecord }
  | { ok: false; reason: "not_found" }
  | ExperienceWriteFailure;

export type DeleteExperienceResult =
  { ok: true } | { ok: false; reason: "not_found" | "referenced" };

/**
 * Persistence operations of the experiences, addressed by slug. Each write of an experience and
 * its technology links is one transaction: it is stored completely or not at all.
 */
export interface ExperiencePersistence {
  /** Every experience: current roles first, then latest start, latest end and slug. */
  listExperiences(): Promise<ExperienceRecord[]>;
  /** The experience with the slug, or `null`. */
  findExperience(slug: string): Promise<ExperienceRecord | null>;
  /** `conflict` when the slug is taken, also for a racing create; see `ExperienceWriteFailure`. */
  createExperience(
    fields: ExperienceFields & ExperienceRelations & { slug: string },
  ): Promise<CreateExperienceResult>;
  /**
   * Changes only the given fields. Given `technologies` replace every link; omitted ones keep
   * them. `not_found` when there is no such experience; see `ExperienceWriteFailure`.
   */
  updateExperience(
    slug: string,
    changes: Partial<ExperienceFields & ExperienceRelations>,
  ): Promise<UpdateExperienceResult>;
  /**
   * Deletes the experience and its technology links; `not_found` when there is none,
   * `referenced` (and nothing deleted) while a project or another record still refers to it.
   */
  deleteExperience(slug: string): Promise<DeleteExperienceResult>;
}

export interface ProjectLinkRecord {
  label: string;
  /** An absolute `http`/`https` address. */
  url: string;
}

/** Writable scalar fields of a project. The slug is fixed when it is created. */
export interface ProjectFields {
  name: string;
  /** Markdown. */
  summary: string;
  /** Markdown. */
  problem: string;
  /** Markdown. */
  workDone: string;
  /** Markdown. */
  result: string;
  /** Calendar date, `YYYY-MM-DD`. */
  startedOn: string;
  /** Calendar date, `YYYY-MM-DD`, not before the start; `null` marks an ongoing project. */
  endedOn: string | null;
  links: ProjectLinkRecord[];
  selectedForHomepage: boolean;
  /** Ascending order within the owning experience; ties are ordered by slug. */
  position: number;
}

/** Relations of a project as written: slugs of existing records. */
export interface ProjectRelations {
  /** The slug of the experience that owns the project. */
  experience: string;
  /** Slugs of the technologies, each once, in their intended order. */
  technologies: string[];
}

/** A project with its owning experience (by slug) and its technologies (in link order). */
export interface ProjectRecord extends ProjectFields {
  id: string;
  slug: string;
  /** The slug of the owning experience. */
  experience: string;
  technologies: TechnologyRecord[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Why a create or an update of a project wrote nothing, besides `conflict` and `not_found`:
 *
 * - `unknown_experience`: no experience has the given slug.
 * - `unknown_technologies`: some technology slugs exist nowhere; `slugs` lists them.
 * - `repeated_technologies`: a technology slug is given more than once.
 * - `invalid_period`: the end would be before the start.
 */
export type ProjectWriteFailure =
  | { ok: false; reason: "unknown_experience" }
  | { ok: false; reason: "unknown_technologies"; slugs: string[] }
  | { ok: false; reason: "repeated_technologies" }
  | { ok: false; reason: "invalid_period" };

export type CreateProjectResult =
  { ok: true; project: ProjectRecord } | { ok: false; reason: "conflict" } | ProjectWriteFailure;

export type UpdateProjectResult =
  { ok: true; project: ProjectRecord } | { ok: false; reason: "not_found" } | ProjectWriteFailure;

export type DeleteProjectResult = { ok: true } | { ok: false; reason: "not_found" | "referenced" };

/**
 * Persistence operations of the projects, addressed by slug. Every project belongs to exactly one
 * experience. Each write of a project and its technology links is one transaction: it is stored
 * completely or not at all.
 */
export interface ProjectPersistence {
  /** Every project, grouped by experience in the experience order, then by position and slug. */
  listProjects(): Promise<ProjectRecord[]>;
  /** The project with the slug, or `null`. */
  findProject(slug: string): Promise<ProjectRecord | null>;
  /** `conflict` when the slug is taken, also for a racing create; see `ProjectWriteFailure`. */
  createProject(
    fields: ProjectFields & ProjectRelations & { slug: string },
  ): Promise<CreateProjectResult>;
  /**
   * Changes only the given fields. A given `experience` moves the project to that experience;
   * given `technologies` replace every link and omitted ones keep them. `not_found` when there is
   * no such project; see `ProjectWriteFailure`.
   */
  updateProject(
    slug: string,
    changes: Partial<ProjectFields & ProjectRelations>,
  ): Promise<UpdateProjectResult>;
  /**
   * Deletes the project and its technology links, never its experience or technologies;
   * `not_found` when there is none, `referenced` (and nothing deleted) while another record still
   * refers to it.
   */
  deleteProject(slug: string): Promise<DeleteProjectResult>;
}
