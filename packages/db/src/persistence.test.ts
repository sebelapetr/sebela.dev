import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readDatabaseConfig } from "./config.js";
import { createPersistence, type Persistence } from "./persistence.js";
import { createTemporaryDatabase, type TemporaryDatabase } from "./testing.js";

const organization = {
  slug: "northwind",
  name: "Northwind Fictional",
  website: null,
  description: null,
};

describe("persistence transactions", () => {
  let database: TemporaryDatabase;
  let persistence: Persistence;

  beforeAll(async () => {
    database = await createTemporaryDatabase(readDatabaseConfig(process.env));
    persistence = createPersistence(database.config);
  });

  afterAll(async () => {
    await persistence.close();
    await database.drop();
  });

  it("commits the writes of work that resolves and returns its result", async () => {
    const result = await persistence.transaction(async (profile) => {
      await profile.createTopic({ slug: "agents", name: "Agents", position: 1 });
      // A write that opens its own transaction runs as a savepoint inside this one.
      await profile.createOrganization(organization);
      return "done";
    });

    expect(result).toBe("done");
    await expect(persistence.profile.findTopic("agents")).resolves.toMatchObject({
      name: "Agents",
    });
    await expect(persistence.profile.findOrganization("northwind")).resolves.toMatchObject({
      name: "Northwind Fictional",
    });
  });

  it("keeps its writes from other connections until it commits", async () => {
    let seenOutside: unknown = "unset";
    await persistence.transaction(async (profile) => {
      await profile.createTopic({ slug: "evals", name: "Evals", position: 2 });
      await expect(profile.findTopic("evals")).resolves.not.toBeNull();
      seenOutside = await persistence.profile.findTopic("evals");
    });

    expect(seenOutside).toBeNull();
    await expect(persistence.profile.findTopic("evals")).resolves.not.toBeNull();
  });

  it("rolls every write back, including nested transactional ones, when the work throws", async () => {
    await expect(
      persistence.transaction(async (profile) => {
        await profile.createTopic({ slug: "mcp", name: "MCP", position: 3 });
        await profile.createOrganization({ ...organization, slug: "contoso" });
        throw new Error("A fictional failure.");
      }),
    ).rejects.toThrow("A fictional failure.");

    await expect(persistence.profile.findTopic("mcp")).resolves.toBeNull();
    await expect(persistence.profile.findOrganization("contoso")).resolves.toBeNull();
  });
});
