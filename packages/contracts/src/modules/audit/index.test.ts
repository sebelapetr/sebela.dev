import { describe, expect, it } from "vitest";

import { contentDomains } from "../invalidation/index.js";
import {
  AuditChangeSchema,
  AuditProvenanceSchema,
  RecentChangesSchema,
  auditEntities,
  auditProvenanceHeader,
  auditProvenanceMaxLength,
  recentChangesLimit,
  type AuditChange,
} from "./index.js";

// Fictional records and identifiers only.
const KEY = "2f1e0d3c-4b5a-4968-8776-655443322110";

const change: AuditChange = {
  id: 7,
  occurredAt: "2026-05-04T10:00:00.000Z",
  actor: { keyId: KEY, keyName: "mcp-admin" },
  operation: {
    operationId: "updateExperience",
    method: "PATCH",
    route: "/v1/experiences/:slug",
  },
  provenance: "mcp-admin/update_content",
  entity: "experience",
  record: "northwind-lead",
  action: "updated",
  before: { slug: "northwind-lead", summary: "Old." },
  after: { slug: "northwind-lead", summary: "New." },
};

describe("audit contract", () => {
  it("audits every content domain and the time entries of the diary", () => {
    expect([...auditEntities]).toEqual([...contentDomains, "roadmap-time-entry"]);
  });

  it("names the provenance header in lower case and bounds the label", () => {
    expect(auditProvenanceHeader).toBe("sebela-provenance");
    expect(auditProvenanceMaxLength).toBe(64);
  });

  it.each(["mcp-admin", "mcp-admin/update_content", "cli.seed:v1", "a"])(
    "accepts the short label %s",
    (label) => {
      expect(AuditProvenanceSchema.safeParse(label).success).toBe(true);
    },
  );

  it.each([
    "",
    "Mcp-Admin",
    "mcp admin",
    "-mcp",
    "mcp\nadmin",
    "a".repeat(65),
    "Bearer sebela_0123456789abcdef_x",
    "mcp-admin;drop",
  ])("refuses the label %j", (label) => {
    expect(AuditProvenanceSchema.safeParse(label).success).toBe(false);
  });

  it("describes one audited change with its verified actor and before and after", () => {
    expect(AuditChangeSchema.parse(change)).toEqual(change);
    expect(AuditChangeSchema.parse({ ...change, entity: "person", record: null })).toMatchObject({
      record: null,
    });
    expect(
      AuditChangeSchema.parse({ ...change, action: "created", before: null, provenance: null }),
    ).toMatchObject({ before: null, provenance: null });
  });

  it("refuses unknown entities, actions, methods and extra fields", () => {
    expect(AuditChangeSchema.safeParse({ ...change, entity: "api-key" }).success).toBe(false);
    expect(AuditChangeSchema.safeParse({ ...change, action: "read" }).success).toBe(false);
    expect(
      AuditChangeSchema.safeParse({ ...change, operation: { ...change.operation, method: "GET" } })
        .success,
    ).toBe(false);
    expect(AuditChangeSchema.safeParse({ ...change, authorization: "x" }).success).toBe(false);
    expect(
      AuditChangeSchema.safeParse({ ...change, actor: { ...change.actor, secretHash: "x" } })
        .success,
    ).toBe(false);
  });

  it("bounds the recent changes", () => {
    expect(recentChangesLimit).toBe(20);
    const full = Array.from({ length: recentChangesLimit }, (_, index) => ({
      ...change,
      id: index + 1,
    }));
    expect(RecentChangesSchema.parse({ changes: full }).changes).toHaveLength(recentChangesLimit);
    expect(
      RecentChangesSchema.safeParse({ changes: [...full, { ...change, id: 99 }] }).success,
    ).toBe(false);
  });
});
