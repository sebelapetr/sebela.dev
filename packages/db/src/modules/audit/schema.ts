import { sql } from "drizzle-orm";
import { bigint, check, jsonb, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { apiKeys } from "../api-keys/index.js";

export const auditSchema = pgSchema("audit");

/**
 * Every committed content change, one row per changed record, written in the transaction of the
 * change itself. Private operational state: never content, never public. The actor is a real key;
 * keys are revoked, never deleted, so the reference has no cascade.
 */
export const contentChanges = auditSchema.table(
  "content_changes",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    keyId: uuid("key_id")
      .notNull()
      .references(() => apiKeys.id),
    operationId: text("operation_id").notNull(),
    method: text("method").notNull(),
    route: text("route").notNull(),
    provenance: text("provenance"),
    entity: text("entity").notNull(),
    record: text("record"),
    action: text("action").notNull(),
    before: jsonb("before").$type<Record<string, unknown>>(),
    after: jsonb("after").$type<Record<string, unknown>>(),
  },
  (table) => [
    check("content_changes_method_is_write", sql`${table.method} IN ('POST', 'PATCH', 'DELETE')`),
    check(
      "content_changes_action_known",
      sql`${table.action} IN ('created', 'updated', 'deleted')`,
    ),
    check(
      "content_changes_provenance_bounded",
      sql`${table.provenance} IS NULL OR char_length(${table.provenance}) BETWEEN 1 AND 64`,
    ),
    check(
      "content_changes_names_bounded",
      sql`char_length(${table.operationId}) BETWEEN 1 AND 100 AND char_length(${table.route}) BETWEEN 1 AND 200 AND char_length(${table.entity}) BETWEEN 1 AND 50 AND (${table.record} IS NULL OR char_length(${table.record}) BETWEEN 1 AND 200)`,
    ),
    check(
      "content_changes_has_state",
      sql`${table.before} IS NOT NULL OR ${table.after} IS NOT NULL`,
    ),
  ],
);
