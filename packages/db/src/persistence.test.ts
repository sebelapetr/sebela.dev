import { randomUUID } from "node:crypto";

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

  it("gives the work roadmap persistence in the same transaction", async () => {
    await expect(
      persistence.transaction(async (profile, roadmap) => {
        await profile.createTopic({ slug: "rag", name: "RAG", position: 4 });
        await roadmap.createRoadmapArea({
          slug: "basics",
          name: "Basics",
          description: null,
          weight: 20,
          position: 0,
        });
        await roadmap.createRoadmapModule({
          slug: "retrieval",
          area: "basics",
          name: "Retrieval",
          description: null,
          position: 0,
        });
        throw new Error("A fictional failure.");
      }),
    ).rejects.toThrow("A fictional failure.");

    await expect(persistence.roadmap.findRoadmapArea("basics")).resolves.toBeNull();
    await expect(persistence.roadmap.findRoadmapModule("retrieval")).resolves.toBeNull();
    await expect(persistence.profile.findTopic("rag")).resolves.toBeNull();
  });

  it("gives the work audit persistence, so a refused audit entry rolls the content back", async () => {
    const key = await persistence.apiKeys.insertKey({
      name: "fixture-admin",
      publicId: "pubtransaction",
      secretHash: "hash",
    });
    const change = {
      keyId: key.id,
      operationId: "createTopic",
      method: "POST",
      route: "/v1/topics",
      provenance: null,
      entity: "topic",
      record: "audited",
      action: "created",
      before: null,
      after: { slug: "audited" },
    } as const;

    await persistence.transaction(async (profile, _roadmap, audit) => {
      await profile.createTopic({ slug: "audited", name: "Audited", position: 5 });
      await audit.recordChanges([change]);
    });
    await expect(
      persistence.transaction(async (profile, _roadmap, audit) => {
        await profile.createTopic({ slug: "unaudited", name: "Unaudited", position: 6 });
        await audit.recordChanges([{ ...change, record: "unaudited", keyId: randomUUID() }]);
      }),
    ).rejects.toThrow();

    await expect(persistence.profile.findTopic("audited")).resolves.not.toBeNull();
    await expect(persistence.profile.findTopic("unaudited")).resolves.toBeNull();
    await expect(persistence.audit.listRecentChanges(10)).resolves.toMatchObject([
      { record: "audited", keyName: "fixture-admin" },
    ]);
  });
});
