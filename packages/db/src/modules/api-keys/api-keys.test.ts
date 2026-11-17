import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readDatabaseConfig } from "../../config.js";
import { openConnection, type Connection } from "../../connection.js";
import { createTemporaryDatabase, type TemporaryDatabase } from "../../testing.js";
import { createApiKeyPersistence, type ApiKeyPersistence } from "./index.js";

describe("API-key persistence", () => {
  let database: TemporaryDatabase;
  let connection: Connection;
  let apiKeys: ApiKeyPersistence;

  beforeAll(async () => {
    database = await createTemporaryDatabase(readDatabaseConfig(process.env));
    connection = openConnection(database.config);
    apiKeys = createApiKeyPersistence(connection.db);
  });

  afterAll(async () => {
    await connection.close();
    await database.drop();
  });

  it("stores keys with the same name side by side and lists metadata only", async () => {
    const first = await apiKeys.insertKey({
      name: "laptop",
      publicId: "pub1",
      secretHash: "hash1",
    });
    const second = await apiKeys.insertKey({
      name: "laptop",
      publicId: "pub2",
      secretHash: "hash2",
    });

    const listed = await apiKeys.listKeys();

    expect(listed.map((key) => key.id)).toEqual([first.id, second.id]);
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

  it("finds the credential by public id", async () => {
    const key = await apiKeys.insertKey({
      name: "ci",
      publicId: "pub3",
      secretHash: "hash3",
    });

    await expect(apiKeys.findCredential("pub3")).resolves.toEqual({
      id: key.id,
      secretHash: "hash3",
      revokedAt: null,
    });
    await expect(apiKeys.findCredential("unknown")).resolves.toBeNull();
  });

  it("records the last use", async () => {
    const key = await apiKeys.insertKey({
      name: "use",
      publicId: "pub4",
      secretHash: "hash4",
    });
    const at = new Date("2030-01-01T00:00:00.000Z");

    await apiKeys.markUsed(key.id, at);

    const listed = await apiKeys.listKeys();
    expect(listed.find((entry) => entry.id === key.id)?.lastUsedAt).toEqual(at);
  });

  it("revokes a key once and keeps the first revocation time", async () => {
    const key = await apiKeys.insertKey({
      name: "old",
      publicId: "pub5",
      secretHash: "hash5",
    });

    const revoked = await apiKeys.revokeKey(key.id);
    const again = await apiKeys.revokeKey(key.id);

    expect(revoked?.revokedAt).toBeInstanceOf(Date);
    expect(again?.revokedAt).toEqual(revoked?.revokedAt);
    const credential = await apiKeys.findCredential("pub5");
    expect(credential?.revokedAt).toEqual(revoked?.revokedAt);
  });

  it("revokes nothing for an unknown id", async () => {
    await expect(apiKeys.revokeKey(randomUUID())).resolves.toBeNull();
  });
});
