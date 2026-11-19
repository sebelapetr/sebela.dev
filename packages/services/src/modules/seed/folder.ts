// Reads and checks a seed folder without writing anything; private to the seed module.
import { createHash } from "node:crypto";
import type { Dirent, Stats } from "node:fs";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import {
  CaseStudyCreateSchema,
  CurrentFocusCreateSchema,
  DiaryDateSchema,
  DiaryNotesWriteSchema,
  EducationCreateSchema,
  ExperienceCreateSchema,
  ExplorationCreateSchema,
  OrganizationCreateSchema,
  PersonCreateSchema,
  ProjectCreateSchema,
  RoadmapAreaCreateSchema,
  RoadmapBookCreateSchema,
  RoadmapEventCreateSchema,
  RoadmapModuleCreateSchema,
  RoadmapResourceCreateSchema,
  ServiceCreateSchema,
  TechnologyCreateSchema,
  TestimonialCreateSchema,
  TimeEntryCreateSchema,
  TopicCreateSchema,
  type CaseStudyCreate,
  type CurrentFocusCreate,
  type EducationCreate,
  type ExperienceCreate,
  type ExplorationCreate,
  type OrganizationCreate,
  type PersonCreate,
  type ProjectCreate,
  type RoadmapAreaCreate,
  type RoadmapBookCreate,
  type RoadmapEventCreate,
  type RoadmapModuleCreate,
  type RoadmapResourceCreate,
  type ServiceCreate,
  type TechnologyCreate,
  type TestimonialCreate,
  type TimeEntryCreate,
  type TopicCreate,
} from "@sebela/contracts";

import { DomainError, type DomainErrorField } from "../../errors.js";
import { checkMediaUpload, type MediaLimits } from "../media/index.js";

/** The data file of each kind of record; every one is optional. */
export const dataFiles = {
  person: "person.json",
  technologies: "technologies.json",
  topics: "topics.json",
  organizations: "organizations.json",
  experiences: "experiences.json",
  projects: "projects.json",
  explorations: "explorations.json",
  services: "services.json",
  education: "education.json",
  testimonials: "testimonials.json",
  currentFocus: "current-focus.json",
  roadmapAreas: "roadmap-areas.json",
  roadmapModules: "roadmap-modules.json",
  roadmapBooks: "roadmap-books.json",
  roadmapResources: "roadmap-resources.json",
  roadmapEvents: "roadmap-events.json",
  roadmapDiary: "roadmap-diary.json",
  roadmapTimeEntries: "roadmap-time-entries.json",
} as const;

/** A diary day of the seed: its date and the notes written for it. */
export interface SeedDiaryDay {
  readonly date: string;
  readonly notes: string;
}

const SeedDiaryDaySchema = z.strictObject({
  date: DiaryDateSchema,
  notes: DiaryNotesWriteSchema.shape.notes,
});

/**
 * How the records of a file are told apart: the key of a record, the field a repeated key is
 * reported on (`null` for the whole record) and the message.
 */
interface Identity<T> {
  key(value: T): string;
  readonly field: string | null;
  readonly message: string;
}

const bySlug: Identity<{ slug: string }> = {
  key: (value) => value.slug,
  field: "slug",
  message: "This slug is already used in this file.",
};
const byDate: Identity<SeedDiaryDay> = {
  key: (value) => value.date,
  field: "date",
  message: "This date is already used in this file.",
};
/**
 * A session is its target (a resource or an event) and its absolute endpoints, whatever offset they
 * are written with.
 */
const bySession: Identity<TimeEntryCreate> = {
  key: (value) =>
    [
      value.event === undefined ? `resource:${value.resource ?? ""}` : `event:${value.event}`,
      Date.parse(value.startedAt),
      Date.parse(value.endedAt),
    ].join(" "),
  field: null,
  message: "This session is already listed in this file.",
};

/**
 * A record read from the seed, with where it came from (`experiences.json[2]`) and, for each of its
 * media fields, the digest of the declared file or `null` for none.
 */
export interface Located<T, MediaField extends string = never> {
  readonly location: string;
  readonly value: T;
  readonly files: Readonly<Record<MediaField, string | null>>;
}

/** A project with the case study the seed declares for it, if any. */
export interface SeedProject extends Located<ProjectCreate, "coverId"> {
  readonly caseStudy: CaseStudyCreate | undefined;
}

/** A file the seed attaches, ready to upload. */
export interface SeedFile {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly altText: string | null;
}

/** A checked seed folder: every record in file order, each kind empty when its file is absent. */
export interface SeedData {
  readonly person: Located<PersonCreate, "photoId" | "cvPdfId"> | null;
  readonly technologies: readonly Located<TechnologyCreate>[];
  readonly topics: readonly Located<TopicCreate>[];
  readonly organizations: readonly Located<OrganizationCreate, "logoId">[];
  readonly experiences: readonly Located<ExperienceCreate>[];
  readonly projects: readonly SeedProject[];
  readonly explorations: readonly Located<ExplorationCreate>[];
  readonly services: readonly Located<ServiceCreate>[];
  readonly education: readonly Located<EducationCreate>[];
  readonly testimonials: readonly Located<TestimonialCreate, "authorPhotoId">[];
  readonly currentFocus: readonly Located<CurrentFocusCreate>[];
  readonly roadmapAreas: readonly Located<RoadmapAreaCreate>[];
  readonly roadmapModules: readonly Located<RoadmapModuleCreate>[];
  readonly roadmapBooks: readonly Located<RoadmapBookCreate, "coverId">[];
  readonly roadmapResources: readonly Located<RoadmapResourceCreate>[];
  readonly roadmapEvents: readonly Located<RoadmapEventCreate>[];
  readonly roadmapDiary: readonly Located<SeedDiaryDay>[];
  readonly roadmapTimeEntries: readonly Located<TimeEntryCreate>[];
  /** The attached files by the SHA-256 digest of their content, each once. */
  readonly files: ReadonlyMap<string, SeedFile>;
}

/** A media field of a record: its seed key, the contract field it fills and the kind it needs. */
interface MediaSlot<Field extends string> {
  readonly key: string;
  readonly field: Field;
  readonly expects: "image" | "pdf";
}

const MediaDeclarationSchema = z
  .strictObject({
    file: z.string().min(1).max(500),
    altText: z.string().trim().min(1).max(1000).nullable().default(null),
  })
  .nullable();

const OptionalCaseStudySchema = CaseStudyCreateSchema.optional();

/** A media file declared by one record field, before its file is read. */
interface Declaration {
  readonly location: string;
  readonly file: string;
  readonly altText: string | null;
  readonly expects: "image" | "pdf";
  /** Called with the digest of the file once it passed every check. */
  resolve(digest: string): void;
}

/** Formats an issue path below a location: keys as `.key`, indexes as `[n]`. */
function below(location: string, path: readonly PropertyKey[]): string {
  return path.reduce<string>(
    (joined, part) =>
      typeof part === "number" ? `${joined}[${String(part)}]` : `${joined}.${String(part)}`,
    location,
  );
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const hasCode = (error: unknown, code: string) =>
  error instanceof Error && "code" in error && error.code === code;

const digestOf = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

const invalid = (fields: readonly DomainErrorField[]) =>
  new DomainError("validation_failed", "The seed is invalid; nothing was loaded.", fields);

/**
 * Reads every data file and attached file of a seed folder and checks them with the API's input
 * schemas, the seed's media declarations and the upload checks, writing nothing. Throws one
 * `validation_failed` naming every problem by file and field; messages never contain the folder's
 * own path.
 */
export async function readSeedFolder(folder: string | URL, limits: MediaLimits): Promise<SeedData> {
  const root = await openRoot(folder);
  const issues: DomainErrorField[] = [];
  const declarations: Declaration[] = [];

  const known = new Set<string>(Object.values(dataFiles));
  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    throw unreadableFolder();
  }
  for (const entry of entries) {
    if (entry.name.endsWith(".json") && !known.has(entry.name)) {
      issues.push({
        path: entry.name,
        message: `Unknown data file; use ${[...known].join(", ")}.`,
      });
    }
  }

  const readJson = async (name: string): Promise<unknown> => {
    let text: string;
    try {
      text = await readFile(resolve(root, name), "utf8");
    } catch (error) {
      if (hasCode(error, "ENOENT")) return undefined;
      issues.push({ path: name, message: "The file cannot be read." });
      return undefined;
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      issues.push({ path: name, message: "The file is not valid JSON." });
      return undefined;
    }
  };

  /** Parses one record: its media declarations, its extra seed keys, then the contract schema. */
  const parseRecord = <T, Field extends string>(
    raw: unknown,
    location: string,
    schema: z.ZodType<T>,
    slots: readonly MediaSlot<Field>[],
    extraKeys: readonly string[],
  ): { located: Located<T, Field>; extras: Record<string, unknown> } | null => {
    if (!isRecord(raw)) {
      issues.push({ path: location, message: "Use an object." });
      return null;
    }
    const files = {} as Record<Field, string | null>;
    let failed = false;
    for (const slot of slots) {
      files[slot.field] = null;
      if (slot.field in raw) {
        issues.push({
          path: `${location}.${slot.field}`,
          message: `Declare the file under \`${slot.key}\` instead of a media identifier.`,
        });
        failed = true;
      }
      if (!(slot.key in raw)) continue;
      const parsed = MediaDeclarationSchema.safeParse(raw[slot.key]);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          issues.push({
            path: below(`${location}.${slot.key}`, issue.path),
            message: issue.message,
          });
        }
        failed = true;
      } else if (parsed.data !== null) {
        declarations.push({
          location: `${location}.${slot.key}`,
          file: parsed.data.file,
          altText: parsed.data.altText,
          expects: slot.expects,
          resolve: (digest) => {
            files[slot.field] = digest;
          },
        });
      }
    }
    const seedOnly = new Set<string>([
      ...slots.flatMap((slot) => [slot.key, slot.field]),
      ...extraKeys,
    ]);
    const extras = Object.fromEntries(extraKeys.map((key) => [key, raw[key]]));
    const rest = Object.fromEntries(Object.entries(raw).filter(([key]) => !seedOnly.has(key)));
    const parsed = schema.safeParse(rest);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        issues.push({ path: below(location, issue.path), message: issue.message });
      }
      return null;
    }
    return failed ? null : { located: { location, value: parsed.data, files }, extras };
  };

  /** Parses an array file of records told apart by their identity; `[]` when absent or broken. */
  const parseRecords = async <T, Field extends string = never>(
    name: string,
    schema: z.ZodType<T>,
    identity: Identity<T>,
    slots: readonly MediaSlot<Field>[] = [],
    extraKeys: readonly string[] = [],
  ) => {
    const raw = await readJson(name);
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) {
      issues.push({ path: name, message: "Use an array of records." });
      return [];
    }
    const seen = new Set<string>();
    const records: { located: Located<T, Field>; extras: Record<string, unknown> }[] = [];
    raw.forEach((item: unknown, index) => {
      const location = `${name}[${String(index)}]`;
      const record = parseRecord(item, location, schema, slots, extraKeys);
      if (record === null) return;
      const key = identity.key(record.located.value);
      if (seen.has(key)) {
        issues.push({
          path: identity.field === null ? location : `${location}.${identity.field}`,
          message: identity.message,
        });
        return;
      }
      seen.add(key);
      records.push(record);
    });
    return records;
  };

  /** Parses an array file of records told apart by their slug. */
  const parseList = <T extends { slug: string }, Field extends string = never>(
    name: string,
    schema: z.ZodType<T>,
    slots: readonly MediaSlot<Field>[] = [],
    extraKeys: readonly string[] = [],
  ) => parseRecords<T, Field>(name, schema, bySlug, slots, extraKeys);

  const personRaw = await readJson(dataFiles.person);
  let person: Located<PersonCreate, "photoId" | "cvPdfId"> | null = null;
  if (personRaw !== undefined) {
    if (isRecord(personRaw)) {
      person =
        parseRecord(
          personRaw,
          dataFiles.person,
          PersonCreateSchema,
          [
            { key: "photo", field: "photoId", expects: "image" },
            { key: "cvPdf", field: "cvPdfId", expects: "pdf" },
          ],
          [],
        )?.located ?? null;
    } else {
      issues.push({ path: dataFiles.person, message: "Use an object." });
    }
  }

  const located = <T, Field extends string>(
    records: readonly { located: Located<T, Field> }[],
  ): Located<T, Field>[] => records.map((record) => record.located);

  const technologies = located(await parseList(dataFiles.technologies, TechnologyCreateSchema));
  const topics = located(await parseList(dataFiles.topics, TopicCreateSchema));
  const organizations = located(
    await parseList(dataFiles.organizations, OrganizationCreateSchema, [
      { key: "logo", field: "logoId", expects: "image" },
    ]),
  );
  const experiences = located(await parseList(dataFiles.experiences, ExperienceCreateSchema));
  const projects: SeedProject[] = [];
  for (const { located: project, extras } of await parseList(
    dataFiles.projects,
    ProjectCreateSchema,
    [{ key: "cover", field: "coverId", expects: "image" }],
    ["caseStudy"],
  )) {
    const caseStudy = OptionalCaseStudySchema.safeParse(extras["caseStudy"]);
    if (caseStudy.success) {
      projects.push({ ...project, caseStudy: caseStudy.data });
    } else {
      for (const issue of caseStudy.error.issues) {
        issues.push({
          path: below(`${project.location}.caseStudy`, issue.path),
          message: issue.message,
        });
      }
    }
  }
  const explorations = located(await parseList(dataFiles.explorations, ExplorationCreateSchema));
  const services = located(await parseList(dataFiles.services, ServiceCreateSchema));
  const education = located(await parseList(dataFiles.education, EducationCreateSchema));
  const testimonials = located(
    await parseList(dataFiles.testimonials, TestimonialCreateSchema, [
      { key: "authorPhoto", field: "authorPhotoId", expects: "image" },
    ]),
  );
  const currentFocus = located(await parseList(dataFiles.currentFocus, CurrentFocusCreateSchema));
  const roadmapAreas = located(await parseList(dataFiles.roadmapAreas, RoadmapAreaCreateSchema));
  const roadmapModules = located(
    await parseList(dataFiles.roadmapModules, RoadmapModuleCreateSchema),
  );
  const roadmapBooks = located(
    await parseList(dataFiles.roadmapBooks, RoadmapBookCreateSchema, [
      { key: "cover", field: "coverId", expects: "image" },
    ]),
  );
  const roadmapResources = located(
    await parseList(dataFiles.roadmapResources, RoadmapResourceCreateSchema),
  );
  const roadmapEvents = located(await parseList(dataFiles.roadmapEvents, RoadmapEventCreateSchema));
  const roadmapDiary = located(
    await parseRecords(dataFiles.roadmapDiary, SeedDiaryDaySchema, byDate),
  );
  const roadmapTimeEntries = located(
    await parseRecords(dataFiles.roadmapTimeEntries, TimeEntryCreateSchema, bySession),
  );

  const files = await readDeclaredFiles(root, declarations, limits, issues);

  if (issues.length > 0) throw invalid(issues);
  return {
    person,
    technologies,
    topics,
    organizations,
    experiences,
    projects,
    explorations,
    services,
    education,
    testimonials,
    currentFocus,
    roadmapAreas,
    roadmapModules,
    roadmapBooks,
    roadmapResources,
    roadmapEvents,
    roadmapDiary,
    roadmapTimeEntries,
    files,
  };
}

// File-system errors name the path they failed on, so none of them is passed on: every one becomes
// a path-free refusal.
const unreadableFolder = () =>
  new DomainError("validation_failed", "The seed folder cannot be read.");

/** The real path of the seed folder; `validation_failed` when it is missing, no folder or unreadable. */
async function openRoot(folder: string | URL): Promise<string> {
  const path = typeof folder === "string" ? resolve(folder) : fileURLToPath(folder);
  try {
    const real = await realpath(path);
    if ((await stat(real)).isDirectory()) return real;
  } catch (error) {
    if (!hasCode(error, "ENOENT") && !hasCode(error, "ENOTDIR")) throw unreadableFolder();
  }
  throw new DomainError("validation_failed", "The seed folder does not exist or is not a folder.");
}

/**
 * Reads each declared file once, refusing paths that leave the seed folder, missing or irregular
 * files and files an upload would refuse or that are not the kind the field needs. Files with the
 * same content must declare the same alt text.
 */
async function readDeclaredFiles(
  root: string,
  declarations: readonly Declaration[],
  limits: MediaLimits,
  issues: DomainErrorField[],
): Promise<Map<string, SeedFile>> {
  const files = new Map<string, SeedFile>();
  for (const declaration of declarations) {
    const path = `${declaration.location}.file`;
    const bytes = await readInside(root, declaration.file, limits, (message) => {
      issues.push({ path, message });
    });
    if (bytes === null) continue;
    const filename = basename(declaration.file);
    let mediaType: string;
    try {
      mediaType = checkMediaUpload({ bytes, filename, declaredType: "" }, limits);
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      issues.push({ path, message: error.message });
      continue;
    }
    const isPdf = mediaType === "application/pdf";
    if (isPdf !== (declaration.expects === "pdf")) {
      issues.push({ path, message: isPdf ? "Use an image." : "Use a PDF." });
      continue;
    }
    const digest = digestOf(bytes);
    const earlier = files.get(digest);
    if (earlier !== undefined && earlier.altText !== declaration.altText) {
      issues.push({
        path: `${declaration.location}.altText`,
        message: "A file with the same content is declared elsewhere with another alt text.",
      });
      continue;
    }
    if (earlier === undefined) files.set(digest, { bytes, filename, altText: declaration.altText });
    declaration.resolve(digest);
  }
  return files;
}

/** The bytes of a regular file inside the folder, or `null` after reporting why not. */
async function readInside(
  root: string,
  file: string,
  limits: MediaLimits,
  report: (message: string) => void,
): Promise<Uint8Array | null> {
  if (isAbsolute(file) || file.includes("\\") || file.split("/").includes("..")) {
    report("Use a relative path inside the seed folder, with `/` between folders.");
    return null;
  }
  let real: string;
  try {
    real = await realpath(resolve(root, file));
  } catch (error) {
    report(
      hasCode(error, "ENOENT") || hasCode(error, "ENOTDIR")
        ? "There is no such file in the seed folder."
        : "The file cannot be read.",
    );
    return null;
  }
  if (!real.startsWith(root + sep)) {
    report("Use a file inside the seed folder.");
    return null;
  }
  let info: Stats;
  try {
    info = await stat(real);
  } catch {
    report("The file cannot be read.");
    return null;
  }
  if (!info.isFile()) {
    report("Use a regular file.");
    return null;
  }
  if (info.size > limits.maxBytes) {
    report(`The file is larger than the upload limit of ${String(limits.maxBytes)} bytes.`);
    return null;
  }
  try {
    return await readFile(real);
  } catch {
    report("The file cannot be read.");
    return null;
  }
}
