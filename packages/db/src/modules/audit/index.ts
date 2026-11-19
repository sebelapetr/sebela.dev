import { desc, eq } from "drizzle-orm";

import type { Database } from "../../database.js";
import { apiKeys } from "../api-keys/index.js";
import { contentChanges } from "./schema.js";

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
  /**
   * Waits until no other audited write is running, then holds that position until the caller's
   * transaction ends, so the before and after an audited write reads are exactly its own. Call it
   * first inside the transaction; outside one it holds nothing.
   */
  serializeWrites(): Promise<void>;
  /** The newest changes first, at most `limit`. */
  listRecentChanges(limit: number): Promise<AuditEntryRecord[]>;
}

export function createAuditPersistence(db: Database): AuditPersistence {
  return {
    async recordChanges(entries) {
      if (entries.length === 0) return;
      await db.insert(contentChanges).values(
        entries.map((entry) => ({
          keyId: entry.keyId,
          operationId: entry.operationId,
          method: entry.method,
          route: entry.route,
          provenance: entry.provenance,
          entity: entry.entity,
          record: entry.record,
          action: entry.action,
          before: entry.before,
          after: entry.after,
        })),
      );
    },

    serializeWrites: () => Promise.reject(new Error("Not implemented.")),

    async listRecentChanges(limit) {
      const rows = await db
        .select({ change: contentChanges, keyName: apiKeys.name })
        .from(contentChanges)
        .innerJoin(apiKeys, eq(apiKeys.id, contentChanges.keyId))
        .orderBy(desc(contentChanges.id))
        .limit(limit);
      return rows.map(({ change, keyName }) => ({
        id: change.id,
        occurredAt: change.occurredAt,
        keyId: change.keyId,
        keyName,
        operationId: change.operationId,
        method: change.method as AuditEntryInput["method"],
        route: change.route,
        provenance: change.provenance,
        entity: change.entity,
        record: change.record,
        action: change.action as AuditEntryInput["action"],
        before: change.before,
        after: change.after,
      }));
    },
  };
}
