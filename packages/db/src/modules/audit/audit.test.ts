import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { readDatabaseConfig } from "../../config.js";
import { openConnection, type Connection } from "../../connection.js";
import { createTemporaryDatabase, type TemporaryDatabase } from "../../testing.js";
import { createApiKeyPersistence, type ApiKeyMetadata } from "../api-keys/index.js";
import { createAuditPersistence, type AuditEntryInput, type AuditPersistence } from "./index.js";

describe("audit persistence", () => {
  let database: TemporaryDatabase;
  let connection: Connection;
  let audit: AuditPersistence;
  let key: ApiKeyMetadata;

  const entry = (overrides: Partial<AuditEntryInput> = {}): AuditEntryInput => ({
    keyId: key.id,
    operationId: "updateOrganization",
    method: "PATCH",
    route: "/v1/organizations/:slug",
    provenance: "mcp-admin/update_content",
    entity: "organization",
    record: "northwind",
    action: "updated",
    before: { slug: "northwind", name: "Northwind" },
    after: { slug: "northwind", name: "Northwind Fictional" },
    ...overrides,
  });

  beforeAll(async () => {
    database = await createTemporaryDatabase(readDatabaseConfig(process.env));
    connection = openConnection(database.config);
    audit = createAuditPersistence(connection.db);
    key = await createApiKeyPersistence(connection.db).insertKey({
      name: "fixture-admin",
      publicId: "pubaudit",
      secretHash: "hash",
    });
  });

  beforeEach(async () => {
    await connection.db.execute("TRUNCATE audit.content_changes");
  });

  afterAll(async () => {
    await connection.close();
    await database.drop();
  });

  it("stores changes and lists them newest first with the key's name", async () => {
    await audit.recordChanges([entry()]);
    await audit.recordChanges([
      entry({ record: "contoso", action: "created", before: null }),
      entry({ entity: "person", record: null, action: "deleted", after: null, provenance: null }),
    ]);

    const listed = await audit.listRecentChanges(10);

    expect(listed.map((change) => [change.entity, change.record, change.action])).toEqual([
      ["person", null, "deleted"],
      ["organization", "contoso", "created"],
      ["organization", "northwind", "updated"],
    ]);
    expect(listed[2]).toMatchObject({
      ...entry(),
      keyName: "fixture-admin",
    });
    expect(listed[2]?.occurredAt).toBeInstanceOf(Date);
    expect(listed[0]?.id).toBeGreaterThan(listed[1]?.id ?? Infinity);
  });

  it("returns at most the requested number of changes", async () => {
    await audit.recordChanges(
      Array.from({ length: 5 }, (_, index) => entry({ record: `org-${String(index)}` })),
    );

    const listed = await audit.listRecentChanges(3);

    expect(listed.map((change) => change.record)).toEqual(["org-4", "org-3", "org-2"]);
  });

  it("refuses a change by a key that does not exist and stores nothing of the batch", async () => {
    await expect(
      audit.recordChanges([entry(), entry({ keyId: randomUUID(), record: "contoso" })]),
    ).rejects.toThrow();

    await expect(audit.listRecentChanges(10)).resolves.toEqual([]);
  });

  it.each([
    ["an unbounded provenance label", { provenance: "a".repeat(65) }],
    ["a read", { method: "GET" as unknown as AuditEntryInput["method"] }],
    ["an unknown action", { action: "read" as unknown as AuditEntryInput["action"] }],
    ["a change without before and after", { before: null, after: null }],
  ])("refuses %s", async (_, overrides) => {
    await expect(audit.recordChanges([entry(overrides)])).rejects.toThrow();

    await expect(audit.listRecentChanges(10)).resolves.toEqual([]);
  });
});
