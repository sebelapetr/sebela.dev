// The audited content write: one transaction that runs a content operation, reads every record it
// names before and after, and stores who changed what. Content and its audit commit together or not
// at all. It hides the transaction, the snapshot reads per entity, the serialization of audited
// writes and the media file compensation.
import {
  AuditProvenanceSchema,
  auditProvenanceMaxLength,
  recentChangesLimit,
  type AuditChange,
  type AuditEntity,
} from "@sebela/contracts";
import type { AuditEntryInput, Persistence } from "@sebela/db";

import { DomainError } from "../../errors.js";
import {
  createMediaService,
  unconfiguredMedia,
  type CleanupFailure,
  type MediaService,
  type MediaServiceOptions,
} from "../media/index.js";
import {
  createProfileService,
  type ProfileService,
  type ProfileServiceOptions,
} from "../profile/index.js";
import { createRoadmapService, type RoadmapService } from "../roadmap/index.js";
import type { OpenedStorage, Storage } from "../storage/index.js";

/** The content operations an audited write runs, bound to its transaction. */
export interface ContentServices {
  readonly profile: ProfileService;
  readonly roadmap: RoadmapService;
  readonly media: MediaService;
}

/** The HTTP operation that made a change. */
export interface AuditOperation {
  readonly operationId: string;
  readonly method: "POST" | "PATCH" | "DELETE";
  /** The route's path template, such as `/v1/organizations/:slug`. */
  readonly route: string;
}

/** One content write and what the audit needs to know about it. */
export interface AuditedWrite<T> {
  /** The verified API key; never a value the caller of the API supplied. */
  readonly actor: { readonly keyId: string };
  readonly operation: AuditOperation;
  /** A label the caller stated (`AuditProvenanceSchema`), or `null`. */
  readonly provenance: string | null;
  readonly entity: AuditEntity;
  /**
   * The records the write addresses before it runs, by the name the invalidation contract uses:
   * `[null]` for the person, the path's slug, identifier or date, or none for a create.
   */
  readonly records: readonly (string | null)[];
  /** The operation itself, over the services of the write's transaction. */
  run(content: ContentServices): Promise<T>;
  /** Records only the result names, such as a created slug or the entries a time entry wrote. */
  recordsOf?(result: T): readonly (string | null)[];
}

/**
 * Audited content writes and the bounded read of the newest changes.
 *
 * - `write`: waits for any other audited write, reads each named record, runs the operation, reads
 *   every record again and stores one change per record that existed before or after: `created`,
 *   `updated` or `deleted` from those reads. Everything happens in one transaction: a refused
 *   operation rethrows its refusal and stores nothing; an audit that cannot be stored (an unknown
 *   key) or a write that changed no record it can name throws and rolls the content back. A
 *   provenance label outside the contract is refused with `validation_failed` before anything runs.
 *   A file stored by a write that rolls back is removed again; a file a write deletes is removed only
 *   after it committed. A file that cannot be removed is reported like any media cleanup failure.
 * - `recentChanges`: the newest `recentChangesLimit` changes, newest first, with the name of each
 *   change's key.
 */
export interface AuditService {
  write<T>(write: AuditedWrite<T>): Promise<T>;
  recentChanges(): Promise<AuditChange[]>;
}

export interface AuditServiceOptions extends ProfileServiceOptions {
  /** Storage, limits and cleanup reporting for media writes; without them media writes throw. */
  readonly media?: MediaServiceOptions;
}

/** Reads one record of an entity as its public read returns it; `null` when it does not exist. */
type Snapshot = (content: ContentServices, record: string) => Promise<unknown>;

/** The public read of every audited entity, by the record name the write addresses. */
const snapshots: Record<Exclude<AuditEntity, "person">, Snapshot> = {
  technology: ({ profile }, slug) => profile.getTechnology(slug),
  topic: ({ profile }, slug) => profile.getTopic(slug),
  organization: ({ profile }, slug) => profile.getOrganization(slug),
  experience: ({ profile }, slug) => profile.getExperience(slug),
  project: ({ profile }, slug) => profile.getProject(slug),
  "case-study": ({ profile }, project) => profile.getCaseStudy(project),
  testimonial: ({ profile }, slug) => profile.getTestimonial(slug),
  exploration: ({ profile }, slug) => profile.getExploration(slug),
  service: ({ profile }, slug) => profile.getService(slug),
  education: ({ profile }, slug) => profile.getEducation(slug),
  "current-focus": ({ profile }, slug) => profile.getCurrentFocus(slug),
  "roadmap-area": ({ roadmap }, slug) => roadmap.getArea(slug),
  "roadmap-module": ({ roadmap }, slug) => roadmap.getModule(slug),
  "roadmap-resource": ({ roadmap }, slug) => roadmap.getResource(slug),
  "roadmap-book": ({ roadmap }, slug) => roadmap.getBook(slug),
  "roadmap-event": ({ roadmap }, slug) => roadmap.getEvent(slug),
  "roadmap-project-idea": ({ roadmap }, slug) => roadmap.getProjectIdea(slug),
  "roadmap-followed-source": ({ roadmap }, slug) => roadmap.getFollowedSource(slug),
  "roadmap-glossary-term": ({ roadmap }, slug) => roadmap.getGlossaryTerm(slug),
  "roadmap-diary": ({ roadmap }, date) => roadmap.getDiaryDay(date),
  "roadmap-time-entry": ({ roadmap }, id) => roadmap.getTimeEntry(id),
  media: ({ media }, id) => media.getMedia(id),
};

/** The record as stored JSON, or `null` when the entity's read finds no such record. */
async function snapshotOf(
  content: ContentServices,
  entity: AuditEntity,
  record: string | null,
): Promise<Record<string, unknown> | null> {
  try {
    const read =
      entity === "person"
        ? await content.profile.getPerson()
        : record === null
          ? null
          : await snapshots[entity](content, record);
    return read === null ? null : (JSON.parse(JSON.stringify(read)) as Record<string, unknown>);
  } catch (error) {
    if (error instanceof DomainError && error.code === "not_found") return null;
    throw error;
  }
}

/**
 * The storage of one audited write. A file it stores is removed again unless the write commits; a
 * file it deletes is removed only once the write committed, so a rollback never loses a file its
 * record still names. A file stored and deleted within the write is removed at once.
 */
function transactionalStorage(opened: OpenedStorage) {
  const stored = new Set<string>();
  const deferred: string[] = [];
  const storage: Storage = {
    async store(file) {
      const key = await opened.storage.store(file);
      stored.add(key);
      return key;
    },
    async delete(key) {
      if (stored.delete(key)) {
        await opened.storage.delete(key);
        return;
      }
      deferred.push(key);
    },
    publicAddress: (key) => opened.storage.publicAddress(key),
  };
  /** Removes files; reports each one that stays. */
  const remove = async (
    keys: Iterable<string>,
    operation: CleanupFailure["operation"],
    report: (failure: CleanupFailure) => void,
  ) => {
    for (const key of keys) {
      await opened.storage.delete(key).catch((error: unknown) => {
        report({ operation, key, error });
      });
    }
  };
  return {
    opened: { storage, files: opened.files } satisfies OpenedStorage,
    committed: (report: (failure: CleanupFailure) => void) => remove(deferred, "delete", report),
    rolledBack: (report: (failure: CleanupFailure) => void) => remove(stored, "upload", report),
  };
}

export function createAuditService(
  persistence: Pick<Persistence, "transaction" | "audit">,
  options: AuditServiceOptions = {},
): AuditService {
  const profileOptions: ProfileServiceOptions =
    options.mediaAddress === undefined ? {} : { mediaAddress: options.mediaAddress };

  return {
    async write(write) {
      const provenance = AuditProvenanceSchema.nullable().safeParse(write.provenance);
      if (!provenance.success) {
        throw new DomainError("validation_failed", "The provenance label is not valid.", [
          {
            path: "provenance",
            message: `Use at most ${String(auditProvenanceMaxLength)} lower-case letters, digits and . _ : / -, starting with a letter.`,
          },
        ]);
      }
      const media = options.media;
      const files = media === undefined ? undefined : transactionalStorage(media.storage);
      const report = (failure: CleanupFailure) => {
        media?.onCleanupFailure(failure);
      };

      let result: Awaited<ReturnType<typeof write.run>>;
      try {
        result = await persistence.transaction(async (profile, roadmap, audit) => {
          await audit.serializeWrites();
          const content: ContentServices = {
            profile: createProfileService(profile, profileOptions),
            roadmap: createRoadmapService(roadmap, profileOptions),
            media:
              media === undefined || files === undefined
                ? unconfiguredMedia
                : createMediaService(profile, { ...media, storage: files.opened }),
          };

          const before = new Map<string | null, Record<string, unknown> | null>();
          for (const record of write.records) {
            if (!before.has(record)) {
              before.set(record, await snapshotOf(content, write.entity, record));
            }
          }
          const done = await write.run(content);
          const records = new Set([...write.records, ...(write.recordsOf?.(done) ?? [])]);

          const entries: AuditEntryInput[] = [];
          for (const record of records) {
            const was = before.get(record) ?? null;
            const now = await snapshotOf(content, write.entity, record);
            if (was === null && now === null) continue;
            entries.push({
              keyId: write.actor.keyId,
              operationId: write.operation.operationId,
              method: write.operation.method,
              route: write.operation.route,
              provenance: provenance.data,
              entity: write.entity,
              record,
              action: was === null ? "created" : now === null ? "deleted" : "updated",
              before: was,
              after: now,
            });
          }
          if (entries.length === 0) {
            throw new Error(
              `The audited write ${write.operation.operationId} changed no record it can name.`,
            );
          }
          await audit.recordChanges(entries);
          return done;
        });
      } catch (error) {
        await files?.rolledBack(report);
        throw error;
      }
      await files?.committed(report);
      return result;
    },

    async recentChanges() {
      const changes = await persistence.audit.listRecentChanges(recentChangesLimit);
      return changes.map((change) => ({
        id: change.id,
        occurredAt: change.occurredAt.toISOString(),
        actor: { keyId: change.keyId, keyName: change.keyName },
        operation: {
          operationId: change.operationId,
          method: change.method,
          route: change.route,
        },
        provenance: change.provenance,
        entity: change.entity as AuditEntity,
        record: change.record,
        action: change.action,
        before: change.before,
        after: change.after,
      }));
    },
  };
}
