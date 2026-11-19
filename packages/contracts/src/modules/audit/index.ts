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

/** Not implemented yet. */
export const AuditProvenanceSchema = z.custom<string>(() => false);

/** Not implemented yet. */
export const AuditChangeSchema = z.custom<AuditChange>(() => false).meta({ id: "AuditChange" });

/** Not implemented yet. */
export const RecentChangesSchema = z
  .custom<RecentChanges>(() => false)
  .meta({ id: "RecentChanges" });

export type AuditEntity = (typeof auditEntities)[number];
export interface AuditChange {
  id: number;
  occurredAt: string;
  actor: { keyId: string; keyName: string };
  operation: { operationId: string; method: "POST" | "PATCH" | "DELETE"; route: string };
  provenance: string | null;
  entity: AuditEntity;
  record: string | null;
  action: (typeof contentChangeActions)[number];
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}
export interface RecentChanges {
  changes: AuditChange[];
}
