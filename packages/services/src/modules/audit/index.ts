// The audited content write: one transaction that runs a content operation, reads every record it
// names before and after, and stores who changed what. Content and its audit commit together or not
// at all. It hides the transaction, the snapshot reads per entity, the serialization of audited
// writes and the media file compensation.
import type { AuditChange, AuditEntity } from "@sebela/contracts";
import type { Persistence } from "@sebela/db";

import type { MediaService, MediaServiceOptions } from "../media/index.js";
import type { ProfileService, ProfileServiceOptions } from "../profile/index.js";
import type { RoadmapService } from "../roadmap/index.js";

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

export function createAuditService(
  persistence: Pick<Persistence, "transaction" | "audit">,
  options: AuditServiceOptions = {},
): AuditService {
  const notImplemented = () =>
    Promise.reject(new Error(`Not implemented for ${typeof persistence}, ${typeof options}.`));
  return { write: notImplemented, recentChanges: notImplemented };
}
