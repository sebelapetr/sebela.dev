// The audit contract: which records the API audits, the bounded provenance label a server-side
// caller may attach to a write, and the shape of the recent changes an authenticated caller reads.
// The actor is never part of a request: the API takes it from the verified API key.
import { z } from "zod";

import { contentChangeActions, contentDomains } from "../invalidation/index.js";

/** What an audit entry can name: every content domain and the time entries of the diary. */
export const auditEntities = [...contentDomains, "roadmap-time-entry"] as const;

/** The request header that carries a write's provenance label, lower-case. */
export const auditProvenanceHeader = "sebela-provenance";

/** Longest provenance label, in characters. */
export const auditProvenanceMaxLength = 64;

/** Most changes one recent-changes read returns. */
export const recentChangesLimit = 20;

/**
 * A short label of the tool or client that made a write, such as `mcp-admin/update_content`: lower
 * case letters, digits and `.`, `_`, `:`, `/`, `-`, starting with a letter, at most
 * `auditProvenanceMaxLength` characters. It is provenance a caller states, never proof of who
 * acted or that a human approved.
 */
export const AuditProvenanceSchema = z
  .string()
  .max(auditProvenanceMaxLength)
  .regex(/^[a-z][a-z0-9._:/-]*$/);

/** A record as the public read of its entity returned it, or `null` when it did not exist. */
const Snapshot = z.record(z.string(), z.unknown()).nullable();

/**
 * One committed change of one record, written in the same transaction as the change. The actor is
 * the API key the API verified; its name is the key's name. `record` names the record as the
 * invalidation contract does (`null` for the person; a time entry by its UUID). `before` and
 * `after` are the record's public read before and after the write: `null` before a create and
 * after a delete.
 */
export const AuditChangeSchema = z
  .strictObject({
    id: z.int().positive(),
    occurredAt: z.iso.datetime(),
    actor: z.strictObject({ keyId: z.uuid(), keyName: z.string() }),
    operation: z.strictObject({
      operationId: z.string().min(1),
      method: z.enum(["POST", "PATCH", "DELETE"]),
      route: z.string().min(1),
    }),
    provenance: AuditProvenanceSchema.nullable(),
    entity: z.enum(auditEntities),
    record: z.string().nullable(),
    action: z.enum(contentChangeActions),
    before: Snapshot,
    after: Snapshot,
  })
  .meta({ id: "AuditChange" });

/** The newest audited changes, newest first, at most `recentChangesLimit`. */
export const RecentChangesSchema = z
  .strictObject({ changes: z.array(AuditChangeSchema).max(recentChangesLimit) })
  .meta({ id: "RecentChanges" });

export type AuditEntity = (typeof auditEntities)[number];
export type AuditChange = z.infer<typeof AuditChangeSchema>;
export type RecentChanges = z.infer<typeof RecentChangesSchema>;
