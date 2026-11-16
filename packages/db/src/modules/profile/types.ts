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
  /** `true` when the technology was deleted, `false` when there was none. */
  deleteTechnology(slug: string): Promise<boolean>;
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
