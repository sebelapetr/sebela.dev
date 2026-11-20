import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPersistence, readDatabaseConfig } from "@sebela/db";
import { createTemporaryDatabase, type TemporaryDatabase } from "@sebela/db/testing";

import { createHealthService } from "./index.js";

describe("health service", () => {
  let database: TemporaryDatabase;

  beforeAll(async () => {
    database = await createTemporaryDatabase(readDatabaseConfig(process.env));
  });

  afterAll(async () => {
    await database.drop();
  });

  it("reports a database that answers as reachable", async () => {
    const persistence = createPersistence(database.config);
    try {
      await expect(createHealthService(persistence).databaseReachable()).resolves.toBe(true);
    } finally {
      await persistence.close();
    }
  });

  it("reports a database that refuses the connection as unreachable, without throwing", async () => {
    const missing = `missing_${randomUUID().replaceAll("-", "")}`;
    const persistence = createPersistence({ ...database.config, name: missing });
    try {
      await expect(createHealthService(persistence).databaseReachable()).resolves.toBe(false);
    } finally {
      await persistence.close();
    }
  });

  it("reports a database that does not answer in time as unreachable", async () => {
    const hanging = { ping: () => new Promise<void>(() => undefined) };
    const health = createHealthService(hanging, { timeoutMs: 20 });

    await expect(health.databaseReachable()).resolves.toBe(false);
  });
});
