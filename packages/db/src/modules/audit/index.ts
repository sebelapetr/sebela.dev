import type { Database } from "../../database.js";

/** One committed change of one content record, as the API audits it. */
export interface AuditEntryInput {
  /** The verified API key that made the change. */
  readonly keyId: string;
  readonly operationId: string;
  readonly method: "POST" | "PATCH" | "DELETE";
  /** The route's path template, such as `/v1/organizations/:slug`. */
  readonly route: string;
  /** The bounded label the caller stated, or `null`. */
  readonly provenance: string | null;
  readonly entity: string;
  /** The record's slug, date or identifier; `null` for the person. */
  readonly record: string | null;
  readonly action: "created" | "updated" | "deleted";
  /** The record's public read before the change; `null` when it did not exist. */
  readonly before: Record<string, unknown> | null;
  /** The record's public read after the change; `null` when it no longer exists. */
  readonly after: Record<string, unknown> | null;
}

/** A stored change with its order, time and the name of its key. */
export interface AuditEntryRecord extends AuditEntryInput {
  readonly id: number;
  readonly occurredAt: Date;
  readonly keyName: string;
}

/** The private audit of content changes, in its own `audit` schema. */
export interface AuditPersistence {
  /**
   * Stores the changes, all or none. Throws for a change the store refuses (an unknown key, an
   * unbounded label, a read or a change without a before or an after), so the caller's
   * transaction rolls back.
   */
  recordChanges(entries: readonly AuditEntryInput[]): Promise<void>;
  /** The newest changes first, at most `limit`. */
  listRecentChanges(limit: number): Promise<AuditEntryRecord[]>;
}

export function createAuditPersistence(db: Database): AuditPersistence {
  const notImplemented = () => Promise.reject(new Error(`Not implemented for ${typeof db}.`));
  return {
    recordChanges: notImplemented,
    listRecentChanges: notImplemented,
  };
}
