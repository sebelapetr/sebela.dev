import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  TechnologyListSchema,
  TechnologySchema,
  TopicListSchema,
  TopicSchema,
  type TechnologyCreate,
} from "@sebela/contracts";
import { createPersistence, readDatabaseConfig, type Persistence } from "@sebela/db";
import { createTemporaryDatabase, type TemporaryDatabase } from "@sebela/db/testing";

import { DomainError } from "../../errors.js";
import { createProfileService, type ProfileService } from "./index.js";

const typescript: TechnologyCreate = {
  slug: "typescript",
  name: "TypeScript",
  tier: "primary",
  group: "core",
  logoKey: "typescript",
  position: 1,
};

const bash: TechnologyCreate = {
  slug: "bash",
  name: "Bash",
  tier: "secondary",
  group: null,
  logoKey: null,
  position: 0,
};

describe("catalog service", () => {
  let database: TemporaryDatabase;
  let persistence: Persistence;
  let profile: ProfileService;

  beforeAll(async () => {
    database = await createTemporaryDatabase(readDatabaseConfig(process.env));
    persistence = createPersistence(database.config);
    profile = createProfileService(persistence.profile);
  });

  afterAll(async () => {
    await persistence.close();
    await database.drop();
  });

  beforeEach(async () => {
    for (const { slug } of await persistence.profile.listTechnologies()) {
      await persistence.profile.deleteTechnology(slug);
    }
    for (const { slug } of await persistence.profile.listTopics()) {
      await persistence.profile.deleteTopic(slug);
    }
  });

  describe("technologies", () => {
    it("lists an empty catalog", async () => {
      await expect(profile.listTechnologies()).resolves.toEqual([]);
    });

    it("creates technologies in the contract shape and lists them in catalog order", async () => {
      const secondary = await profile.createTechnology(bash);
      const primary = await profile.createTechnology(typescript);

      expect(TechnologySchema.parse(primary)).toEqual(primary);
      expect(primary).toMatchObject(typescript);
      const listed = await profile.listTechnologies();
      expect(TechnologyListSchema.parse(listed)).toEqual([primary, secondary]);
      await expect(profile.getTechnology("typescript")).resolves.toEqual(primary);
    });

    it("reports an unknown slug as not found", async () => {
      await expect(profile.getTechnology("missing")).rejects.toBeInstanceOf(DomainError);
      await expect(profile.getTechnology("missing")).rejects.toMatchObject({ code: "not_found" });
      await expect(profile.updateTechnology("missing", { position: 1 })).rejects.toMatchObject({
        code: "not_found",
      });
      await expect(profile.deleteTechnology("missing")).rejects.toMatchObject({
        code: "not_found",
      });
    });

    it("refuses a duplicate slug as a conflict", async () => {
      await profile.createTechnology(typescript);

      await expect(profile.createTechnology(typescript)).rejects.toMatchObject({
        code: "conflict",
      });
    });

    it("refuses a technology whose group disagrees with its tier", async () => {
      await expect(profile.createTechnology({ ...typescript, group: null })).rejects.toMatchObject({
        code: "validation_failed",
        fields: [{ path: "group", message: expect.any(String) as unknown }],
      });
    });

    it("changes only the given fields and keeps id, slug and createdAt", async () => {
      const created = await profile.createTechnology(typescript);

      const updated = await profile.updateTechnology("typescript", {
        name: "TS",
        logoKey: null,
        position: undefined,
      });

      expect(updated).toMatchObject({ ...typescript, name: "TS", logoKey: null });
      expect(updated.id).toBe(created.id);
      expect(updated.createdAt).toBe(created.createdAt);
      expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt));
    });

    it("refuses a change that leaves the group disagreeing with the tier", async () => {
      await profile.createTechnology(typescript);

      const refused = profile.updateTechnology("typescript", { tier: "secondary" });

      await expect(refused).rejects.toMatchObject({
        code: "validation_failed",
        fields: [{ path: "group", message: expect.any(String) as unknown }],
      });
      await expect(refused).rejects.toThrow(/group/);
      await expect(profile.getTechnology("typescript")).resolves.toMatchObject({ tier: "primary" });
    });

    it("deletes a technology", async () => {
      await profile.createTechnology(typescript);

      await profile.deleteTechnology("typescript");

      await expect(profile.getTechnology("typescript")).rejects.toMatchObject({
        code: "not_found",
      });
    });
  });

  describe("topics", () => {
    it("lists an empty catalog", async () => {
      await expect(profile.listTopics()).resolves.toEqual([]);
    });

    it("creates topics in the contract shape and lists them by position and slug", async () => {
      const rag = await profile.createTopic({ slug: "rag", name: "RAG", position: 1 });
      const agents = await profile.createTopic({ slug: "agents", name: "Agents", position: 1 });
      const mcp = await profile.createTopic({ slug: "mcp", name: "MCP", position: 0 });

      expect(TopicSchema.parse(rag)).toEqual(rag);
      const listed = await profile.listTopics();
      expect(TopicListSchema.parse(listed)).toEqual([mcp, agents, rag]);
      await expect(profile.getTopic("rag")).resolves.toEqual(rag);
    });

    it("reports an unknown slug as not found", async () => {
      await expect(profile.getTopic("missing")).rejects.toMatchObject({ code: "not_found" });
      await expect(profile.updateTopic("missing", { name: "X" })).rejects.toMatchObject({
        code: "not_found",
      });
      await expect(profile.deleteTopic("missing")).rejects.toMatchObject({ code: "not_found" });
    });

    it("refuses a duplicate slug as a conflict", async () => {
      await profile.createTopic({ slug: "rag", name: "RAG", position: 0 });

      await expect(
        profile.createTopic({ slug: "rag", name: "Again", position: 1 }),
      ).rejects.toMatchObject({ code: "conflict" });
    });

    it("changes only the given fields and advances updatedAt", async () => {
      const created = await profile.createTopic({ slug: "rag", name: "RAG", position: 0 });

      const updated = await profile.updateTopic("rag", { position: 4 });

      expect(updated).toMatchObject({ slug: "rag", name: "RAG", position: 4, id: created.id });
      expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt));
    });

    it("deletes a topic", async () => {
      await profile.createTopic({ slug: "rag", name: "RAG", position: 0 });

      await profile.deleteTopic("rag");

      await expect(profile.getTopic("rag")).rejects.toMatchObject({ code: "not_found" });
    });
  });
});
