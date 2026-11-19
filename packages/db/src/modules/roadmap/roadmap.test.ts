import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { readDatabaseConfig } from "../../config.js";
import { openConnection, type Connection } from "../../connection.js";
import { createTemporaryDatabase, type TemporaryDatabase } from "../../testing.js";
import { createProfilePersistence, type ProfilePersistence } from "../profile/index.js";
import {
  createRoadmapPersistence,
  type RoadmapAreaFields,
  type RoadmapModuleFields,
  type RoadmapPersistence,
  type RoadmapResourceFields,
  type RoadmapResourceRelations,
} from "./index.js";

type AreaInput = RoadmapAreaFields & { slug: string };
type ModuleInput = RoadmapModuleFields & { slug: string; area: string };
type ResourceInput = RoadmapResourceFields & RoadmapResourceRelations & { slug: string };

/** Fictional roadmap records; the subject here is persistence integrity, not the demo seed. */
const area = (slug: string, position: number): AreaInput => ({
  slug,
  name: `Area ${slug}`,
  description: null,
  weight: 25,
  position,
});

const roadmapModule = (slug: string, areaSlug: string, position: number): ModuleInput => ({
  slug,
  area: areaSlug,
  name: `Module ${slug}`,
  description: "A fictional module.",
  position,
});

const resource = (slug: string, moduleSlug: string, position: number): ResourceInput => ({
  slug,
  module: moduleSlug,
  name: `Resource ${slug}`,
  description: null,
  type: "text",
  status: "planned",
  estimatedMinutes: null,
  startedAt: null,
  finishedAt: null,
  link: null,
  position,
  book: null,
  topics: [],
});

describe("roadmap persistence", () => {
  let database: TemporaryDatabase;
  let connection: Connection;
  let profile: ProfilePersistence;
  let roadmap: RoadmapPersistence;

  /** Counts every stored row of a roadmap table. */
  async function count(table: "areas" | "modules" | "resources" | "resource_topics") {
    const result = await connection.db.execute<{ count: string }>(
      sql`SELECT count(*) AS count FROM ${sql.identifier("ai_roadmap")}.${sql.identifier(table)}`,
    );
    return Number(result.rows[0]?.count);
  }

  beforeAll(async () => {
    database = await createTemporaryDatabase(readDatabaseConfig(process.env));
    connection = openConnection(database.config);
    profile = createProfilePersistence(connection.db);
    roadmap = createRoadmapPersistence(connection.db);
  });

  afterAll(async () => {
    await connection.close();
    await database.drop();
  });

  beforeEach(async () => {
    await connection.db.execute(
      sql`TRUNCATE ${sql.identifier("ai_roadmap")}.${sql.identifier("time_entries")}, ${sql.identifier("ai_roadmap")}.${sql.identifier("diary_entries")}, ${sql.identifier("ai_roadmap")}.${sql.identifier("resource_topics")}, ${sql.identifier("ai_roadmap")}.${sql.identifier("resources")}, ${sql.identifier("ai_roadmap")}.${sql.identifier("books")}, ${sql.identifier("ai_roadmap")}.${sql.identifier("modules")}, ${sql.identifier("ai_roadmap")}.${sql.identifier("areas")}`,
    );
    for (const { slug } of await profile.listTopics()) await profile.deleteTopic(slug);
    for (const [position, slug] of ["agents", "rag", "evals"].entries()) {
      await profile.createTopic({ slug, name: `Topic ${slug}`, position });
    }
  });

  describe("the tree", () => {
    it("is empty without areas", async () => {
      await expect(roadmap.loadRoadmapTree()).resolves.toEqual([]);
    });

    it("orders every level by position, then slug, and keeps empty containers", async () => {
      await roadmap.createRoadmapArea(area("tooling", 1));
      await roadmap.createRoadmapArea(area("basics", 0));
      await roadmap.createRoadmapArea(area("agents", 1));
      await roadmap.createRoadmapModule(roadmapModule("prompting", "basics", 2));
      await roadmap.createRoadmapModule(roadmapModule("embeddings", "basics", 1));
      await roadmap.createRoadmapModule(roadmapModule("empty", "basics", 1));
      await roadmap.createRoadmapResource(resource("notes", "prompting", 1));
      await roadmap.createRoadmapResource(resource("video", "prompting", 0));
      await roadmap.createRoadmapResource({
        ...resource("article", "prompting", 1),
        topics: ["evals", "agents"],
      });

      const tree = await roadmap.loadRoadmapTree();

      expect(tree.map((node) => node.slug)).toEqual(["basics", "agents", "tooling"]);
      const basics = tree[0];
      expect(basics?.modules.map((node) => node.slug)).toEqual([
        "embeddings",
        "empty",
        "prompting",
      ]);
      expect(basics?.modules[1]?.resources).toEqual([]);
      const prompting = basics?.modules[2];
      expect(prompting).toMatchObject({ area: "basics", name: "Module prompting" });
      expect(prompting?.resources.map((node) => node.slug)).toEqual(["video", "article", "notes"]);
      expect(prompting?.resources[1]?.topics.map((topic) => topic.slug)).toEqual([
        "evals",
        "agents",
      ]);
      expect(tree[1]?.modules).toEqual([]);
    });
  });

  describe("areas", () => {
    it("creates, finds, updates and deletes an area", async () => {
      const created = await roadmap.createRoadmapArea({ ...area("basics", 0), description: "Hi." });
      expect(created).toMatchObject({ ok: true, area: { slug: "basics", description: "Hi." } });

      const updated = await roadmap.updateRoadmapArea("basics", { weight: 60 });
      expect(updated).toMatchObject({ ok: true, area: { weight: 60, name: "Area basics" } });
      await expect(roadmap.findRoadmapArea("basics")).resolves.toMatchObject({ weight: 60 });

      await expect(roadmap.deleteRoadmapArea("basics")).resolves.toEqual({ ok: true });
      await expect(roadmap.findRoadmapArea("basics")).resolves.toBeNull();
    });

    it("refuses a taken slug and reports unknown areas", async () => {
      await roadmap.createRoadmapArea(area("basics", 0));
      await expect(roadmap.createRoadmapArea(area("basics", 1))).resolves.toEqual({
        ok: false,
        reason: "conflict",
      });
      await expect(roadmap.updateRoadmapArea("missing", { weight: 2 })).resolves.toEqual({
        ok: false,
        reason: "not_found",
      });
      await expect(roadmap.deleteRoadmapArea("missing")).resolves.toEqual({
        ok: false,
        reason: "not_found",
      });
      expect(await count("areas")).toBe(1);
    });

    it.each(["diary", "bookshelf", "events", "how-to-read-effectively"])(
      "refuses the reserved slug %s in the database itself",
      async (slug) => {
        await expect(roadmap.createRoadmapArea(area(slug, 0))).resolves.toEqual({
          ok: false,
          reason: "reserved_slug",
        });
        expect(await count("areas")).toBe(0);
      },
    );

    it("refuses deleting an area that still has modules", async () => {
      await roadmap.createRoadmapArea(area("basics", 0));
      await roadmap.createRoadmapModule(roadmapModule("prompting", "basics", 0));

      await expect(roadmap.deleteRoadmapArea("basics")).resolves.toEqual({
        ok: false,
        reason: "referenced",
      });
      expect(await count("modules")).toBe(1);
    });
  });

  describe("modules", () => {
    beforeEach(async () => {
      await roadmap.createRoadmapArea(area("basics", 0));
      await roadmap.createRoadmapArea(area("agents", 1));
    });

    it("creates a module in an area and moves it to another one", async () => {
      await expect(
        roadmap.createRoadmapModule(roadmapModule("prompting", "basics", 0)),
      ).resolves.toMatchObject({ ok: true, module: { slug: "prompting", area: "basics" } });

      await expect(
        roadmap.updateRoadmapModule("prompting", { area: "agents", name: "Moved" }),
      ).resolves.toMatchObject({ ok: true, module: { area: "agents", name: "Moved" } });
      await expect(roadmap.findRoadmapModule("prompting")).resolves.toMatchObject({
        area: "agents",
      });
    });

    it("refuses an unknown area, a taken slug and an unknown module", async () => {
      await expect(
        roadmap.createRoadmapModule(roadmapModule("prompting", "missing", 0)),
      ).resolves.toEqual({ ok: false, reason: "unknown_area" });
      await roadmap.createRoadmapModule(roadmapModule("prompting", "basics", 0));
      await expect(
        roadmap.createRoadmapModule(roadmapModule("prompting", "agents", 0)),
      ).resolves.toEqual({ ok: false, reason: "conflict" });
      await expect(roadmap.updateRoadmapModule("prompting", { area: "missing" })).resolves.toEqual({
        ok: false,
        reason: "unknown_area",
      });
      await expect(roadmap.updateRoadmapModule("missing", { position: 1 })).resolves.toEqual({
        ok: false,
        reason: "not_found",
      });
      await expect(roadmap.findRoadmapModule("prompting")).resolves.toMatchObject({
        area: "basics",
      });
    });

    it("refuses deleting a module that still has resources and deletes an empty one", async () => {
      await roadmap.createRoadmapModule(roadmapModule("prompting", "basics", 0));
      await roadmap.createRoadmapModule(roadmapModule("empty", "basics", 1));
      await roadmap.createRoadmapResource(resource("notes", "prompting", 0));

      await expect(roadmap.deleteRoadmapModule("prompting")).resolves.toEqual({
        ok: false,
        reason: "referenced",
      });
      await expect(roadmap.deleteRoadmapModule("empty")).resolves.toEqual({ ok: true });
      expect(await count("modules")).toBe(1);
      expect(await count("resources")).toBe(1);
    });
  });

  describe("resources", () => {
    beforeEach(async () => {
      await roadmap.createRoadmapArea(area("basics", 0));
      await roadmap.createRoadmapModule(roadmapModule("prompting", "basics", 0));
      await roadmap.createRoadmapModule(roadmapModule("retrieval", "basics", 1));
    });

    it("stores every field with its topic links", async () => {
      const startedAt = new Date("2026-01-01T08:00:00.000Z");
      const finishedAt = new Date("2026-01-03T09:30:00.000Z");
      const created = await roadmap.createRoadmapResource({
        ...resource("notes", "prompting", 0),
        description: "Fictional notes.",
        type: "youtube-video",
        status: "completed",
        estimatedMinutes: 45,
        startedAt,
        finishedAt,
        link: "https://example.com/notes",
        topics: ["rag", "agents"],
      });

      expect(created).toMatchObject({
        ok: true,
        resource: {
          slug: "notes",
          module: "prompting",
          type: "youtube-video",
          status: "completed",
          estimatedMinutes: 45,
          startedAt,
          finishedAt,
          link: "https://example.com/notes",
          topics: [{ slug: "rag" }, { slug: "agents" }],
        },
      });
      await expect(roadmap.findRoadmapResource("notes")).resolves.toMatchObject({
        description: "Fictional notes.",
      });
    });

    it("moves a resource, replaces its topics and advances its update time", async () => {
      await roadmap.createRoadmapResource({
        ...resource("notes", "prompting", 0),
        topics: ["rag"],
      });
      const before = await roadmap.findRoadmapResource("notes");

      const updated = await roadmap.updateRoadmapResource("notes", {
        module: "retrieval",
        status: "in-progress",
        topics: ["evals", "agents"],
      });

      expect(updated).toMatchObject({
        ok: true,
        resource: {
          module: "retrieval",
          status: "in-progress",
          topics: [{ slug: "evals" }, { slug: "agents" }],
        },
      });
      const after = await roadmap.findRoadmapResource("notes");
      expect(after?.updatedAt.getTime()).toBeGreaterThan(before?.updatedAt.getTime() ?? Infinity);
      expect(await count("resource_topics")).toBe(2);
    });

    it("refuses invalid references and stores nothing of a refused write", async () => {
      await expect(roadmap.createRoadmapResource(resource("notes", "missing", 0))).resolves.toEqual(
        { ok: false, reason: "unknown_module" },
      );
      await expect(
        roadmap.createRoadmapResource({
          ...resource("notes", "prompting", 0),
          topics: ["agents", "unknown"],
        }),
      ).resolves.toEqual({ ok: false, reason: "unknown_topics", slugs: ["unknown"] });
      expect(await count("resources")).toBe(0);
      expect(await count("resource_topics")).toBe(0);

      await roadmap.createRoadmapResource({
        ...resource("notes", "prompting", 0),
        topics: ["rag"],
      });
      await expect(
        roadmap.createRoadmapResource(resource("notes", "retrieval", 0)),
      ).resolves.toEqual({ ok: false, reason: "conflict" });
      await expect(
        roadmap.updateRoadmapResource("notes", { module: "missing", topics: [] }),
      ).resolves.toEqual({ ok: false, reason: "unknown_module" });
      await expect(roadmap.updateRoadmapResource("missing", { position: 1 })).resolves.toEqual({
        ok: false,
        reason: "not_found",
      });
      await expect(roadmap.findRoadmapResource("notes")).resolves.toMatchObject({
        module: "prompting",
        topics: [{ slug: "rag" }],
      });
    });

    it("refuses a finish before the start, also when only one of them changes", async () => {
      await roadmap.createRoadmapResource({
        ...resource("notes", "prompting", 0),
        startedAt: new Date("2026-02-01T00:00:00.000Z"),
      });

      await expect(
        roadmap.updateRoadmapResource("notes", {
          finishedAt: new Date("2026-01-31T23:59:59.000Z"),
        }),
      ).resolves.toEqual({ ok: false, reason: "invalid_period" });
      await expect(roadmap.findRoadmapResource("notes")).resolves.toMatchObject({
        finishedAt: null,
      });
    });

    it("deletes a resource with its topic links and keeps the topics", async () => {
      await roadmap.createRoadmapResource({
        ...resource("notes", "prompting", 0),
        topics: ["rag"],
      });

      await expect(roadmap.deleteRoadmapResource("notes")).resolves.toEqual({ ok: true });
      await expect(roadmap.deleteRoadmapResource("notes")).resolves.toEqual({
        ok: false,
        reason: "not_found",
      });
      expect(await count("resource_topics")).toBe(0);
      await expect(profile.findTopic("rag")).resolves.not.toBeNull();
    });

    it("keeps a topic that a resource links from being deleted", async () => {
      await roadmap.createRoadmapResource({
        ...resource("notes", "prompting", 0),
        topics: ["rag"],
      });

      await expect(profile.deleteTopic("rag")).resolves.toEqual({
        ok: false,
        reason: "referenced",
      });
      await expect(roadmap.findRoadmapResource("notes")).resolves.toMatchObject({
        topics: [{ slug: "rag" }],
      });
    });
  });
});
