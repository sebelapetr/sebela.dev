import type { Persistence } from "@sebela/db";

import { DomainError, type DomainErrorField } from "../../errors.js";
import {
  createMediaService,
  type CleanupFailure,
  type MediaLimits,
  type MediaService,
} from "../media/index.js";
import {
  createProfileService,
  type ProfileService,
  type ProfileServiceOptions,
} from "../profile/index.js";
import { createRoadmapService, type RoadmapService } from "../roadmap/index.js";
import type { OpenedStorage } from "../storage/index.js";
import { readSeedFolder, type Located, type SeedData } from "./folder.js";

/** The kinds of record a seed folder holds, each in its own data file. */
export type SeedKind =
  | "person"
  | "technologies"
  | "topics"
  | "organizations"
  | "experiences"
  | "projects"
  | "caseStudies"
  | "explorations"
  | "services"
  | "education"
  | "testimonials"
  | "currentFocus"
  | "roadmapAreas"
  | "roadmapModules"
  | "roadmapBooks"
  | "roadmapResources"
  | "roadmapDiary"
  | "roadmapTimeEntries";

/** How many records of one kind a load created and how many existing ones it updated. */
export interface SeedCount {
  readonly created: number;
  readonly updated: number;
}

/** What one load did; counts only, never content. */
export interface SeedReport {
  readonly records: Readonly<Record<SeedKind, SeedCount>>;
  readonly media: {
    /** Files stored and recorded by this load. */
    readonly uploaded: number;
    /** Declared files whose identical content was already recorded and reused. */
    readonly reused: number;
    /** Media a seed record no longer refers to and nothing else uses, deleted after the load. */
    readonly removed: number;
  };
}

/**
 * Loads a seed folder (format: `packages/db/seed/README.md`) into the profile and the AI roadmap
 * through the profile, roadmap and media services, in-process.
 *
 * - Records are matched by slug, the person as the single person and a case study by its project's
 *   slug. A roadmap module or resource is matched by its own slug, so a rerun moves it to the parent
 *   the seed names instead of duplicating it. A matched record is overwritten with the seed's
 *   values, so a rerun undoes edits to the records the seed names; records and case studies it does
 *   not name are kept. A rerun of the same folder creates nothing new.
 * - A diary day is matched by its date and its notes are overwritten; its time entries stay. A
 *   session is matched by its resource and absolute endpoints, whatever offset they are written
 *   with: one already logged (in one or more diary-day pieces) is left as it is and counted as
 *   updated, any other one is logged. A session that overlaps logged time, or another session of
 *   the seed, is refused as `conflict` at its location and the whole load rolls back.
 * - Every data file is optional; an absent one leaves its kind untouched.
 * - Attached files are reused by content, so an unchanged file is never stored twice. Media a seed
 *   record stopped referring to is deleted after the load unless anything still uses it.
 * - A folder that does not exist, cannot be read, is malformed, fails the API's input schemas or upload checks, or
 *   refers to records neither it nor the database has is refused as one `validation_failed` naming
 *   every problem by file and field (`experiences.json[0].technologies[1]`), before any write.
 *   Messages never contain the folder's path.
 * - Any other failure rolls every write back, removes the files stored by this load (reporting
 *   those that cannot be removed through `onCleanupFailure`) and rethrows the error.
 */
export interface SeedService {
  loadSeed(folder: string | URL): Promise<SeedReport>;
  /**
   * Loads the seed like `loadSeed`, but only into an empty profile: no person, no record of any
   * kind and no media. Otherwise returns `null` and writes nothing, so content already edited is
   * never overwritten. The folder is read and validated first, so an invalid seed is refused
   * either way. Two loads started at the same moment into one empty profile are not serialised.
   */
  loadSeedIntoEmpty(folder: string | URL): Promise<SeedReport | null>;
}

export interface SeedServiceOptions {
  readonly storage: OpenedStorage;
  readonly limits: MediaLimits;
  onCleanupFailure(failure: CleanupFailure): void;
  readonly mediaAddress?: ProfileServiceOptions["mediaAddress"];
}

type Counts = Record<SeedKind, { created: number; updated: number }>;

const emptyCounts = (): Counts => ({
  person: { created: 0, updated: 0 },
  technologies: { created: 0, updated: 0 },
  topics: { created: 0, updated: 0 },
  organizations: { created: 0, updated: 0 },
  experiences: { created: 0, updated: 0 },
  projects: { created: 0, updated: 0 },
  caseStudies: { created: 0, updated: 0 },
  explorations: { created: 0, updated: 0 },
  services: { created: 0, updated: 0 },
  education: { created: 0, updated: 0 },
  testimonials: { created: 0, updated: 0 },
  currentFocus: { created: 0, updated: 0 },
  roadmapAreas: { created: 0, updated: 0 },
  roadmapModules: { created: 0, updated: 0 },
  roadmapBooks: { created: 0, updated: 0 },
  roadmapResources: { created: 0, updated: 0 },
  roadmapDiary: { created: 0, updated: 0 },
  roadmapTimeEntries: { created: 0, updated: 0 },
});

const isRefusal = (error: unknown, ...codes: string[]) =>
  error instanceof DomainError && codes.includes(error.code);

/** Rethrows a refusal of one record with its field paths below the record's location. */
async function at<T>(location: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    const fields = error.fields?.map((field) => ({ ...field, path: `${location}.${field.path}` }));
    throw new DomainError(
      error.code,
      error.message,
      fields ?? [{ path: location, message: error.message }],
    );
  }
}

/**
 * Whether the profile holds no person, no record of any kind and no media, and the roadmap no area
 * and no diary day.
 */
async function isEmpty(
  profile: ProfileService,
  media: MediaService,
  roadmap: RoadmapService,
): Promise<boolean> {
  const person = await profile.getPerson().catch((error: unknown) => {
    if (isRefusal(error, "not_found")) return null;
    throw error;
  });
  if (person !== null) return false;
  const lists: (() => Promise<readonly unknown[]>)[] = [
    () => profile.listTechnologies(),
    () => profile.listTopics(),
    () => profile.listOrganizations(),
    () => profile.listExperiences(),
    () => profile.listProjects(),
    () => profile.listExplorations(),
    () => profile.listServices(),
    () => profile.listEducation(),
    () => profile.listTestimonials(),
    () => profile.listCurrentFocus(),
    () => media.listMedia(),
    async () => (await roadmap.getRoadmap()).areas,
    async () => (await roadmap.getDiary()).days,
  ];
  for (const list of lists) if ((await list()).length > 0) return false;
  return true;
}

/**
 * The problems of references to records that neither the seed nor the database has, by field.
 */
async function checkReferences(
  data: SeedData,
  profile: ProfileService,
  roadmap: RoadmapService,
): Promise<DomainErrorField[]> {
  const slugs = async (
    seeded: readonly Located<{ slug: string }, string>[],
    stored: Promise<{ slug: string }[]>,
  ) =>
    new Set([...seeded.map(({ value }) => value.slug), ...(await stored).map(({ slug }) => slug)]);
  const technologies = await slugs(data.technologies, profile.listTechnologies());
  const topics = await slugs(data.topics, profile.listTopics());
  const organizations = await slugs(data.organizations, profile.listOrganizations());
  const experiences = await slugs(data.experiences, profile.listExperiences());
  const projects = await slugs(data.projects, profile.listProjects());
  const explorations = await slugs(data.explorations, profile.listExplorations());
  const tree = (await roadmap.getRoadmap()).areas;
  const areas = await slugs(data.roadmapAreas, Promise.resolve(tree));
  const modules = await slugs(
    data.roadmapModules,
    Promise.resolve(tree.flatMap((area) => area.modules)),
  );
  const resources = await slugs(
    data.roadmapResources,
    Promise.resolve(tree.flatMap((area) => area.modules.flatMap((module) => module.resources))),
  );

  const issues: DomainErrorField[] = [];
  const check = (known: Set<string>, slug: string | null, path: string, what: string) => {
    if (slug !== null && !known.has(slug)) {
      issues.push({
        path,
        message: `There is no ${what} with this slug in the seed or the profile.`,
      });
    }
  };
  const checkAll = (known: Set<string>, list: readonly string[], path: string, what: string) => {
    list.forEach((slug, index) => {
      check(known, slug, `${path}[${String(index)}]`, what);
    });
  };

  for (const { location, value } of data.experiences) {
    check(organizations, value.organization, `${location}.organization`, "organization");
    checkAll(technologies, value.technologies, `${location}.technologies`, "technology");
  }
  for (const { location, value } of data.projects) {
    check(experiences, value.experience, `${location}.experience`, "experience");
    checkAll(technologies, value.technologies, `${location}.technologies`, "technology");
  }
  for (const { location, value } of data.explorations) {
    checkAll(technologies, value.technologies, `${location}.technologies`, "technology");
    checkAll(topics, value.topics, `${location}.topics`, "topic");
  }
  for (const { location, value } of data.services) {
    value.evidence.forEach((piece, index) => {
      const path = `${location}.evidence[${String(index)}]`;
      if (piece.kind === "project") check(projects, piece.project, `${path}.project`, "project");
      if (piece.kind === "exploration") {
        check(explorations, piece.exploration, `${path}.exploration`, "exploration");
      }
    });
  }
  for (const { location, value } of data.testimonials) {
    check(experiences, value.experience, `${location}.experience`, "experience");
  }
  for (const { location, value } of data.currentFocus) {
    check(projects, value.project, `${location}.project`, "project");
    checkAll(topics, value.topics, `${location}.topics`, "topic");
  }
  for (const { location, value } of data.roadmapModules) {
    check(areas, value.area, `${location}.area`, "roadmap area");
  }
  for (const { location, value } of data.roadmapResources) {
    check(modules, value.module, `${location}.module`, "roadmap module");
    checkAll(topics, value.topics, `${location}.topics`, "topic");
  }
  for (const { location, value } of data.roadmapTimeEntries) {
    check(resources, value.resource, `${location}.resource`, "roadmap resource");
  }
  return issues;
}

export function createSeedService(
  persistence: Pick<Persistence, "profile" | "transaction">,
  options: SeedServiceOptions,
): SeedService {
  const mediaOptions = {
    storage: options.storage,
    limits: options.limits,
    onCleanupFailure: (failure: CleanupFailure) => {
      options.onCleanupFailure(failure);
    },
  };
  const profileOptions: ProfileServiceOptions =
    options.mediaAddress === undefined ? {} : { mediaAddress: options.mediaAddress };

  return {
    async loadSeed(folder) {
      const report = await load(folder, false);
      if (report === null) throw new Error("A full seed load was skipped.");
      return report;
    },
    loadSeedIntoEmpty: (folder) => load(folder, true),
  };

  /** Loads the folder; with `onlyIntoEmpty`, returns `null` without a write unless it is empty. */
  async function load(folder: string | URL, onlyIntoEmpty: boolean): Promise<SeedReport | null> {
    const data = await readSeedFolder(folder, options.limits);
    const counts = emptyCounts();
    const media = { uploaded: 0, reused: 0, removed: 0 };
    /** Keys this load stored, removed again when it fails. */
    const storedKeys: string[] = [];
    /** Media seed records referred to before this load and no longer do. */
    const superseded = new Set<string>();
    /** Whether the load ran; `false` when the profile was not empty and nothing was written. */
    let loaded: boolean;

    try {
      loaded = await persistence.transaction(async (tx, roadmapTx) => {
        const profile = createProfileService(tx, profileOptions);
        const mediaService = createMediaService(tx, mediaOptions);
        const roadmap = createRoadmapService(roadmapTx);

        if (onlyIntoEmpty && !(await isEmpty(profile, mediaService, roadmap))) {
          return false;
        }

        const problems = await checkReferences(data, profile, roadmap);
        if (problems.length > 0) {
          throw new DomainError(
            "validation_failed",
            "The seed refers to records that do not exist; nothing was loaded.",
            problems,
          );
        }

        const mediaIds = new Map<string, string>();
        for (const [digest, file] of data.files) {
          const ensured = await mediaService.ensureMedia({
            bytes: file.bytes,
            filename: file.filename,
            declaredType: "",
            altText: file.altText,
          });
          if (ensured.created) {
            storedKeys.push(ensured.media.key);
            media.uploaded += 1;
          } else {
            media.reused += 1;
          }
          mediaIds.set(digest, ensured.media.id);
        }
        const mediaId = (digest: string | null) =>
          digest === null ? null : (mediaIds.get(digest) ?? null);
        const supersede = (before: string | null, after: string | null) => {
          if (before !== null && before !== after) superseded.add(before);
        };

        /** Creates a record, or overwrites the one with its slug. */
        const upsert = async <T extends { slug: string }, R, Field extends string = never>(
          kind: SeedKind,
          records: readonly Located<T, Field>[],
          find: (slug: string) => Promise<R>,
          create: (value: T) => Promise<unknown>,
          update: (slug: string, changes: Omit<T, "slug">, existing: R) => Promise<unknown>,
          prepare: (record: Located<T, Field>) => T = ({ value }) => value,
        ) => {
          for (const record of records) {
            const value = prepare(record);
            const { slug, ...changes } = value;
            await at(record.location, async () => {
              const existing = await find(slug).catch((error: unknown) => {
                if (isRefusal(error, "not_found")) return null;
                throw error;
              });
              if (existing === null) {
                await create(value);
                counts[kind].created += 1;
              } else {
                await update(slug, changes, existing);
                counts[kind].updated += 1;
              }
            });
          }
        };

        await upsert(
          "technologies",
          data.technologies,
          (slug) => profile.getTechnology(slug),
          (value) => profile.createTechnology(value),
          (slug, changes) => profile.updateTechnology(slug, changes),
        );
        await upsert(
          "topics",
          data.topics,
          (slug) => profile.getTopic(slug),
          (value) => profile.createTopic(value),
          (slug, changes) => profile.updateTopic(slug, changes),
        );
        await upsert(
          "organizations",
          data.organizations,
          (slug) => profile.getOrganization(slug),
          (value) => profile.createOrganization(value),
          (slug, changes, existing) => {
            supersede(existing.logoId, changes.logoId);
            return profile.updateOrganization(slug, changes);
          },
          ({ value, files }) => ({ ...value, logoId: mediaId(files.logoId) }),
        );

        if (data.person !== null) {
          const { location, files } = data.person;
          const value = {
            ...data.person.value,
            photoId: mediaId(files.photoId),
            cvPdfId: mediaId(files.cvPdfId),
          };
          await at(location, async () => {
            const existing = await profile.getPerson().catch((error: unknown) => {
              if (isRefusal(error, "not_found")) return null;
              throw error;
            });
            if (existing === null) {
              await profile.createPerson(value);
              counts.person.created += 1;
            } else {
              supersede(existing.photoId, value.photoId);
              supersede(existing.cvPdfId, value.cvPdfId);
              await profile.updatePerson(value);
              counts.person.updated += 1;
            }
          });
        }

        await upsert(
          "experiences",
          data.experiences,
          (slug) => profile.getExperience(slug),
          (value) => profile.createExperience(value),
          (slug, changes) => profile.updateExperience(slug, changes),
        );
        await upsert(
          "projects",
          data.projects,
          (slug) => profile.getProject(slug),
          (value) => profile.createProject(value),
          (slug, changes, existing) => {
            supersede(existing.coverId, changes.coverId);
            return profile.updateProject(slug, changes);
          },
          ({ value, files }) => ({ ...value, coverId: mediaId(files.coverId) }),
        );
        for (const project of data.projects) {
          const { caseStudy } = project;
          if (caseStudy === undefined) continue;
          const slug = project.value.slug;
          await at(`${project.location}.caseStudy`, async () => {
            const existing = await profile.getCaseStudy(slug).catch((error: unknown) => {
              if (isRefusal(error, "not_found")) return null;
              throw error;
            });
            if (existing === null) {
              await profile.createCaseStudy(slug, caseStudy);
              counts.caseStudies.created += 1;
            } else {
              await profile.updateCaseStudy(slug, caseStudy);
              counts.caseStudies.updated += 1;
            }
          });
        }
        await upsert(
          "explorations",
          data.explorations,
          (slug) => profile.getExploration(slug),
          (value) => profile.createExploration(value),
          (slug, changes) => profile.updateExploration(slug, changes),
        );
        await upsert(
          "education",
          data.education,
          (slug) => profile.getEducation(slug),
          (value) => profile.createEducation(value),
          (slug, changes) => profile.updateEducation(slug, changes),
        );
        await upsert(
          "testimonials",
          data.testimonials,
          (slug) => profile.getTestimonial(slug),
          (value) => profile.createTestimonial(value),
          (slug, changes, existing) => {
            supersede(existing.authorPhotoId, changes.authorPhotoId);
            return profile.updateTestimonial(slug, changes);
          },
          ({ value, files }) => ({ ...value, authorPhotoId: mediaId(files.authorPhotoId) }),
        );
        await upsert(
          "services",
          data.services,
          (slug) => profile.getService(slug),
          (value) => profile.createService(value),
          (slug, changes) => profile.updateService(slug, changes),
        );
        await upsert(
          "currentFocus",
          data.currentFocus,
          (slug) => profile.getCurrentFocus(slug),
          (value) => profile.createCurrentFocus(value),
          (slug, changes) => profile.updateCurrentFocus(slug, changes),
        );
        await upsert(
          "roadmapAreas",
          data.roadmapAreas,
          (slug) => roadmap.getArea(slug),
          (value) => roadmap.createArea(value),
          (slug, changes) => roadmap.updateArea(slug, changes),
        );
        await upsert(
          "roadmapModules",
          data.roadmapModules,
          (slug) => roadmap.getModule(slug),
          (value) => roadmap.createModule(value),
          (slug, changes) => roadmap.updateModule(slug, changes),
        );
        await upsert(
          "roadmapResources",
          data.roadmapResources,
          (slug) => roadmap.getResource(slug),
          (value) => roadmap.createResource(value),
          (slug, changes) => roadmap.updateResource(slug, changes),
        );

        for (const { location, value } of data.roadmapDiary) {
          await at(location, async () => {
            const existing = await roadmap.getDiaryDay(value.date).catch((error: unknown) => {
              if (isRefusal(error, "not_found")) return null;
              throw error;
            });
            await roadmap.writeDiaryNotes(value.date, { notes: value.notes });
            counts.roadmapDiary[existing?.notes == null ? "created" : "updated"] += 1;
          });
        }

        // A session is matched by its resource and absolute endpoints. Logged intervals never
        // overlap, so the session is already logged exactly when the resource's entries inside it
        // fill it completely, however it was split into diary days.
        const logged =
          data.roadmapTimeEntries.length === 0
            ? []
            : (await roadmap.getDiary()).days.flatMap((day) => day.entries);
        for (const { location, value } of data.roadmapTimeEntries) {
          const start = Date.parse(value.startedAt);
          const end = Date.parse(value.endedAt);
          const covered = logged
            .filter(
              (entry) =>
                entry.resource.slug === value.resource &&
                Date.parse(entry.startedAt) >= start &&
                Date.parse(entry.endedAt) <= end,
            )
            .reduce((sum, entry) => sum + entry.durationSeconds * 1000, 0);
          if (covered === end - start) {
            counts.roadmapTimeEntries.updated += 1;
            continue;
          }
          await at(location, () => roadmap.createTimeEntry(value));
          counts.roadmapTimeEntries.created += 1;
        }
        return true;
      });
    } catch (error) {
      for (const key of storedKeys) {
        await options.storage.storage.delete(key).catch((cleanupError: unknown) => {
          options.onCleanupFailure({ operation: "upload", key, error: cleanupError });
        });
      }
      throw error;
    }
    if (!loaded) return null;

    const mediaService = createMediaService(persistence.profile, mediaOptions);
    for (const id of superseded) {
      try {
        await mediaService.deleteMedia(id);
        media.removed += 1;
      } catch (error) {
        if (!isRefusal(error, "conflict", "not_found")) throw error;
      }
    }

    return { records: counts, media };
  }
}
