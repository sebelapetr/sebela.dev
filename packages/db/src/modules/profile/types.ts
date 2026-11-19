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

export type DeleteTopicResult = { ok: true } | { ok: false; reason: "not_found" | "referenced" };

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
   * while an experience, a project, an exploration or another record still links to it.
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
  /**
   * Deletes the topic; `not_found` when there is none, `referenced` (and nothing deleted) while
   * an exploration, a current-focus entry, a roadmap resource, an event or a project idea still
   * links to it.
   */
  deleteTopic(slug: string): Promise<DeleteTopicResult>;
}

/** Writable fields of an organization. The slug is fixed when it is created. */
export interface OrganizationFields {
  name: string;
  /** An absolute `http`/`https` address, or `null`. */
  website: string | null;
  /** Markdown, or `null`. */
  description: string | null;
}

/** Media attached to an organization, by media id; `null` while none is attached. */
export interface OrganizationMedia {
  /** An image. */
  logoId: string | null;
}

export interface OrganizationRecord extends OrganizationFields, OrganizationMedia {
  id: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
}

export type CreateOrganizationResult =
  | { ok: true; organization: OrganizationRecord }
  | { ok: false; reason: "conflict" }
  | MediaReferenceFailure;

export type UpdateOrganizationResult =
  | { ok: true; organization: OrganizationRecord }
  | { ok: false; reason: "not_found" }
  | MediaReferenceFailure;

export type DeleteOrganizationResult =
  { ok: true } | { ok: false; reason: "not_found" | "referenced" };

/** Persistence operations of the organizations, addressed by slug. */
export interface OrganizationPersistence {
  /** Every organization, ordered by name ignoring case, then by slug. */
  listOrganizations(): Promise<OrganizationRecord[]>;
  /** The organization with the slug, or `null`. */
  findOrganization(slug: string): Promise<OrganizationRecord | null>;
  /**
   * `conflict` when the slug is taken, also for a racing create; see `MediaReferenceFailure`. An
   * omitted logo is `null`.
   */
  createOrganization(
    fields: OrganizationFields & Partial<OrganizationMedia> & { slug: string },
  ): Promise<CreateOrganizationResult>;
  /** Changes only the given fields; `not_found` when there is no such organization. */
  updateOrganization(
    slug: string,
    changes: Partial<OrganizationFields & OrganizationMedia>,
  ): Promise<UpdateOrganizationResult>;
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
 * An experience with its organization, technologies (in link order), and projects and
 * testimonials (each by position, then slug) resolved.
 */
export interface ExperienceRecord extends ExperienceFields {
  id: string;
  slug: string;
  organization: OrganizationRecord;
  technologies: TechnologyRecord[];
  projects: ProjectRecord[];
  testimonials: TestimonialRecord[];
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
   * `referenced` (and nothing deleted) while a project, a testimonial or another record still
   * refers to it.
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

/** Media attached to a project, by media id; `null` while none is attached. */
export interface ProjectMedia {
  /** An image. */
  coverId: string | null;
}

/** A project with its owning experience (by slug) and its technologies (in link order). */
export interface ProjectRecord extends ProjectFields, ProjectMedia {
  id: string;
  slug: string;
  /** The slug of the owning experience. */
  experience: string;
  technologies: TechnologyRecord[];
  /** The case study of the project, or `null` while it has none. */
  caseStudy: CaseStudyRecord | null;
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
 * - `unknown_media`, `unsuitable_media`: see `MediaReferenceFailure`.
 */
export type ProjectWriteFailure =
  | MediaReferenceFailure
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
    fields: ProjectFields & Partial<ProjectMedia> & ProjectRelations & { slug: string },
  ): Promise<CreateProjectResult>;
  /**
   * Changes only the given fields. A given `experience` moves the project to that experience;
   * given `technologies` replace every link and omitted ones keep them. `not_found` when there is
   * no such project; see `ProjectWriteFailure`.
   */
  updateProject(
    slug: string,
    changes: Partial<ProjectFields & ProjectMedia & ProjectRelations>,
  ): Promise<UpdateProjectResult>;
  /**
   * Deletes the project and its technology links, never its experience or technologies;
   * `not_found` when there is none, `referenced` (and nothing deleted) while a case study, a
   * service naming it as evidence or a current-focus entry still refers to it.
   */
  deleteProject(slug: string): Promise<DeleteProjectResult>;
}

/** Writable fields of a case study. Its project is fixed when it is created. */
export interface CaseStudyFields {
  /** The person's own role in the project, plain text. */
  role: string;
  /** Markdown, stored as written. */
  body: string;
}

/** The case study of a project, which names its project by slug. */
export interface CaseStudyRecord extends CaseStudyFields {
  id: string;
  /** The slug of the project the case study explains. */
  project: string;
  createdAt: Date;
  updatedAt: Date;
}

export type CreateCaseStudyResult =
  { ok: true; caseStudy: CaseStudyRecord } | { ok: false; reason: "unknown_project" | "conflict" };

export type UpdateCaseStudyResult =
  { ok: true; caseStudy: CaseStudyRecord } | { ok: false; reason: "not_found" };

export type DeleteCaseStudyResult = { ok: true } | { ok: false; reason: "not_found" };

/**
 * Persistence operations of the case studies, addressed by the slug of their project. A project
 * has at most one case study; a project with one cannot be deleted.
 */
export interface CaseStudyPersistence {
  /** The case study of the project, or `null` when the project has none or does not exist. */
  findCaseStudy(project: string): Promise<CaseStudyRecord | null>;
  /**
   * Creates the case study of the project; `unknown_project` when no project has the slug,
   * `conflict` when it already has one, also for a racing create.
   */
  createCaseStudy(project: string, fields: CaseStudyFields): Promise<CreateCaseStudyResult>;
  /** Changes only the given fields; `not_found` when the project or its case study is missing. */
  updateCaseStudy(
    project: string,
    changes: Partial<CaseStudyFields>,
  ): Promise<UpdateCaseStudyResult>;
  /** Deletes only the case study, never its project; `not_found` when there is none. */
  deleteCaseStudy(project: string): Promise<DeleteCaseStudyResult>;
}

/** How far an exploration got, from the strongest claim to the weakest. */
export type ExplorationStatus = "built" | "tested" | "designed";

/** Writable scalar fields of an exploration. The slug is fixed when it is created. */
export interface ExplorationFields {
  name: string;
  /** Markdown. */
  summary: string;
  /** Stored and returned exactly as written. */
  status: ExplorationStatus;
  /** Plain-text concepts in their intended order. */
  concepts: string[];
  /** Calendar date, `YYYY-MM-DD`. */
  startedOn: string;
  /** Calendar date, `YYYY-MM-DD`, not before the start; `null` marks an ongoing exploration. */
  endedOn: string | null;
  /** Ascending order of the explorations; ties are ordered by slug. */
  position: number;
}

/** Relations of an exploration as written: slugs of existing catalog records. */
export interface ExplorationRelations {
  /** Slugs of the technologies, each once, in their intended order. */
  technologies: string[];
  /** Slugs of the topics, each once, in their intended order. */
  topics: string[];
}

/**
 * An exploration with its technologies and topics resolved in link order. It refers to no
 * experience and no project.
 */
export interface ExplorationRecord extends ExplorationFields {
  id: string;
  slug: string;
  technologies: TechnologyRecord[];
  topics: TopicRecord[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Why a create or an update of an exploration wrote nothing, besides `conflict` and `not_found`:
 *
 * - `unknown_technologies` / `unknown_topics`: some slugs exist nowhere; `slugs` lists them.
 * - `repeated_technologies` / `repeated_topics`: a slug is given more than once.
 * - `invalid_period`: the end would be before the start.
 */
export type ExplorationWriteFailure =
  | { ok: false; reason: "unknown_technologies"; slugs: string[] }
  | { ok: false; reason: "repeated_technologies" }
  | { ok: false; reason: "unknown_topics"; slugs: string[] }
  | { ok: false; reason: "repeated_topics" }
  | { ok: false; reason: "invalid_period" };

export type CreateExplorationResult =
  | { ok: true; exploration: ExplorationRecord }
  | { ok: false; reason: "conflict" }
  | ExplorationWriteFailure;

export type UpdateExplorationResult =
  | { ok: true; exploration: ExplorationRecord }
  | { ok: false; reason: "not_found" }
  | ExplorationWriteFailure;

export type DeleteExplorationResult =
  { ok: true } | { ok: false; reason: "not_found" | "referenced" };

/**
 * Persistence operations of the explorations, addressed by slug. Each write of an exploration and
 * its technology and topic links is one transaction: it is stored completely or not at all.
 */
export interface ExplorationPersistence {
  /** Every exploration, ordered by position, then slug. */
  listExplorations(): Promise<ExplorationRecord[]>;
  /** The exploration with the slug, or `null`. */
  findExploration(slug: string): Promise<ExplorationRecord | null>;
  /** `conflict` when the slug is taken, also for a racing create; see `ExplorationWriteFailure`. */
  createExploration(
    fields: ExplorationFields & ExplorationRelations & { slug: string },
  ): Promise<CreateExplorationResult>;
  /**
   * Changes only the given fields. Given `technologies` or `topics` replace every link of that
   * kind; omitted ones keep them. `not_found` when there is no such exploration; see
   * `ExplorationWriteFailure`.
   */
  updateExploration(
    slug: string,
    changes: Partial<ExplorationFields & ExplorationRelations>,
  ): Promise<UpdateExplorationResult>;
  /**
   * Deletes the exploration and its links, never the technologies or topics; `not_found` when
   * there is none, `referenced` (and nothing deleted) while a service names it as evidence.
   */
  deleteExploration(slug: string): Promise<DeleteExplorationResult>;
}

/** Writable scalar fields of a service. The slug is fixed when it is created. */
export interface ServiceFields {
  name: string;
  /** Markdown. */
  summary: string;
  /** Who the service is for. Markdown. */
  audience: string;
  /** What the client gets. Markdown. */
  deliverable: string;
  /** Ascending order of the services; ties are ordered by slug. */
  position: number;
}

/**
 * One piece of evidence as written: an existing project or exploration by slug, or a link to a
 * path within the site. The path is validated by the caller.
 */
export type ServiceEvidence =
  | { kind: "project"; project: string }
  | { kind: "exploration"; exploration: string }
  | { kind: "link"; label: string; path: string };

/** One piece of evidence as read: the project or exploration resolved, or the site link. */
export type ServiceEvidenceRecord =
  | {
      kind: "project";
      project: { slug: string; name: string; summary: string; experience: string };
    }
  | {
      kind: "exploration";
      exploration: { slug: string; name: string; summary: string; status: ExplorationStatus };
    }
  | { kind: "link"; label: string; path: string };

/** A service with its evidence resolved in its stored order. */
export interface ServiceRecord extends ServiceFields {
  id: string;
  slug: string;
  evidence: ServiceEvidenceRecord[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Why a create or an update of a service wrote nothing, besides `conflict` and `not_found`:
 *
 * - `unknown_projects` / `unknown_explorations`: some slugs exist nowhere; `slugs` lists them.
 * - `repeated_projects` / `repeated_explorations`: a slug is given more than once.
 */
export type ServiceWriteFailure =
  | { ok: false; reason: "unknown_projects"; slugs: string[] }
  | { ok: false; reason: "repeated_projects" }
  | { ok: false; reason: "unknown_explorations"; slugs: string[] }
  | { ok: false; reason: "repeated_explorations" };

export type CreateServiceResult =
  { ok: true; service: ServiceRecord } | { ok: false; reason: "conflict" } | ServiceWriteFailure;

export type UpdateServiceResult =
  { ok: true; service: ServiceRecord } | { ok: false; reason: "not_found" } | ServiceWriteFailure;

export type DeleteServiceResult = { ok: true } | { ok: false; reason: "not_found" };

/**
 * Persistence operations of the services, addressed by slug. Each write of a service and its
 * evidence is one transaction: it is stored completely or not at all.
 */
export interface ServicePersistence {
  /** Every service, ordered by position, then slug. */
  listServices(): Promise<ServiceRecord[]>;
  /** The service with the slug, or `null`. */
  findService(slug: string): Promise<ServiceRecord | null>;
  /** `conflict` when the slug is taken, also for a racing create; see `ServiceWriteFailure`. */
  createService(
    fields: ServiceFields & { slug: string; evidence: ServiceEvidence[] },
  ): Promise<CreateServiceResult>;
  /**
   * Changes only the given fields. A given `evidence` list replaces all evidence; an omitted one
   * keeps it. `not_found` when there is no such service; see `ServiceWriteFailure`.
   */
  updateService(
    slug: string,
    changes: Partial<ServiceFields & { evidence: ServiceEvidence[] }>,
  ): Promise<UpdateServiceResult>;
  /**
   * Deletes the service and its evidence, never the projects or explorations it names;
   * `not_found` when there is none.
   */
  deleteService(slug: string): Promise<DeleteServiceResult>;
}

/** What kind of learning an education record is. */
export type EducationKind = "school" | "course" | "certification" | "milestone";

/**
 * Writable fields of an education record. The slug is fixed when it is created. The period is
 * flexible: at least one date is set, a start alone marks ongoing learning and an end alone a
 * completion on that day.
 */
export interface EducationFields {
  /** Stored and returned exactly as written. */
  kind: EducationKind;
  title: string;
  /** The school, provider or issuer, or `null`. */
  institution: string | null;
  /** Calendar date, `YYYY-MM-DD`, or `null` when only the end is known. */
  startedOn: string | null;
  /** Calendar date, `YYYY-MM-DD`, not before the start; `null` marks ongoing learning. */
  endedOn: string | null;
  /** Markdown, or `null`. */
  description: string | null;
  /** Ascending order of the education records; ties are ordered by slug. */
  position: number;
}

/** An education record. It refers to no other record and none refers to it. */
export interface EducationRecord extends EducationFields {
  id: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Why a create or an update of an education record wrote nothing, besides `conflict` and
 * `not_found`:
 *
 * - `invalid_period`: the end would be before the start.
 * - `undated_period`: neither the start nor the end would be set.
 */
export type EducationWriteFailure =
  { ok: false; reason: "invalid_period" } | { ok: false; reason: "undated_period" };

export type CreateEducationResult =
  | { ok: true; education: EducationRecord }
  | { ok: false; reason: "conflict" }
  | EducationWriteFailure;

export type UpdateEducationResult =
  | { ok: true; education: EducationRecord }
  | { ok: false; reason: "not_found" }
  | EducationWriteFailure;

export type DeleteEducationResult = { ok: true } | { ok: false; reason: "not_found" };

/** Persistence operations of the education records, addressed by slug. */
export interface EducationPersistence {
  /** Every education record, ordered by position, then slug. */
  listEducation(): Promise<EducationRecord[]>;
  /** The education record with the slug, or `null`. */
  findEducation(slug: string): Promise<EducationRecord | null>;
  /** `conflict` when the slug is taken, also for a racing create; see `EducationWriteFailure`. */
  createEducation(fields: EducationFields & { slug: string }): Promise<CreateEducationResult>;
  /**
   * Changes only the given fields; the period is checked on the resulting record. `not_found`
   * when there is no such record; see `EducationWriteFailure`.
   */
  updateEducation(slug: string, changes: Partial<EducationFields>): Promise<UpdateEducationResult>;
  /** Deletes the education record; `not_found` when there is none. */
  deleteEducation(slug: string): Promise<DeleteEducationResult>;
}

/** Writable fields of a testimonial. The slug is fixed when it is created. */
export interface TestimonialFields {
  /** What the author said, plain text. */
  quote: string;
  authorName: string;
  /** The author's role; the organization comes from the experience. */
  authorRole: string;
  /** Ascending order within the experience; ties are ordered by slug. */
  position: number;
}

/** Relations of a testimonial as written: the slug of an existing experience. */
export interface TestimonialRelations {
  /** The slug of the experience the testimonial belongs to. */
  experience: string;
}

/** Media attached to a testimonial, by media id; `null` while none is attached. */
export interface TestimonialMedia {
  /** An image of the author. */
  authorPhotoId: string | null;
}

/** A testimonial with the experience it belongs to (by slug) and its author photo. */
export interface TestimonialRecord
  extends TestimonialFields, TestimonialMedia, TestimonialRelations {
  id: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Why a create or an update of a testimonial wrote nothing, besides `conflict` and `not_found`:
 *
 * - `unknown_experience`: no experience has the given slug.
 * - `unknown_media`, `unsuitable_media`: see `MediaReferenceFailure`.
 */
export type TestimonialWriteFailure =
  MediaReferenceFailure | { ok: false; reason: "unknown_experience" };

export type CreateTestimonialResult =
  | { ok: true; testimonial: TestimonialRecord }
  | { ok: false; reason: "conflict" }
  | TestimonialWriteFailure;

export type UpdateTestimonialResult =
  | { ok: true; testimonial: TestimonialRecord }
  | { ok: false; reason: "not_found" }
  | TestimonialWriteFailure;

export type DeleteTestimonialResult = { ok: true } | { ok: false; reason: "not_found" };

/**
 * Persistence operations of the testimonials, addressed by slug. Every testimonial belongs to
 * exactly one experience; an experience with a testimonial cannot be deleted.
 */
export interface TestimonialPersistence {
  /** Every testimonial, grouped by experience in the experience order, then by position and slug. */
  listTestimonials(): Promise<TestimonialRecord[]>;
  /** The testimonial with the slug, or `null`. */
  findTestimonial(slug: string): Promise<TestimonialRecord | null>;
  /** `conflict` when the slug is taken, also for a racing create; see `TestimonialWriteFailure`. */
  createTestimonial(
    fields: TestimonialFields & Partial<TestimonialMedia> & TestimonialRelations & { slug: string },
  ): Promise<CreateTestimonialResult>;
  /**
   * Changes only the given fields. A given `experience` moves the testimonial to that experience;
   * `authorPhotoId: null` clears the photo. `not_found` when there is no such testimonial; see
   * `TestimonialWriteFailure`.
   */
  updateTestimonial(
    slug: string,
    changes: Partial<TestimonialFields & TestimonialMedia & TestimonialRelations>,
  ): Promise<UpdateTestimonialResult>;
  /** Deletes the testimonial, never its experience; `not_found` when there is none. */
  deleteTestimonial(slug: string): Promise<DeleteTestimonialResult>;
}

/** Writable scalar fields of a current-focus entry. The slug is fixed when it is created. */
export interface CurrentFocusFields {
  title: string;
  /** Markdown. */
  description: string;
  /** An absolute `http` or `https` address with more about the focus, or `null`. */
  link: string | null;
  /** Ascending order of the entries; ties are ordered by slug. */
  position: number;
}

/** Relations of a current-focus entry as written: slugs of existing records. */
export interface CurrentFocusRelations {
  /** The slug of the project the focus is about, or `null` for none. */
  project: string | null;
  /** Slugs of the topics, each once, in their intended order. */
  topics: string[];
}

/** The project a current-focus entry is about, with what a page needs to link to it. */
export interface CurrentFocusProjectRecord {
  slug: string;
  name: string;
  /** The slug of the experience the project belongs to. */
  experience: string;
}

/** A current-focus entry with its optional project and its topics resolved in link order. */
export interface CurrentFocusRecord extends CurrentFocusFields {
  id: string;
  slug: string;
  project: CurrentFocusProjectRecord | null;
  topics: TopicRecord[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Why a create or an update of a current-focus entry wrote nothing, besides `conflict` and
 * `not_found`:
 *
 * - `unknown_project`: no project has the given slug.
 * - `unknown_topics`: some topic slugs exist nowhere; `slugs` lists them.
 * - `repeated_topics`: a topic slug is given more than once.
 */
export type CurrentFocusWriteFailure =
  | { ok: false; reason: "unknown_project" }
  | { ok: false; reason: "unknown_topics"; slugs: string[] }
  | { ok: false; reason: "repeated_topics" };

export type CreateCurrentFocusResult =
  | { ok: true; focus: CurrentFocusRecord }
  | { ok: false; reason: "conflict" }
  | CurrentFocusWriteFailure;

export type UpdateCurrentFocusResult =
  | { ok: true; focus: CurrentFocusRecord }
  | { ok: false; reason: "not_found" }
  | CurrentFocusWriteFailure;

export type DeleteCurrentFocusResult = { ok: true } | { ok: false; reason: "not_found" };

/**
 * Persistence operations of the current focus, addressed by slug. Each write of an entry, its
 * project and its topic links is one transaction: it is stored completely or not at all. A project
 * or topic an entry links to cannot be deleted.
 */
export interface CurrentFocusPersistence {
  /** Every entry, ordered by position, then slug. */
  listCurrentFocus(): Promise<CurrentFocusRecord[]>;
  /** The entry with the slug, or `null`. */
  findCurrentFocus(slug: string): Promise<CurrentFocusRecord | null>;
  /** `conflict` when the slug is taken, also for a racing create; see `CurrentFocusWriteFailure`. */
  createCurrentFocus(
    fields: CurrentFocusFields & CurrentFocusRelations & { slug: string },
  ): Promise<CreateCurrentFocusResult>;
  /**
   * Changes only the given fields. A given `project` replaces the project and `null` removes it;
   * given `topics` replace every topic link. Omitted fields keep their value. `not_found` when
   * there is no such entry; see `CurrentFocusWriteFailure`.
   */
  updateCurrentFocus(
    slug: string,
    changes: Partial<CurrentFocusFields & CurrentFocusRelations>,
  ): Promise<UpdateCurrentFocusResult>;
  /** Deletes the entry and its topic links, never the project or topics; `not_found` when none. */
  deleteCurrentFocus(slug: string): Promise<DeleteCurrentFocusResult>;
}

/** The accepted media types; the database refuses any other. */
export type MediaType = "image/png" | "image/jpeg" | "image/webp" | "application/pdf";

/** Metadata of an uploaded file as it is stored. Width and height are set exactly for images. */
export interface MediaFields {
  /** The storage key; unique. Never a deployment-specific address. */
  key: string;
  mediaType: MediaType;
  /** Positive. */
  byteSize: number;
  /** Pixels; `null` exactly for a PDF. */
  width: number | null;
  /** Pixels; `null` exactly for a PDF. */
  height: number | null;
  altText: string | null;
  /**
   * The SHA-256 digest of the content as 64 lower-case hexadecimal digits; `null` or omitted for
   * media recorded without one. Not unique: the same file may be uploaded more than once.
   */
  sha256?: string | null;
}

export interface MediaRecord extends MediaFields {
  id: string;
  sha256: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type DeleteMediaResult =
  { ok: true; media: MediaRecord } | { ok: false; reason: "not_found" | "referenced" };

/**
 * Why a write that attaches media wrote nothing:
 *
 * - `unknown_media`: no media has the id given in `field`.
 * - `unsuitable_media`: the media in `field` is of the wrong kind, for example a PDF as a photo.
 */
export interface MediaReferenceFailure {
  ok: false;
  reason: "unknown_media" | "unsuitable_media";
  /** The written field, for example `photoId`. */
  field: string;
}

/**
 * Persistence operations of media metadata. The files themselves are not stored here. Person,
 * organization, project and testimonial rows refer to media through foreign keys without a
 * cascade, so referenced media is never deleted.
 */
export interface MediaPersistence {
  /** Every media record, newest first, then by id. */
  listMedia(): Promise<MediaRecord[]>;
  /** The media with the id, or `null`. */
  findMedia(id: string): Promise<MediaRecord | null>;
  /** The media stored under the key, or `null`. */
  findMediaByKey(key: string): Promise<MediaRecord | null>;
  /** The oldest media whose content has the SHA-256 digest, or `null`; `null` digests never match. */
  findMediaByDigest(sha256: string): Promise<MediaRecord | null>;
  /** Records media; throws when the key is taken or the database refuses the metadata. */
  createMedia(fields: MediaFields): Promise<MediaRecord>;
  /** Changes the alt text only; `null` when there is no such media. */
  updateMedia(id: string, changes: { altText: string | null }): Promise<MediaRecord | null>;
  /**
   * Deletes the record and returns it, so its file can be removed; `not_found` when there is none,
   * `referenced` (and nothing deleted) while a person, organization, project or testimonial refers
   * to it.
   */
  deleteMedia(id: string): Promise<DeleteMediaResult>;
}
