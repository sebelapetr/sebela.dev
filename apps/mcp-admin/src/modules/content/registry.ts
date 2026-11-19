/**
 * The fixed entity-to-operation registry of the content module (private to it). Each content
 * entity names the generated API routes it may use, the shared contract that checks a write's
 * fields before it is sent, how its records are identified and which other records its fields
 * refer to. Nothing outside this table can be reached: there is no path, query or operator a
 * caller can choose. Authentication, the audit store, conversations and knowledge staging are not
 * content and never appear here.
 *
 * The routes are typed against the generated API client's routes, so a route that does not exist
 * with that method fails the typecheck.
 */
import type { ApiRoute } from "@sebela/api-client";
import {
  CaseStudyCreateSchema,
  CaseStudyUpdateSchema,
  CurrentFocusCreateSchema,
  CurrentFocusUpdateSchema,
  DiaryDateSchema,
  DiaryNotesWriteSchema,
  EducationCreateSchema,
  EducationUpdateSchema,
  ExperienceCreateSchema,
  ExperienceUpdateSchema,
  ExplorationCreateSchema,
  ExplorationUpdateSchema,
  MediaIdParamsSchema,
  MediaUpdateSchema,
  OrganizationCreateSchema,
  OrganizationUpdateSchema,
  PersonCreateSchema,
  PersonUpdateSchema,
  ProjectCreateSchema,
  ProjectUpdateSchema,
  RoadmapAreaCreateSchema,
  RoadmapAreaUpdateSchema,
  RoadmapBookCreateSchema,
  RoadmapBookUpdateSchema,
  RoadmapEventCreateSchema,
  RoadmapEventUpdateSchema,
  RoadmapFollowedSourceCreateSchema,
  RoadmapFollowedSourceUpdateSchema,
  RoadmapGlossaryTermCreateSchema,
  RoadmapGlossaryTermUpdateSchema,
  RoadmapModuleCreateSchema,
  RoadmapModuleUpdateSchema,
  RoadmapProjectIdeaCreateSchema,
  RoadmapProjectIdeaUpdateSchema,
  RoadmapResourceCreateSchema,
  RoadmapResourceUpdateSchema,
  ServiceCreateSchema,
  ServiceUpdateSchema,
  SlugParamsSchema,
  TechnologyCreateSchema,
  TechnologyUpdateSchema,
  TestimonialCreateSchema,
  TestimonialUpdateSchema,
  TimeEntryCreateSchema,
  TimeEntryIdParamsSchema,
  TimeEntryUpdateSchema,
  TopicCreateSchema,
  TopicUpdateSchema,
} from "@sebela/contracts";
import type { z } from "zod";

/** The content entities, named as the API's audit names them. */
export const ENTITIES = [
  "person",
  "technology",
  "topic",
  "organization",
  "experience",
  "project",
  "case-study",
  "testimonial",
  "exploration",
  "service",
  "education",
  "current-focus",
  "roadmap-area",
  "roadmap-module",
  "roadmap-resource",
  "roadmap-book",
  "roadmap-event",
  "roadmap-project-idea",
  "roadmap-followed-source",
  "roadmap-glossary-term",
  "roadmap-diary",
  "roadmap-time-entry",
  "media",
] as const;

export type Entity = (typeof ENTITIES)[number];
export type Operation = "list" | "get" | "create" | "update" | "delete";
export const OPERATIONS: readonly Operation[] = ["list", "get", "create", "update", "delete"];

type GetRoute = ApiRoute<"get">;
type PostRoute = ApiRoute<"post">;
type PatchRoute = ApiRoute<"patch">;
type DeleteRoute = ApiRoute<"delete">;

/** How a record is named in a tool call: not at all (the one person), or by a checked `id`. */
export interface RecordId {
  /** The route parameter the `id` fills. */
  readonly param: "slug" | "id" | "date";
  /** What a valid `id` is, for the caller. */
  readonly description: string;
  readonly schema: z.ZodType<string>;
}

export interface Relationship {
  readonly field: string;
  readonly target: Entity;
  readonly rule: string;
}

export interface EntityDefinition {
  readonly entity: Entity;
  readonly summary: string;
  /** `null` for the person, which has no identifier. */
  readonly id: RecordId | null;
  readonly list?: GetRoute;
  readonly get?: GetRoute;
  readonly create?: {
    readonly route: PostRoute;
    readonly schema: z.ZodType;
    /** Where a created record's identifier comes from: its `slug` field or the call's `id`. */
    readonly idFrom: "slug" | "id" | "none";
  };
  readonly update?: {
    readonly route: PatchRoute;
    readonly schema: z.ZodType;
    /** Writes the record whether or not it exists yet (the diary notes of a day). */
    readonly upsert?: true;
  };
  readonly delete?: DeleteRoute;
  readonly relationships: readonly Relationship[];
  readonly notes?: readonly string[];
}

const slugId: RecordId = {
  param: "slug",
  description: "The record's slug: lower-case words joined by hyphens.",
  schema: SlugParamsSchema.shape.slug,
};
const mediaId: RecordId = {
  param: "id",
  description: "The media's UUID, as `list` returns it.",
  schema: MediaIdParamsSchema.shape.id,
};
const timeEntryId: RecordId = {
  param: "id",
  description: "The time entry's UUID, as the roadmap-diary days list it.",
  schema: TimeEntryIdParamsSchema.shape.id,
};
const diaryDate: RecordId = {
  param: "date",
  description: "The day, `YYYY-MM-DD` in Europe/Prague.",
  schema: DiaryDateSchema,
};
const projectOfCaseStudy: RecordId = {
  param: "slug",
  description: "The slug of the project the case study belongs to.",
  schema: SlugParamsSchema.shape.slug,
};

const media = (field: string, what: string): Relationship => ({
  field,
  target: "media",
  rule: `The UUID of existing media to use as ${what}, or null to remove it. Uploading files is not part of this server.`,
});
const slugsOf = (field: string, target: Entity): Relationship => ({
  field,
  target,
  rule: `Slugs of existing ${target} records, each at most once, in their intended order. On an update the list replaces every link; an omitted list leaves them unchanged.`,
});
const slugOf = (field: string, target: Entity, required: boolean): Relationship => ({
  field,
  target,
  rule: `${required ? "Required on create: the" : "The"} slug of one existing ${target}. On an update it moves the record to that ${target}.`,
});

/** One slug-identified collection with the usual list, item and write routes. */
function collection(
  entity: Entity,
  summary: string,
  routes: {
    list: GetRoute;
    get: GetRoute;
    create: PostRoute;
    update: PatchRoute;
    delete: DeleteRoute;
  },
  schemas: { create: z.ZodType; update: z.ZodType },
  relationships: readonly Relationship[] = [],
  notes?: readonly string[],
): EntityDefinition {
  return {
    entity,
    summary,
    id: slugId,
    list: routes.list,
    get: routes.get,
    create: { route: routes.create, schema: schemas.create, idFrom: "slug" },
    update: { route: routes.update, schema: schemas.update },
    delete: routes.delete,
    relationships,
    ...(notes ? { notes } : {}),
  };
}

const DEFINITIONS: readonly EntityDefinition[] = [
  {
    entity: "person",
    summary: "The site owner's profile. There is exactly one; it has no id.",
    id: null,
    get: "/v1/person",
    create: { route: "/v1/person", schema: PersonCreateSchema, idFrom: "none" },
    update: { route: "/v1/person", schema: PersonUpdateSchema },
    relationships: [media("photoId", "the profile photo"), media("cvPdfId", "the CV PDF")],
    notes: ["The CV is a manually prepared PDF; it is never generated."],
  },
  collection(
    "technology",
    "A technology the owner works with.",
    {
      list: "/v1/technologies",
      get: "/v1/technologies/{slug}",
      create: "/v1/technologies",
      update: "/v1/technologies/{slug}",
      delete: "/v1/technologies/{slug}",
    },
    { create: TechnologyCreateSchema, update: TechnologyUpdateSchema },
  ),
  collection(
    "topic",
    "A topic the owner explores or learns.",
    {
      list: "/v1/topics",
      get: "/v1/topics/{slug}",
      create: "/v1/topics",
      update: "/v1/topics/{slug}",
      delete: "/v1/topics/{slug}",
    },
    { create: TopicCreateSchema, update: TopicUpdateSchema },
  ),
  collection(
    "organization",
    "An organization the owner worked for or with.",
    {
      list: "/v1/organizations",
      get: "/v1/organizations/{slug}",
      create: "/v1/organizations",
      update: "/v1/organizations/{slug}",
      delete: "/v1/organizations/{slug}",
    },
    { create: OrganizationCreateSchema, update: OrganizationUpdateSchema },
    [media("logoId", "the logo")],
  ),
  collection(
    "experience",
    "A role or engagement at an organization.",
    {
      list: "/v1/experiences",
      get: "/v1/experiences/{slug}",
      create: "/v1/experiences",
      update: "/v1/experiences/{slug}",
      delete: "/v1/experiences/{slug}",
    },
    { create: ExperienceCreateSchema, update: ExperienceUpdateSchema },
    [slugOf("organization", "organization", true), slugsOf("technologies", "technology")],
  ),
  collection(
    "project",
    "A project done within an experience. Its case study is the separate entity case-study.",
    {
      list: "/v1/projects",
      get: "/v1/projects/{slug}",
      create: "/v1/projects",
      update: "/v1/projects/{slug}",
      delete: "/v1/projects/{slug}",
    },
    { create: ProjectCreateSchema, update: ProjectUpdateSchema },
    [
      slugOf("experience", "experience", true),
      slugsOf("technologies", "technology"),
      media("coverId", "the cover image"),
    ],
  ),
  {
    entity: "case-study",
    summary: "The case study of one project, named by the project's slug.",
    id: projectOfCaseStudy,
    get: "/v1/projects/{slug}/case-study",
    create: {
      route: "/v1/projects/{slug}/case-study",
      schema: CaseStudyCreateSchema,
      idFrom: "id",
    },
    update: { route: "/v1/projects/{slug}/case-study", schema: CaseStudyUpdateSchema },
    delete: "/v1/projects/{slug}/case-study",
    relationships: [],
    notes: ["Give the project's slug as `id`, also when creating."],
  },
  collection(
    "testimonial",
    "A quote about the owner from someone they worked with.",
    {
      list: "/v1/testimonials",
      get: "/v1/testimonials/{slug}",
      create: "/v1/testimonials",
      update: "/v1/testimonials/{slug}",
      delete: "/v1/testimonials/{slug}",
    },
    { create: TestimonialCreateSchema, update: TestimonialUpdateSchema },
    [slugOf("experience", "experience", true), media("authorPhotoId", "the author's photo")],
  ),
  collection(
    "exploration",
    "Something the owner explores outside client work.",
    {
      list: "/v1/explorations",
      get: "/v1/explorations/{slug}",
      create: "/v1/explorations",
      update: "/v1/explorations/{slug}",
      delete: "/v1/explorations/{slug}",
    },
    { create: ExplorationCreateSchema, update: ExplorationUpdateSchema },
    [slugsOf("technologies", "technology"), slugsOf("topics", "topic")],
  ),
  collection(
    "service",
    "A service the owner offers, with its evidence.",
    {
      list: "/v1/services",
      get: "/v1/services/{slug}",
      create: "/v1/services",
      update: "/v1/services/{slug}",
      delete: "/v1/services/{slug}",
    },
    { create: ServiceCreateSchema, update: ServiceUpdateSchema },
    [
      {
        field: "evidence",
        target: "project",
        rule: "Each item names one existing project or experience by kind and slug. On an update the list replaces all evidence.",
      },
    ],
  ),
  collection(
    "education",
    "A degree, course or certificate.",
    {
      list: "/v1/education",
      get: "/v1/education/{slug}",
      create: "/v1/education",
      update: "/v1/education/{slug}",
      delete: "/v1/education/{slug}",
    },
    { create: EducationCreateSchema, update: EducationUpdateSchema },
  ),
  collection(
    "current-focus",
    "What the owner focuses on now.",
    {
      list: "/v1/current-focus",
      get: "/v1/current-focus/{slug}",
      create: "/v1/current-focus",
      update: "/v1/current-focus/{slug}",
      delete: "/v1/current-focus/{slug}",
    },
    { create: CurrentFocusCreateSchema, update: CurrentFocusUpdateSchema },
    [slugOf("project", "project", false), slugsOf("topics", "topic")],
  ),
  {
    entity: "roadmap-area",
    summary: "A top-level area of the AI Engineering Roadmap.",
    id: slugId,
    list: "/v1/roadmap",
    get: "/v1/roadmap/areas/{slug}",
    create: { route: "/v1/roadmap/areas", schema: RoadmapAreaCreateSchema, idFrom: "slug" },
    update: { route: "/v1/roadmap/areas/{slug}", schema: RoadmapAreaUpdateSchema },
    delete: "/v1/roadmap/areas/{slug}",
    relationships: [],
    notes: ["`list` returns the whole roadmap tree of areas, modules and resources."],
  },
  {
    entity: "roadmap-module",
    summary: "A module inside a roadmap area.",
    id: slugId,
    list: "/v1/roadmap",
    get: "/v1/roadmap/modules/{slug}",
    create: { route: "/v1/roadmap/modules", schema: RoadmapModuleCreateSchema, idFrom: "slug" },
    update: { route: "/v1/roadmap/modules/{slug}", schema: RoadmapModuleUpdateSchema },
    delete: "/v1/roadmap/modules/{slug}",
    relationships: [slugOf("area", "roadmap-area", true)],
    notes: ["`list` returns the whole roadmap tree of areas, modules and resources."],
  },
  {
    entity: "roadmap-resource",
    summary: "A learning resource inside a roadmap module.",
    id: slugId,
    list: "/v1/roadmap",
    get: "/v1/roadmap/resources/{slug}",
    create: {
      route: "/v1/roadmap/resources",
      schema: RoadmapResourceCreateSchema,
      idFrom: "slug",
    },
    update: { route: "/v1/roadmap/resources/{slug}", schema: RoadmapResourceUpdateSchema },
    delete: "/v1/roadmap/resources/{slug}",
    relationships: [
      slugOf("module", "roadmap-module", true),
      slugOf("book", "roadmap-book", false),
      slugsOf("topics", "topic"),
    ],
    notes: ["`list` returns the whole roadmap tree of areas, modules and resources."],
  },
  collection(
    "roadmap-book",
    "A book on the roadmap's reading list.",
    {
      list: "/v1/roadmap/books",
      get: "/v1/roadmap/books/{slug}",
      create: "/v1/roadmap/books",
      update: "/v1/roadmap/books/{slug}",
      delete: "/v1/roadmap/books/{slug}",
    },
    { create: RoadmapBookCreateSchema, update: RoadmapBookUpdateSchema },
    [media("coverId", "the book cover")],
  ),
  collection(
    "roadmap-event",
    "A conference, meetup or workshop.",
    {
      list: "/v1/roadmap/events",
      get: "/v1/roadmap/events/{slug}",
      create: "/v1/roadmap/events",
      update: "/v1/roadmap/events/{slug}",
      delete: "/v1/roadmap/events/{slug}",
    },
    { create: RoadmapEventCreateSchema, update: RoadmapEventUpdateSchema },
    [slugsOf("topics", "topic")],
  ),
  collection(
    "roadmap-project-idea",
    "An idea for a learning project.",
    {
      list: "/v1/roadmap/project-ideas",
      get: "/v1/roadmap/project-ideas/{slug}",
      create: "/v1/roadmap/project-ideas",
      update: "/v1/roadmap/project-ideas/{slug}",
      delete: "/v1/roadmap/project-ideas/{slug}",
    },
    { create: RoadmapProjectIdeaCreateSchema, update: RoadmapProjectIdeaUpdateSchema },
    [slugsOf("topics", "topic")],
  ),
  collection(
    "roadmap-followed-source",
    "A source the owner follows.",
    {
      list: "/v1/roadmap/followed-sources",
      get: "/v1/roadmap/followed-sources/{slug}",
      create: "/v1/roadmap/followed-sources",
      update: "/v1/roadmap/followed-sources/{slug}",
      delete: "/v1/roadmap/followed-sources/{slug}",
    },
    { create: RoadmapFollowedSourceCreateSchema, update: RoadmapFollowedSourceUpdateSchema },
  ),
  collection(
    "roadmap-glossary-term",
    "A term of the roadmap's glossary.",
    {
      list: "/v1/roadmap/glossary-terms",
      get: "/v1/roadmap/glossary-terms/{slug}",
      create: "/v1/roadmap/glossary-terms",
      update: "/v1/roadmap/glossary-terms/{slug}",
      delete: "/v1/roadmap/glossary-terms/{slug}",
    },
    { create: RoadmapGlossaryTermCreateSchema, update: RoadmapGlossaryTermUpdateSchema },
  ),
  {
    entity: "roadmap-diary",
    summary: "The diary of one day: its notes and its time entries.",
    id: diaryDate,
    list: "/v1/roadmap/diary",
    get: "/v1/roadmap/diary/{date}",
    update: { route: "/v1/roadmap/diary/{date}", schema: DiaryNotesWriteSchema, upsert: true },
    delete: "/v1/roadmap/diary/{date}",
    relationships: [],
    notes: [
      "`update` writes the notes of a day whether or not the day has notes yet; there is no separate create.",
      "`delete` removes the notes of a day, not its time entries.",
    ],
  },
  {
    entity: "roadmap-time-entry",
    summary: "A span of study time, optionally on a resource or an event.",
    id: timeEntryId,
    create: { route: "/v1/roadmap/time-entries", schema: TimeEntryCreateSchema, idFrom: "none" },
    update: { route: "/v1/roadmap/time-entries/{id}", schema: TimeEntryUpdateSchema },
    delete: "/v1/roadmap/time-entries/{id}",
    relationships: [
      slugOf("resource", "roadmap-resource", false),
      slugOf("event", "roadmap-event", false),
    ],
    notes: ["Time entries are read through `roadmap-diary`, which lists them by day."],
  },
  {
    entity: "media",
    summary: "The metadata of an uploaded image or PDF.",
    id: mediaId,
    list: "/v1/media",
    get: "/v1/media/{id}",
    update: { route: "/v1/media/{id}", schema: MediaUpdateSchema },
    delete: "/v1/media/{id}",
    relationships: [],
    notes: ["Uploading files is not part of this server; only the metadata of existing media."],
  },
];

const BY_ENTITY = new Map(DEFINITIONS.map((definition) => [definition.entity, definition]));

export function definitionOf(entity: Entity): EntityDefinition {
  const definition = BY_ENTITY.get(entity);
  if (!definition) throw new Error(`No registry entry for ${entity}`);
  return definition;
}

export function operationsOf(definition: EntityDefinition): Operation[] {
  return OPERATIONS.filter((operation) => definition[operation] !== undefined);
}
