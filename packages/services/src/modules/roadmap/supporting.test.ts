import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  RoadmapFollowedSourceListSchema,
  RoadmapFollowedSourceSchema,
  RoadmapGlossaryTermListSchema,
  RoadmapGlossaryTermSchema,
  RoadmapProjectIdeaListSchema,
  RoadmapProjectIdeaSchema,
  type RoadmapFollowedSourceCreate,
  type RoadmapGlossaryTermCreate,
  type RoadmapProjectIdeaCreate,
} from "@sebela/contracts";
import { createPersistence, readDatabaseConfig, type Persistence } from "@sebela/db";
import { createTemporaryDatabase, type TemporaryDatabase } from "@sebela/db/testing";

import { createProfileService } from "../profile/index.js";
import { createRoadmapService, type RoadmapService } from "./index.js";

/** A fictional project idea with two shared topics. */
const assistant: RoadmapProjectIdeaCreate = {
  slug: "fictional-reading-assistant",
  title: "A fictional reading assistant",
  whyItMatters: "It practises **retrieval** on a small corpus.",
  howToStart: "Index three example articles.",
  topics: ["evals", "agents"],
  position: 1,
};

/** A fictional followed source. */
const weekly: RoadmapFollowedSourceCreate = {
  slug: "example-weekly",
  title: "Example Weekly",
  description: "A *fictional* newsletter.",
  link: "https://example.com/weekly",
  kind: "newsletter",
  position: 0,
};

/** A fictional glossary term. */
const contextWindow: RoadmapGlossaryTermCreate = {
  slug: "context-window",
  term: "Context window",
  description: "How much text a model reads at once.",
  position: 0,
};

describe("roadmap supporting content", () => {
  let database: TemporaryDatabase;
  let persistence: Persistence;
  let roadmap: RoadmapService;

  beforeAll(async () => {
    database = await createTemporaryDatabase(readDatabaseConfig(process.env));
    persistence = createPersistence(database.config);
    roadmap = createRoadmapService(persistence.roadmap);
    const profile = createProfileService(persistence.profile);
    for (const [position, slug] of ["agents", "evals"].entries()) {
      await profile.createTopic({ slug, name: slug, position });
    }
  });

  afterAll(async () => {
    await persistence.close();
    await database.drop();
  });

  describe("project ideas", () => {
    it("creates, reads and lists ideas as contract records in order", async () => {
      const created = await roadmap.createProjectIdea(assistant);
      expect(RoadmapProjectIdeaSchema.parse(created)).toEqual(created);
      expect(created).toMatchObject({
        slug: assistant.slug,
        howToStart: assistant.howToStart,
        topics: [{ slug: "evals" }, { slug: "agents" }],
      });
      await roadmap.createProjectIdea({ ...assistant, slug: "fictional-first", position: 0 });

      await expect(roadmap.getProjectIdea(assistant.slug)).resolves.toEqual(created);
      const listed = await roadmap.listProjectIdeas();
      expect(RoadmapProjectIdeaListSchema.parse(listed)).toEqual(listed);
      expect(listed.map((idea) => idea.slug)).toEqual(["fictional-first", assistant.slug]);
    });

    it("refuses a taken slug, an unknown topic and a missing idea", async () => {
      await expect(roadmap.createProjectIdea(assistant)).rejects.toMatchObject({
        code: "conflict",
      });
      await expect(
        roadmap.createProjectIdea({ ...assistant, slug: "fictional-other", topics: ["nope"] }),
      ).rejects.toMatchObject({
        code: "validation_failed",
        fields: [{ path: "topics" }],
      });
      await expect(
        roadmap.updateProjectIdea(assistant.slug, { topics: ["agents", "nope"] }),
      ).rejects.toMatchObject({ code: "validation_failed", fields: [{ path: "topics" }] });
      await expect(roadmap.getProjectIdea("missing")).rejects.toMatchObject({
        code: "not_found",
      });
      await expect(roadmap.updateProjectIdea("missing", { position: 3 })).rejects.toMatchObject({
        code: "not_found",
      });
      await expect(roadmap.deleteProjectIdea("missing")).rejects.toMatchObject({
        code: "not_found",
      });
    });

    it("changes only the given fields and deletes an idea", async () => {
      const updated = await roadmap.updateProjectIdea(assistant.slug, {
        howToStart: null,
        title: undefined,
        topics: ["agents"],
      });
      expect(updated).toMatchObject({
        title: assistant.title,
        howToStart: null,
        topics: [{ slug: "agents" }],
      });
      await roadmap.deleteProjectIdea(assistant.slug);
      await expect(roadmap.getProjectIdea(assistant.slug)).rejects.toMatchObject({
        code: "not_found",
      });
    });
  });

  describe("followed sources", () => {
    it("manages a source and reads it as a contract record", async () => {
      const created = await roadmap.createFollowedSource(weekly);
      expect(RoadmapFollowedSourceSchema.parse(created)).toEqual(created);
      await roadmap.createFollowedSource({ ...weekly, slug: "a-podcast", kind: "podcast" });
      const listed = await roadmap.listFollowedSources();
      expect(RoadmapFollowedSourceListSchema.parse(listed)).toEqual(listed);
      expect(listed.map((source) => source.slug)).toEqual(["a-podcast", weekly.slug]);

      await expect(roadmap.createFollowedSource(weekly)).rejects.toMatchObject({
        code: "conflict",
      });
      await expect(
        roadmap.updateFollowedSource(weekly.slug, { link: null, description: undefined }),
      ).resolves.toMatchObject({ link: null, description: weekly.description });
      await expect(roadmap.getFollowedSource(weekly.slug)).resolves.toMatchObject({ link: null });
      await expect(roadmap.updateFollowedSource("missing", { kind: "blog" })).rejects.toMatchObject(
        { code: "not_found" },
      );
      await roadmap.deleteFollowedSource(weekly.slug);
      await expect(roadmap.deleteFollowedSource(weekly.slug)).rejects.toMatchObject({
        code: "not_found",
      });
      await expect(roadmap.getFollowedSource(weekly.slug)).rejects.toMatchObject({
        code: "not_found",
      });
    });
  });

  describe("glossary terms", () => {
    it("manages a term and reads it as a contract record", async () => {
      const created = await roadmap.createGlossaryTerm(contextWindow);
      expect(RoadmapGlossaryTermSchema.parse(created)).toEqual(created);
      await roadmap.createGlossaryTerm({ ...contextWindow, slug: "agent", term: "Agent" });
      const listed = await roadmap.listGlossaryTerms();
      expect(RoadmapGlossaryTermListSchema.parse(listed)).toEqual(listed);
      expect(listed.map((term) => term.slug)).toEqual(["agent", contextWindow.slug]);

      await expect(roadmap.createGlossaryTerm(contextWindow)).rejects.toMatchObject({
        code: "conflict",
      });
      await expect(
        roadmap.updateGlossaryTerm(contextWindow.slug, { term: "Context length" }),
      ).resolves.toMatchObject({ term: "Context length" });
      await expect(roadmap.getGlossaryTerm(contextWindow.slug)).resolves.toMatchObject({
        term: "Context length",
      });
      await expect(roadmap.updateGlossaryTerm("missing", { position: 1 })).rejects.toMatchObject({
        code: "not_found",
      });
      await roadmap.deleteGlossaryTerm(contextWindow.slug);
      await expect(roadmap.deleteGlossaryTerm(contextWindow.slug)).rejects.toMatchObject({
        code: "not_found",
      });
    });
  });
});
