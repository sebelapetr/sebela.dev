import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPersistence, readDatabaseConfig, type Persistence } from "@sebela/db";
import { createTemporaryDatabase, type TemporaryDatabase } from "@sebela/db/testing";

import { createApiKeyService, type ApiKeyService } from "./index.js";

describe("API-key service", () => {
  let database: TemporaryDatabase;
  let persistence: Persistence;
  let apiKeys: ApiKeyService;
  let now = new Date("2030-01-01T00:00:00.000Z");

  beforeAll(async () => {
    database = await createTemporaryDatabase(readDatabaseConfig(process.env));
    persistence = createPersistence(database.config);
    apiKeys = createApiKeyService(persistence.apiKeys, { now: () => now });
  });

  afterAll(async () => {
    await persistence.close();
    await database.drop();
  });

  it("creates a long random key with a recognisable prefix, shown only at creation", async () => {
    const first = await apiKeys.createKey("laptop");
    const second = await apiKeys.createKey("laptop");

    expect(first.key).toMatch(/^sebela_[0-9a-f]{16}_[A-Za-z0-9_-]{43}$/);
    expect(first.key).not.toBe(second.key);
    expect(first.metadata).toMatchObject({ name: "laptop", lastUsedAt: null, revokedAt: null });
    expect(JSON.stringify(first.metadata)).not.toContain(first.key.slice(7));
  });

  it("lists metadata of every key without any secret", async () => {
    const created = await apiKeys.createKey("ci");

    const listed = await apiKeys.listKeys();

    const entry = listed.find((key) => key.id === created.metadata.id);
    expect(entry).toEqual(created.metadata);
    const secret = created.key.split("_")[2] ?? "";
    expect(JSON.stringify(listed)).not.toContain(secret);
    for (const key of listed) {
      expect(Object.keys(key).sort()).toEqual([
        "createdAt",
        "id",
        "lastUsedAt",
        "name",
        "revokedAt",
      ]);
    }
  });

  it("verifies a valid key and records its use", async () => {
    const created = await apiKeys.createKey("agent");
    now = new Date("2030-01-02T00:00:00.000Z");

    await expect(apiKeys.verifyKey(created.key)).resolves.toEqual({
      ok: true,
      keyId: created.metadata.id,
    });

    const listed = await apiKeys.listKeys();
    expect(listed.find((key) => key.id === created.metadata.id)?.lastUsedAt).toBe(
      "2030-01-02T00:00:00.000Z",
    );
  });

  it("refuses missing, malformed, unknown and tampered keys alike", async () => {
    const created = await apiKeys.createKey("other");
    const [prefix, publicId, secret = ""] = created.key.split("_");
    const tampered = `${prefix ?? ""}_${publicId ?? ""}_${secret.slice(0, -1)}${secret.endsWith("A") ? "B" : "A"}`;
    const unknown = `sebela_${"0".repeat(16)}_${"A".repeat(43)}`;

    for (const presented of [undefined, "", "not-a-key", `${created.key}x`, tampered, unknown]) {
      await expect(apiKeys.verifyKey(presented)).resolves.toEqual({ ok: false });
    }
  });

  it("revokes one key so that its next verification fails, leaving the others valid", async () => {
    const revoked = await apiKeys.createKey("old");
    const kept = await apiKeys.createKey("new");

    const result = await apiKeys.revokeKey(revoked.metadata.id);

    expect(result.revokedAt).not.toBeNull();
    await expect(apiKeys.verifyKey(revoked.key)).resolves.toEqual({ ok: false });
    await expect(apiKeys.verifyKey(kept.key)).resolves.toMatchObject({ ok: true });
  });

  it("reports revoking an unknown or malformed id as not found", async () => {
    await expect(apiKeys.revokeKey("00000000-0000-4000-8000-000000000000")).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(apiKeys.revokeKey("nope")).rejects.toMatchObject({ code: "not_found" });
  });

  it("refuses an empty or overlong name", async () => {
    await expect(apiKeys.createKey("  ")).rejects.toMatchObject({ code: "validation_failed" });
    await expect(apiKeys.createKey("x".repeat(101))).rejects.toMatchObject({
      code: "validation_failed",
    });
  });
});
