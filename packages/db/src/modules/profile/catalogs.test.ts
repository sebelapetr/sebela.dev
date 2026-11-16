import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { readDatabaseConfig } from "../../config.js";
import { openConnection, type Connection } from "../../connection.js";
import { createTemporaryDatabase, type TemporaryDatabase } from "../../testing.js";
import {
  createProfilePersistence,
  type ProfilePersistence,
  type TechnologyFields,
  type TopicFields,
} from "./index.js";

const typescript: TechnologyFields & { slug: string } = {
  slug: "typescript",
  name: "TypeScript",
  tier: "primary",
  group: "core",
  logoKey: "typescript",
  position: 1,
};

const technology = (
  slug: string,
  fields: Partial<TechnologyFields> = {},
): TechnologyFields & { slug: string } => ({
  slug,
  name: slug,
  tier: "primary",
  group: "core",
  logoKey: null,
  position: 0,
  ...fields,
});

const topic = (slug: string, position: number): TopicFields & { slug: string } => ({
  slug,
  name: slug.toUpperCase(),
  position,
});

describe("catalog persistence", () => {
  let database: TemporaryDatabase;
  let connection: Connection;
  let profile: ProfilePersistence;

  beforeAll(async () => {
    database = await createTemporaryDatabase(readDatabaseConfig(process.env));
    connection = openConnection(database.config);
    profile = createProfilePersistence(connection.db);
  });

  afterAll(async () => {
    await connection.close();
    await database.drop();
  });

  beforeEach(async () => {
    for (const { slug } of await profile.listTechnologies()) await profile.deleteTechnology(slug);
    for (const { slug } of await profile.listTopics()) await profile.deleteTopic(slug);
  });

  describe("technologies", () => {
    it("lists nothing while the catalog is empty", async () => {
      await expect(profile.listTechnologies()).resolves.toEqual([]);
    });

    it("creates a technology and reads it back by slug", async () => {
      const created = await profile.createTechnology(typescript);

      expect(created).toMatchObject({ ok: true, technology: typescript });
      const found = await profile.findTechnology("typescript");
      expect(found).toMatchObject(typescript);
      expect(found?.id).toEqual(expect.any(String));
      expect(found?.createdAt).toBeInstanceOf(Date);
      expect(found?.updatedAt).toBeInstanceOf(Date);
    });

    it("finds nothing for an unknown slug", async () => {
      await expect(profile.findTechnology("missing")).resolves.toBeNull();
    });

    it("refuses a duplicate slug as a conflict, also for concurrent creates", async () => {
      const results = await Promise.all(
        Array.from({ length: 4 }, () => profile.createTechnology(typescript)),
      );

      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.filter((result) => !result.ok)).toEqual(
        Array.from({ length: 3 }, () => ({ ok: false, reason: "conflict" })),
      );
    });

    it.each([
      ["a primary technology without a group", { tier: "primary", group: null }],
      ["a secondary technology with a group", { tier: "secondary", group: "core" }],
    ] as const)("refuses %s as inconsistent", async (_, fields) => {
      await expect(profile.createTechnology(technology("go", fields))).resolves.toEqual({
        ok: false,
        reason: "inconsistent",
      });
      await expect(profile.findTechnology("go")).resolves.toBeNull();
    });

    it("refuses a negative position", async () => {
      await expect(profile.createTechnology(technology("go", { position: -1 }))).rejects.toThrow();
    });

    it("orders by tier, group, position and then slug", async () => {
      await profile.createTechnology(technology("bash", { tier: "secondary", group: null }));
      await profile.createTechnology(technology("rag", { group: "ai_engineering_focus" }));
      await profile.createTechnology(technology("zod", { position: 1 }));
      await profile.createTechnology(technology("react", { position: 2 }));
      await profile.createTechnology(technology("hono", { position: 1 }));
      await profile.createTechnology(technology("agents", { group: "ai_engineering_focus" }));

      const slugs = (await profile.listTechnologies()).map((record) => record.slug);

      expect(slugs).toEqual(["hono", "zod", "react", "agents", "rag", "bash"]);
    });

    it("updates given fields, keeps the slug, id and createdAt and advances updatedAt", async () => {
      const created = await profile.createTechnology(typescript);
      if (!created.ok) throw new Error("expected a technology");

      const updated = await profile.updateTechnology("typescript", {
        name: "TS",
        position: 7,
      });

      expect(updated).toMatchObject({
        ok: true,
        technology: { ...typescript, name: "TS", position: 7 },
      });
      if (!updated.ok) throw new Error("expected an update");
      expect(updated.technology.id).toBe(created.technology.id);
      expect(updated.technology.createdAt).toEqual(created.technology.createdAt);
      expect(updated.technology.updatedAt.getTime()).toBeGreaterThan(
        created.technology.updatedAt.getTime(),
      );
    });

    it("moves a technology between tiers when the group follows", async () => {
      await profile.createTechnology(typescript);

      await expect(
        profile.updateTechnology("typescript", { tier: "secondary", group: null }),
      ).resolves.toMatchObject({ ok: true, technology: { tier: "secondary", group: null } });
    });

    it("refuses an update that leaves tier and group inconsistent", async () => {
      await profile.createTechnology(typescript);

      await expect(profile.updateTechnology("typescript", { tier: "secondary" })).resolves.toEqual({
        ok: false,
        reason: "inconsistent",
      });
      await expect(profile.findTechnology("typescript")).resolves.toMatchObject({
        tier: "primary",
        group: "core",
      });
    });

    it("updates nothing for an unknown slug", async () => {
      await expect(profile.updateTechnology("missing", { position: 2 })).resolves.toEqual({
        ok: false,
        reason: "not_found",
      });
    });

    it("deletes a technology once", async () => {
      await profile.createTechnology(typescript);

      await expect(profile.deleteTechnology("typescript")).resolves.toBe(true);
      await expect(profile.deleteTechnology("typescript")).resolves.toBe(false);
      await expect(profile.findTechnology("typescript")).resolves.toBeNull();
    });
  });

  describe("topics", () => {
    it("lists nothing while the catalog is empty", async () => {
      await expect(profile.listTopics()).resolves.toEqual([]);
    });

    it("creates a topic and reads it back by slug", async () => {
      await expect(profile.createTopic(topic("mcp", 2))).resolves.toMatchObject({
        ok: true,
        topic: topic("mcp", 2),
      });
      const found = await profile.findTopic("mcp");
      expect(found).toMatchObject(topic("mcp", 2));
      expect(found?.createdAt).toBeInstanceOf(Date);
    });

    it("finds nothing for an unknown slug", async () => {
      await expect(profile.findTopic("missing")).resolves.toBeNull();
    });

    it("refuses a duplicate slug as a conflict, also for concurrent creates", async () => {
      const results = await Promise.all(
        Array.from({ length: 4 }, () => profile.createTopic(topic("rag", 0))),
      );

      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.filter((result) => !result.ok)).toEqual(
        Array.from({ length: 3 }, () => ({ ok: false, reason: "conflict" })),
      );
    });

    it("refuses a negative position", async () => {
      await expect(profile.createTopic(topic("rag", -1))).rejects.toThrow();
    });

    it("orders by position and then slug", async () => {
      await profile.createTopic(topic("rag", 1));
      await profile.createTopic(topic("mcp", 0));
      await profile.createTopic(topic("agents", 1));

      const slugs = (await profile.listTopics()).map((record) => record.slug);

      expect(slugs).toEqual(["mcp", "agents", "rag"]);
    });

    it("updates given fields, keeps the slug and advances updatedAt", async () => {
      const created = await profile.createTopic(topic("rag", 1));
      if (!created.ok) throw new Error("expected a topic");

      const updated = await profile.updateTopic("rag", { name: "Retrieval" });

      expect(updated).toMatchObject({ slug: "rag", name: "Retrieval", position: 1 });
      expect(updated?.id).toBe(created.topic.id);
      expect(updated?.updatedAt.getTime()).toBeGreaterThan(created.topic.updatedAt.getTime());
    });

    it("updates nothing for an unknown slug", async () => {
      await expect(profile.updateTopic("missing", { position: 2 })).resolves.toBeNull();
    });

    it("deletes a topic once", async () => {
      await profile.createTopic(topic("rag", 1));

      await expect(profile.deleteTopic("rag")).resolves.toBe(true);
      await expect(profile.deleteTopic("rag")).resolves.toBe(false);
      await expect(profile.findTopic("rag")).resolves.toBeNull();
    });
  });
});
