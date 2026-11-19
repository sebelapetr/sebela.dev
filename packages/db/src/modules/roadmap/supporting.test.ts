import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { readDatabaseConfig } from "../../config.js";
import { openConnection, type Connection } from "../../connection.js";
import { createTemporaryDatabase, type TemporaryDatabase } from "../../testing.js";
import { createProfilePersistence, type ProfilePersistence } from "../profile/index.js";
import { createRoadmapPersistence, type RoadmapPersistence } from "./index.js";

/** A fictional project idea with two topics. */
const assistant = {
  slug: "reading-assistant",
  title: "A fictional reading assistant",
  whyItMatters: "It practises **retrieval**.",
  howToStart: "Index three articles.",
  position: 1,
  topics: ["evals", "agents"],
};

/** A fictional followed source. */
const weekly = {
  slug: "example-weekly",
  title: "Example Weekly",
  description: "A *fictional* newsletter.",
  link: "https://example.com/weekly",
  kind: "newsletter",
  position: 0,
};

/** A fictional glossary term. */
const contextWindow = {
  slug: "context-window",
  term: "Context window",
  description: "How much text a model reads at once.",
  position: 0,
};

describe("roadmap supporting content persistence", () => {
  let database: TemporaryDatabase;
  let connection: Connection;
  let roadmap: RoadmapPersistence;
  let profile: ProfilePersistence;

  /** Counts every stored row of a roadmap table. */
  async function count(
    table: "project_ideas" | "project_idea_topics" | "followed_sources" | "glossary_terms",
  ) {
    const result = await connection.db.execute<{ count: string }>(
      sql`SELECT count(*) AS count FROM ${sql.identifier("ai_roadmap")}.${sql.identifier(table)}`,
    );
    return Number(result.rows[0]?.count);
  }

  beforeAll(async () => {
    database = await createTemporaryDatabase(readDatabaseConfig(process.env));
    connection = openConnection(database.config);
    roadmap = createRoadmapPersistence(connection.db);
    profile = createProfilePersistence(connection.db);
    for (const [position, slug] of ["agents", "evals", "unused"].entries()) {
      await profile.createTopic({ slug, name: slug, position });
    }
  });

  afterAll(async () => {
    await connection.close();
    await database.drop();
  });

  beforeEach(async () => {
    const table = (name: string) => sql`${sql.identifier("ai_roadmap")}.${sql.identifier(name)}`;
    await connection.db.execute(
      sql`TRUNCATE ${table("project_idea_topics")}, ${table("project_ideas")}, ${table("followed_sources")}, ${table("glossary_terms")}`,
    );
  });

  describe("project ideas", () => {
    it("creates an idea with its topics in link order and reads it back", async () => {
      const created = await roadmap.createRoadmapProjectIdea(assistant);
      expect(created).toMatchObject({
        ok: true,
        projectIdea: {
          slug: assistant.slug,
          title: assistant.title,
          whyItMatters: assistant.whyItMatters,
          howToStart: assistant.howToStart,
          position: 1,
          topics: [{ slug: "evals" }, { slug: "agents" }],
        },
      });
      if (!created.ok) throw new Error("The fixture idea was refused.");
      expect(created.projectIdea.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(created.projectIdea.createdAt).toBeInstanceOf(Date);
      await expect(roadmap.findRoadmapProjectIdea(assistant.slug)).resolves.toEqual(
        created.projectIdea,
      );
      await expect(roadmap.findRoadmapProjectIdea("missing")).resolves.toBeNull();
    });

    it("lists ideas by position, then slug", async () => {
      await roadmap.createRoadmapProjectIdea({ ...assistant, slug: "zeta", position: 0 });
      await roadmap.createRoadmapProjectIdea({ ...assistant, slug: "beta", position: 1 });
      await roadmap.createRoadmapProjectIdea({ ...assistant, slug: "alpha", position: 1 });
      const listed = await roadmap.listRoadmapProjectIdeas();
      expect(listed.map((idea) => idea.slug)).toEqual(["zeta", "alpha", "beta"]);
      expect(listed[1]?.topics.map((topic) => topic.slug)).toEqual(["evals", "agents"]);
    });

    it("refuses a taken slug, unknown and repeated topics and writes nothing", async () => {
      await roadmap.createRoadmapProjectIdea(assistant);
      await expect(roadmap.createRoadmapProjectIdea(assistant)).resolves.toEqual({
        ok: false,
        reason: "conflict",
      });
      await expect(
        roadmap.createRoadmapProjectIdea({
          ...assistant,
          slug: "other",
          topics: ["agents", "nope"],
        }),
      ).resolves.toEqual({ ok: false, reason: "unknown_topics", slugs: ["nope"] });
      await expect(
        roadmap.createRoadmapProjectIdea({
          ...assistant,
          slug: "other",
          topics: ["agents", "agents"],
        }),
      ).resolves.toEqual({ ok: false, reason: "repeated_topics" });
      expect(await count("project_ideas")).toBe(1);
      expect(await count("project_idea_topics")).toBe(2);
    });

    it("changes only the given fields, replaces topics and moves the update time", async () => {
      const created = await roadmap.createRoadmapProjectIdea(assistant);
      if (!created.ok) throw new Error("The fixture idea was refused.");
      const updated = await roadmap.updateRoadmapProjectIdea(assistant.slug, {
        howToStart: null,
        topics: ["unused"],
      });
      expect(updated).toMatchObject({
        ok: true,
        projectIdea: {
          title: assistant.title,
          howToStart: null,
          topics: [{ slug: "unused" }],
        },
      });
      if (!updated.ok) throw new Error("The update was refused.");
      expect(updated.projectIdea.updatedAt.getTime()).toBeGreaterThan(
        created.projectIdea.updatedAt.getTime(),
      );
      const kept = await roadmap.updateRoadmapProjectIdea(assistant.slug, { position: 5 });
      expect(kept).toMatchObject({ ok: true, projectIdea: { topics: [{ slug: "unused" }] } });
    });

    it("refuses an update of a missing idea or with unknown topics, changing nothing", async () => {
      await roadmap.createRoadmapProjectIdea(assistant);
      await expect(roadmap.updateRoadmapProjectIdea("missing", { position: 2 })).resolves.toEqual({
        ok: false,
        reason: "not_found",
      });
      await expect(
        roadmap.updateRoadmapProjectIdea(assistant.slug, { title: "Changed", topics: ["nope"] }),
      ).resolves.toEqual({ ok: false, reason: "unknown_topics", slugs: ["nope"] });
      await expect(roadmap.findRoadmapProjectIdea(assistant.slug)).resolves.toMatchObject({
        title: assistant.title,
        topics: [{ slug: "evals" }, { slug: "agents" }],
      });
    });

    it("deletes an idea with its topic links and keeps its topics", async () => {
      await roadmap.createRoadmapProjectIdea(assistant);
      await expect(profile.deleteTopic("evals")).resolves.toEqual({
        ok: false,
        reason: "referenced",
      });
      await expect(roadmap.deleteRoadmapProjectIdea(assistant.slug)).resolves.toEqual({ ok: true });
      await expect(roadmap.deleteRoadmapProjectIdea(assistant.slug)).resolves.toEqual({
        ok: false,
        reason: "not_found",
      });
      expect(await count("project_idea_topics")).toBe(0);
      await expect(profile.findTopic("evals")).resolves.not.toBeNull();
    });
  });

  describe("followed sources", () => {
    it("creates, finds, lists in order, updates and deletes a source", async () => {
      const created = await roadmap.createRoadmapFollowedSource(weekly);
      expect(created).toMatchObject({ ok: true, followedSource: weekly });
      await roadmap.createRoadmapFollowedSource({
        ...weekly,
        slug: "a-podcast",
        kind: "podcast",
        description: null,
        link: null,
        position: 0,
      });
      await roadmap.createRoadmapFollowedSource({ ...weekly, slug: "first", position: 0 });
      const listed = await roadmap.listRoadmapFollowedSources();
      expect(listed.map((source) => source.slug)).toEqual(["a-podcast", "example-weekly", "first"]);

      await expect(roadmap.createRoadmapFollowedSource(weekly)).resolves.toEqual({
        ok: false,
        reason: "conflict",
      });
      await expect(
        roadmap.updateRoadmapFollowedSource(weekly.slug, { link: null, kind: "blog" }),
      ).resolves.toMatchObject({
        ok: true,
        followedSource: { title: weekly.title, link: null, kind: "blog" },
      });
      await expect(
        roadmap.updateRoadmapFollowedSource("missing", { kind: "blog" }),
      ).resolves.toEqual({ ok: false, reason: "not_found" });
      await expect(roadmap.findRoadmapFollowedSource("missing")).resolves.toBeNull();
      await expect(roadmap.deleteRoadmapFollowedSource(weekly.slug)).resolves.toEqual({ ok: true });
      await expect(roadmap.deleteRoadmapFollowedSource(weekly.slug)).resolves.toEqual({
        ok: false,
        reason: "not_found",
      });
      expect(await count("followed_sources")).toBe(2);
    });
  });

  describe("glossary terms", () => {
    it("creates, finds, lists in order, updates and deletes a term", async () => {
      const created = await roadmap.createRoadmapGlossaryTerm(contextWindow);
      expect(created).toMatchObject({ ok: true, glossaryTerm: contextWindow });
      await roadmap.createRoadmapGlossaryTerm({ ...contextWindow, slug: "agent", position: 3 });
      await roadmap.createRoadmapGlossaryTerm({ ...contextWindow, slug: "beam", position: 0 });
      const listed = await roadmap.listRoadmapGlossaryTerms();
      expect(listed.map((term) => term.slug)).toEqual(["beam", "context-window", "agent"]);

      await expect(roadmap.createRoadmapGlossaryTerm(contextWindow)).resolves.toEqual({
        ok: false,
        reason: "conflict",
      });
      await expect(
        roadmap.updateRoadmapGlossaryTerm(contextWindow.slug, { term: "Context length" }),
      ).resolves.toMatchObject({
        ok: true,
        glossaryTerm: { term: "Context length", description: contextWindow.description },
      });
      await expect(roadmap.updateRoadmapGlossaryTerm("missing", { position: 1 })).resolves.toEqual({
        ok: false,
        reason: "not_found",
      });
      await expect(roadmap.findRoadmapGlossaryTerm(contextWindow.slug)).resolves.toMatchObject({
        term: "Context length",
      });
      await expect(roadmap.deleteRoadmapGlossaryTerm(contextWindow.slug)).resolves.toEqual({
        ok: true,
      });
      await expect(roadmap.deleteRoadmapGlossaryTerm(contextWindow.slug)).resolves.toEqual({
        ok: false,
        reason: "not_found",
      });
      expect(await count("glossary_terms")).toBe(2);
    });
  });

  it("refuses a negative position in the database", async () => {
    await expect(
      roadmap.createRoadmapGlossaryTerm({ ...contextWindow, position: -1 }),
    ).rejects.toThrow();
    await expect(
      roadmap.createRoadmapFollowedSource({ ...weekly, position: -1 }),
    ).rejects.toThrow();
    await expect(
      roadmap.createRoadmapProjectIdea({ ...assistant, position: -1 }),
    ).rejects.toThrow();
  });
});
