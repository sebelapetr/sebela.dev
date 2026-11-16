import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  ExplorationListSchema,
  ExplorationSchema,
  explorationStatuses,
  type ExplorationCreate,
  type ExplorationUpdate,
} from "@sebela/contracts";
import { createPersistence, readDatabaseConfig, type Persistence } from "@sebela/db";
import { createTemporaryDatabase, type TemporaryDatabase } from "@sebela/db/testing";

import { DomainError } from "../../errors.js";
import { createProfileService, type ProfileService } from "./index.js";

const agentLab: ExplorationCreate = {
  slug: "agent-lab",
  name: "Agent lab",
  summary: "A fictional playground for tool-calling agents.",
  status: "tested",
  concepts: ["Tool calling", "Evaluation loops"],
  startedOn: "2025-02-01",
  endedOn: "2025-06-30",
  position: 1,
  technologies: ["typescript", "postgres"],
  topics: ["agents", "rag"],
};

const vectorNotes: ExplorationCreate = {
  ...agentLab,
  slug: "vector-notes",
  name: "Vector notes",
  status: "designed",
  concepts: [],
  endedOn: null,
  position: 0,
  technologies: [],
  topics: [],
};

describe("exploration service", () => {
  let database: TemporaryDatabase;
  let persistence: Persistence;
  let profile: ProfileService;

  beforeAll(async () => {
    database = await createTemporaryDatabase(readDatabaseConfig(process.env));
    persistence = createPersistence(database.config);
    profile = createProfileService(persistence.profile);
    for (const [position, slug] of ["typescript", "postgres", "rust"].entries()) {
      await profile.createTechnology({
        slug,
        name: slug,
        tier: "secondary",
        group: null,
        logoKey: null,
        position,
      });
    }
    for (const [position, slug] of ["agents", "rag", "mcp"].entries()) {
      await profile.createTopic({ slug, name: slug, position });
    }
  });

  afterAll(async () => {
    await persistence.close();
    await database.drop();
  });

  beforeEach(async () => {
    for (const { slug } of await persistence.profile.listExplorations()) {
      await persistence.profile.deleteExploration(slug);
    }
  });

  it("lists no explorations", async () => {
    await expect(profile.listExplorations()).resolves.toEqual([]);
  });

  it("creates explorations in the contract shape with resolved relations", async () => {
    const created = await profile.createExploration(agentLab);

    expect(ExplorationSchema.parse(created)).toEqual(created);
    const { technologies, topics, ...fields } = agentLab;
    expect(created).toMatchObject(fields);
    expect(created.technologies.map((technology) => technology.slug)).toEqual(technologies);
    expect(created.topics.map((topic) => topic.slug)).toEqual(topics);
    await expect(profile.getExploration("agent-lab")).resolves.toEqual(created);
  });

  it.each(explorationStatuses)("returns the status %s exactly as written", async (status) => {
    await profile.createExploration({ ...agentLab, status });

    await expect(profile.getExploration("agent-lab")).resolves.toMatchObject({ status });
    const [listed] = await profile.listExplorations();
    expect(listed?.status).toBe(status);
  });

  it("lists explorations by position", async () => {
    const later = await profile.createExploration(agentLab);
    const first = await profile.createExploration(vectorNotes);

    const listed = await profile.listExplorations();

    expect(ExplorationListSchema.parse(listed)).toEqual([first, later]);
  });

  it("reports an unknown slug as not found", async () => {
    await expect(profile.getExploration("missing")).rejects.toBeInstanceOf(DomainError);
    await expect(profile.getExploration("missing")).rejects.toMatchObject({ code: "not_found" });
    await expect(profile.updateExploration("missing", { name: "X" })).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(profile.deleteExploration("missing")).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("refuses a duplicate slug as a conflict", async () => {
    await profile.createExploration(agentLab);

    await expect(profile.createExploration(agentLab)).rejects.toMatchObject({ code: "conflict" });
  });

  const refusals: [string, Partial<ExplorationCreate>, string, string][] = [
    [
      "unknown technologies",
      { technologies: ["typescript", "cobol", "fortran"] },
      "technologies",
      "cobol, fortran",
    ],
    ["a repeated technology", { technologies: ["rust", "rust"] }, "technologies", "once"],
    ["unknown topics", { topics: ["agents", "quantum"] }, "topics", "quantum"],
    ["a repeated topic", { topics: ["mcp", "mcp"] }, "topics", "once"],
    ["an end before the start", { endedOn: "2020-01-01" }, "endedOn", "start"],
  ];

  it.each(refusals)("refuses a create with %s as invalid", async (_, change, path, text) => {
    await expect(profile.createExploration({ ...agentLab, ...change })).rejects.toMatchObject({
      code: "validation_failed",
      fields: [{ path, message: expect.stringContaining(text) as unknown }],
    });
    await expect(profile.listExplorations()).resolves.toEqual([]);
  });

  it.each(refusals)("refuses an update with %s and changes nothing", async (_, change, path) => {
    const created = await profile.createExploration(agentLab);

    await expect(
      profile.updateExploration("agent-lab", { name: "Changed", topics: ["mcp"], ...change }),
    ).rejects.toMatchObject({ code: "validation_failed", fields: [{ path }] });
    await expect(profile.getExploration("agent-lab")).resolves.toEqual(created);
  });

  it("changes only the given fields and keeps the relations when they are omitted", async () => {
    const created = await profile.createExploration(agentLab);
    const changes: ExplorationUpdate = { status: "built", endedOn: null, summary: undefined };

    const updated = await profile.updateExploration("agent-lab", changes);

    expect(updated).toMatchObject({ status: "built", endedOn: null, summary: agentLab.summary });
    expect(updated.technologies).toEqual(created.technologies);
    expect(updated.topics).toEqual(created.topics);
    expect(updated.id).toBe(created.id);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt));
  });

  it("replaces the concepts, technologies and topics with given lists", async () => {
    await profile.createExploration(agentLab);

    const updated = await profile.updateExploration("agent-lab", {
      concepts: ["Planning", "Memory"],
      technologies: ["rust", "typescript"],
      topics: ["mcp"],
    });

    expect(updated.concepts).toEqual(["Planning", "Memory"]);
    expect(updated.technologies.map((technology) => technology.slug)).toEqual([
      "rust",
      "typescript",
    ]);
    expect(updated.topics.map((topic) => topic.slug)).toEqual(["mcp"]);
  });

  it("deletes an exploration", async () => {
    await profile.createExploration(agentLab);

    await profile.deleteExploration("agent-lab");

    await expect(profile.getExploration("agent-lab")).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("refuses to delete a technology or a topic an exploration links as a conflict", async () => {
    await profile.createExploration(agentLab);

    await expect(profile.deleteTechnology("postgres")).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining("postgres") as unknown,
    });
    await expect(profile.deleteTopic("rag")).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining("rag") as unknown,
    });
    await expect(profile.getExploration("agent-lab")).resolves.toMatchObject({
      technologies: [{ slug: "typescript" }, { slug: "postgres" }],
      topics: [{ slug: "agents" }, { slug: "rag" }],
    });
  });

  it("leaves the career timeline untouched", async () => {
    await profile.createExploration(agentLab);

    await expect(profile.listExperiences()).resolves.toEqual([]);
    await expect(profile.listProjects()).resolves.toEqual([]);
  });
});
