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
