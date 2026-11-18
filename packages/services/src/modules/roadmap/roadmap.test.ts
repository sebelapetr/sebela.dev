import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  RoadmapAreaSchema,
  RoadmapModuleSchema,
  RoadmapResourceSchema,
  RoadmapSchema,
  type RoadmapAreaCreate,
  type RoadmapModuleCreate,
  type RoadmapResourceCreate,
} from "@sebela/contracts";
import { createPersistence, readDatabaseConfig, type Persistence } from "@sebela/db";
import { createTemporaryDatabase, type TemporaryDatabase } from "@sebela/db/testing";

import { DomainError } from "../../errors.js";
import { createProfileService, type ProfileService } from "../profile/index.js";
import { createRoadmapService, type RoadmapService } from "./index.js";

const foundations: RoadmapAreaCreate = {
  slug: "foundations",
  name: "Foundations",
  description: "A fictional area about the basics.",
  weight: 40,
  position: 0,
};

const prompting: RoadmapModuleCreate = {
  slug: "prompting",
  area: "foundations",
  name: "Prompting",
  description: null,
  position: 0,
};

const promptGuide: RoadmapResourceCreate = {
  slug: "prompt-guide",
  module: "prompting",
  name: "A fictional prompt guide",
  description: "Notes about writing prompts.",
  type: "text",
  status: "completed",
  estimatedMinutes: 90,
  startedAt: "2025-03-01T08:00:00.000Z",
  finishedAt: "2025-03-04T18:00:00.000Z",
  link: "https://example.com/prompt-guide",
  position: 0,
  topics: ["agents", "rag"],
};

describe("roadmap service", () => {
  let database: TemporaryDatabase;
  let persistence: Persistence;
  let profile: ProfileService;
  let roadmap: RoadmapService;

  beforeAll(async () => {
    database = await createTemporaryDatabase(readDatabaseConfig(process.env));
    persistence = createPersistence(database.config);
    profile = createProfileService(persistence.profile);
    roadmap = createRoadmapService(persistence.roadmap);
    for (const [position, slug] of ["agents", "rag", "mcp"].entries()) {
      await profile.createTopic({ slug, name: slug, position });
    }
  });

  afterAll(async () => {
    await persistence.close();
    await database.drop();
  });

  beforeEach(async () => {
    for (const area of await persistence.roadmap.loadRoadmapTree()) {
      for (const module of area.modules) {
        for (const resource of module.resources) {
          await persistence.roadmap.deleteRoadmapResource(resource.slug);
        }
        await persistence.roadmap.deleteRoadmapModule(module.slug);
      }
      await persistence.roadmap.deleteRoadmapArea(area.slug);
    }
  });

  async function createHierarchy() {
    const area = await roadmap.createArea(foundations);
    const module = await roadmap.createModule(prompting);
    const resource = await roadmap.createResource(promptGuide);
    return { area, module, resource };
  }

  describe("the whole roadmap", () => {
    it("is empty without areas", async () => {
      await expect(roadmap.getRoadmap()).resolves.toEqual({
        summary: {
          areaCount: 0,
          moduleCount: 0,
          resourceCount: 0,
          completed: 0,
          total: 0,
          estimatedMinutes: 0,
          estimatedHours: 0,
          lastUpdatedAt: null,
        },
        areas: [],
      });
    });

    it("returns the ordered tree with progress in the contract shape", async () => {
      const { area, module, resource } = await createHierarchy();
      await roadmap.createArea({
        ...foundations,
        slug: "agents-area",
        name: "Agents",
        position: 1,
      });
      await roadmap.createModule({ ...prompting, slug: "empty-module", position: 1 });
      const planned = await roadmap.createResource({
        ...promptGuide,
        slug: "later-reading",
        status: "planned",
        estimatedMinutes: null,
        startedAt: null,
        finishedAt: null,
        position: 1,
        topics: [],
      });

      const tree = await roadmap.getRoadmap();

      expect(RoadmapSchema.parse(tree)).toEqual(tree);
      expect(tree.summary).toEqual({
        areaCount: 2,
        moduleCount: 2,
        resourceCount: 2,
        completed: 1,
        total: 2,
        estimatedMinutes: 90,
        estimatedHours: 2,
        lastUpdatedAt: planned.updatedAt,
      });
      expect(tree.areas.map(({ slug }) => slug)).toEqual(["foundations", "agents-area"]);
      const [first, second] = tree.areas;
      expect(first).toMatchObject({ id: area.id, name: "Foundations", weight: 40 });
      expect(first?.progress).toEqual({
        completed: 1,
        total: 2,
        status: "planned",
        completedAt: null,
        lastUpdatedAt: planned.updatedAt,
        estimatedMinutes: 90,
      });
      expect(first?.modules.map(({ slug }) => slug)).toEqual(["prompting", "empty-module"]);
      expect(first?.modules[0]).toMatchObject({ id: module.id, name: "Prompting" });
      expect(first?.modules[0]).not.toHaveProperty("area");
      expect(first?.modules[1]?.progress).toMatchObject({ completed: 0, total: 0 });
      const resources = first?.modules[0]?.resources ?? [];
      expect(resources.map(({ slug }) => slug)).toEqual(["prompt-guide", "later-reading"]);
      expect(resources[0]).not.toHaveProperty("module");
      expect(resources[0]?.topics.map(({ slug }) => slug)).toEqual(["agents", "rag"]);
      expect(resources[0]).toMatchObject({
        id: resource.id,
        finishedAt: promptGuide.finishedAt,
        updatedAt: resource.updatedAt,
      });
      expect(second).toMatchObject({ modules: [], progress: { total: 0, status: "planned" } });
    });

    it("derives a dated completion once every resource is completed or skipped", async () => {
      await createHierarchy();
      await roadmap.createResource({
        ...promptGuide,
        slug: "skipped-talk",
        status: "skipped",
        finishedAt: null,
        topics: [],
      });

      const [area] = (await roadmap.getRoadmap()).areas;

      expect(area?.progress).toMatchObject({
        completed: 1,
        total: 2,
        status: "completed",
        completedAt: promptGuide.finishedAt,
      });
      expect(area?.modules[0]?.progress.completedAt).toBe(promptGuide.finishedAt);
    });
  });

  describe("areas", () => {
    it("creates, reads, updates and deletes an area in the contract shape", async () => {
      const created = await roadmap.createArea(foundations);
      expect(RoadmapAreaSchema.parse(created)).toEqual(created);
      expect(created).toMatchObject(foundations);
      await expect(roadmap.getArea("foundations")).resolves.toEqual(created);

      const updated = await roadmap.updateArea("foundations", { weight: 10, name: undefined });
      expect(updated).toMatchObject({ weight: 10, name: "Foundations", id: created.id });

      await roadmap.deleteArea("foundations");
      await expect(roadmap.getArea("foundations")).rejects.toMatchObject({ code: "not_found" });
    });

    it("refuses a taken slug as a conflict", async () => {
      await roadmap.createArea(foundations);
      await expect(roadmap.createArea(foundations)).rejects.toMatchObject({ code: "conflict" });
    });

    it("refuses a reserved slug on the slug field", async () => {
      await expect(roadmap.createArea({ ...foundations, slug: "bookshelf" })).rejects.toMatchObject(
        { code: "validation_failed", fields: [{ path: "slug" }] },
      );
    });

    it("refuses to delete an area that still has modules", async () => {
      await createHierarchy();
      await expect(roadmap.deleteArea("foundations")).rejects.toMatchObject({ code: "conflict" });
      await expect(roadmap.getArea("foundations")).resolves.toMatchObject({ slug: "foundations" });
    });

    it("reports unknown slugs as not found", async () => {
      await expect(roadmap.getArea("missing")).rejects.toBeInstanceOf(DomainError);
      await expect(roadmap.updateArea("missing", { weight: 5 })).rejects.toMatchObject({
        code: "not_found",
      });
      await expect(roadmap.deleteArea("missing")).rejects.toMatchObject({ code: "not_found" });
    });
  });

  describe("modules", () => {
    it("creates, moves and deletes a module in the contract shape", async () => {
      await roadmap.createArea(foundations);
      await roadmap.createArea({ ...foundations, slug: "tooling", position: 1 });
      const created = await roadmap.createModule(prompting);
      expect(RoadmapModuleSchema.parse(created)).toEqual(created);
      expect(created).toMatchObject(prompting);
      await expect(roadmap.getModule("prompting")).resolves.toEqual(created);

      const moved = await roadmap.updateModule("prompting", { area: "tooling" });
      expect(moved).toMatchObject({ area: "tooling", id: created.id });

      await roadmap.deleteModule("prompting");
      await expect(roadmap.getModule("prompting")).rejects.toMatchObject({ code: "not_found" });
    });

    it("refuses an unknown area on the area field", async () => {
      await expect(roadmap.createModule(prompting)).rejects.toMatchObject({
        code: "validation_failed",
        fields: [{ path: "area" }],
      });
      await roadmap.createArea(foundations);
      await roadmap.createModule(prompting);
      await expect(roadmap.updateModule("prompting", { area: "nowhere" })).rejects.toMatchObject({
        code: "validation_failed",
        fields: [{ path: "area" }],
      });
    });

    it("refuses a taken slug and a delete while it has resources as conflicts", async () => {
      await createHierarchy();
      await expect(roadmap.createModule(prompting)).rejects.toMatchObject({ code: "conflict" });
      await expect(roadmap.deleteModule("prompting")).rejects.toMatchObject({ code: "conflict" });
    });

    it("reports unknown slugs as not found", async () => {
      await expect(roadmap.getModule("missing")).rejects.toMatchObject({ code: "not_found" });
      await expect(roadmap.updateModule("missing", { position: 3 })).rejects.toMatchObject({
        code: "not_found",
      });
      await expect(roadmap.deleteModule("missing")).rejects.toMatchObject({ code: "not_found" });
    });
  });

  describe("resources", () => {
    it("creates, updates and deletes a resource in the contract shape", async () => {
      const { resource } = await createHierarchy();
      expect(RoadmapResourceSchema.parse(resource)).toEqual(resource);
      const { topics, ...fields } = promptGuide;
      expect(resource).toMatchObject(fields);
      expect(resource.topics.map(({ slug }) => slug)).toEqual(topics);
      await expect(roadmap.getResource("prompt-guide")).resolves.toEqual(resource);

      await roadmap.createModule({ ...prompting, slug: "retrieval", position: 1 });
      const updated = await roadmap.updateResource("prompt-guide", {
        module: "retrieval",
        status: "in-progress",
        finishedAt: null,
        topics: ["mcp"],
        name: undefined,
      });
      expect(updated).toMatchObject({
        module: "retrieval",
        status: "in-progress",
        finishedAt: null,
        name: promptGuide.name,
      });
      expect(updated.topics.map(({ slug }) => slug)).toEqual(["mcp"]);

      await roadmap.deleteResource("prompt-guide");
      await expect(roadmap.getResource("prompt-guide")).rejects.toMatchObject({
        code: "not_found",
      });
    });

    const refusals: [string, Partial<RoadmapResourceCreate>, string, string][] = [
      ["an unknown module", { module: "nowhere" }, "module", "nowhere"],
      ["unknown topics", { topics: ["agents", "quantum", "cobol"] }, "topics", "quantum, cobol"],
      ["a repeated topic", { topics: ["mcp", "mcp"] }, "topics", "once"],
      [
        "a finish before the start",
        { finishedAt: "2020-01-01T00:00:00.000Z" },
        "finishedAt",
        "start",
      ],
    ];

    it.each(refusals)("refuses a create with %s as invalid", async (_, change, path, text) => {
      await roadmap.createArea(foundations);
      await roadmap.createModule(prompting);
      await expect(roadmap.createResource({ ...promptGuide, ...change })).rejects.toMatchObject({
        code: "validation_failed",
        fields: [{ path, message: expect.stringContaining(text) as unknown }],
      });
      await expect(roadmap.getResource("prompt-guide")).rejects.toMatchObject({
        code: "not_found",
      });
    });

    it.each(refusals)("refuses an update with %s and changes nothing", async (_, change, path) => {
      const { resource } = await createHierarchy();
      await expect(
        roadmap.updateResource("prompt-guide", { name: "Changed", ...change }),
      ).rejects.toMatchObject({ code: "validation_failed", fields: [{ path }] });
      await expect(roadmap.getResource("prompt-guide")).resolves.toEqual(resource);
    });

    it("refuses a taken slug as a conflict", async () => {
      await createHierarchy();
      await expect(roadmap.createResource(promptGuide)).rejects.toMatchObject({
        code: "conflict",
      });
    });

    it("reports unknown slugs as not found", async () => {
      await expect(roadmap.getResource("missing")).rejects.toMatchObject({ code: "not_found" });
      await expect(roadmap.updateResource("missing", { position: 1 })).rejects.toMatchObject({
        code: "not_found",
      });
      await expect(roadmap.deleteResource("missing")).rejects.toMatchObject({
        code: "not_found",
      });
    });

    it("keeps a topic linked to a resource from being deleted", async () => {
      await createHierarchy();
      await expect(profile.deleteTopic("agents")).rejects.toMatchObject({ code: "conflict" });
    });
  });
});
