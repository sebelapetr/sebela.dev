import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  CurrentFocusListSchema,
  CurrentFocusSchema,
  type CurrentFocusCreate,
  type CurrentFocusUpdate,
} from "@sebela/contracts";
import { createPersistence, readDatabaseConfig, type Persistence } from "@sebela/db";
import { createTemporaryDatabase, type TemporaryDatabase } from "@sebela/db/testing";

import { DomainError } from "../../errors.js";
import { createProfileService, type ProfileService } from "./index.js";

/** A fictional focus entry about a project, with topics. */
const evalHarness: CurrentFocusCreate = {
  slug: "eval-harness",
  title: "An evaluation harness for agents",
  description: "Building a **fictional** harness that scores tool-calling agents.",
  link: "https://example.com/eval-harness",
  position: 1,
  project: "route-planner",
  topics: ["rag", "agents"],
};

/** A fictional focus entry without a link, project or topics. */
const learning: CurrentFocusCreate = {
  slug: "learning-rust",
  title: "Learning Rust",
  description: "Working through a fictional book.",
  link: null,
  position: 0,
  project: null,
  topics: [],
};

describe("current-focus service", () => {
  let database: TemporaryDatabase;
  let persistence: Persistence;
  let profile: ProfileService;

  beforeAll(async () => {
    database = await createTemporaryDatabase(readDatabaseConfig(process.env));
    persistence = createPersistence(database.config);
    profile = createProfileService(persistence.profile);
    await profile.createOrganization({
      slug: "northwind",
      name: "Northwind",
      website: null,
      description: null,
    });
    await profile.createExperience({
      slug: "northwind-lead",
      title: "Engineer",
      kind: "main_job",
      organization: "northwind",
      summary: "A fictional role.",
      responsibilities: [],
      inCv: true,
      technologies: [],
      startedOn: "2021-03-01",
      endedOn: null,
    });
    const project = {
      experience: "northwind-lead",
      summary: "A fictional project.",
      problem: "A fictional problem.",
      workDone: "Fictional work.",
      result: "A fictional result.",
      startedOn: "2022-01-01",
      endedOn: null,
      links: [],
      selectedForHomepage: false,
      position: 0,
      technologies: [],
    };
    await profile.createProject({ ...project, slug: "route-planner", name: "Route planner" });
    await profile.createProject({ ...project, slug: "fleet-board", name: "Fleet board" });
    for (const [position, slug] of ["agents", "rag", "evals"].entries()) {
      await profile.createTopic({ slug, name: slug.toUpperCase(), position });
    }
  });

  afterAll(async () => {
    await persistence.close();
    await database.drop();
  });

  beforeEach(async () => {
    for (const { slug } of await persistence.profile.listCurrentFocus()) {
      await persistence.profile.deleteCurrentFocus(slug);
    }
  });

  it("lists no focus entries", async () => {
    await expect(profile.listCurrentFocus()).resolves.toEqual([]);
  });

  it("creates an entry without a link, project or topics in the contract shape", async () => {
    const created = await profile.createCurrentFocus(learning);

    expect(CurrentFocusSchema.parse(created)).toEqual(created);
    expect(created).toMatchObject({ ...learning, project: null, topics: [] });
    await expect(profile.getCurrentFocus("learning-rust")).resolves.toEqual(created);
  });

  it("creates an entry with its project and topics resolved", async () => {
    const created = await profile.createCurrentFocus(evalHarness);

    expect(CurrentFocusSchema.parse(created)).toEqual(created);
    expect(created.project).toEqual({
      slug: "route-planner",
      name: "Route planner",
      experience: "northwind-lead",
    });
    expect(created.topics.map((topic) => topic.slug)).toEqual(["rag", "agents"]);
    expect(created.link).toBe("https://example.com/eval-harness");
  });

  it("lists the entries by position, then slug", async () => {
    const second = await profile.createCurrentFocus(evalHarness);
    const first = await profile.createCurrentFocus(learning);
    const third = await profile.createCurrentFocus({ ...learning, slug: "aa-later", position: 1 });

    const listed = await profile.listCurrentFocus();

    expect(CurrentFocusListSchema.parse(listed)).toEqual([first, third, second]);
  });

  it("reports an unknown slug as not found", async () => {
    await expect(profile.getCurrentFocus("missing")).rejects.toBeInstanceOf(DomainError);
    await expect(profile.getCurrentFocus("missing")).rejects.toMatchObject({
      code: "not_found",
      message: expect.stringContaining("missing") as unknown,
    });
    await expect(profile.updateCurrentFocus("missing", { title: "X" })).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(profile.deleteCurrentFocus("missing")).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("refuses a duplicate slug as a conflict", async () => {
    await profile.createCurrentFocus(evalHarness);

    await expect(
      profile.createCurrentFocus({ ...learning, slug: "eval-harness" }),
    ).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining("eval-harness") as unknown,
    });
  });

  it.each<[string, Partial<CurrentFocusCreate>, string, string]>([
    ["an unknown project", { project: "missing" }, "project", "missing"],
    ["unknown topics", { topics: ["rag", "ghost"] }, "topics", "ghost"],
    ["repeated topics", { topics: ["rag", "rag"] }, "topics", "once"],
  ])("refuses a create with %s as invalid and writes nothing", async (_, change, path, text) => {
    await expect(profile.createCurrentFocus({ ...evalHarness, ...change })).rejects.toMatchObject({
      code: "validation_failed",
      fields: [{ path, message: expect.stringContaining(text) as unknown }],
    });
    await expect(profile.listCurrentFocus()).resolves.toEqual([]);
  });

  it.each<[string, CurrentFocusUpdate, string]>([
    ["an unknown project", { project: "missing" }, "project"],
    ["unknown topics", { topics: ["ghost"] }, "topics"],
  ])("refuses an update with %s and keeps the old state", async (_, change, path) => {
    const created = await profile.createCurrentFocus(evalHarness);

    await expect(
      profile.updateCurrentFocus("eval-harness", { title: "Changed", ...change }),
    ).rejects.toMatchObject({ code: "validation_failed", fields: [{ path }] });
    await expect(profile.getCurrentFocus("eval-harness")).resolves.toEqual(created);
  });

  it("changes only the given fields and keeps the project and topics when they are omitted", async () => {
    const created = await profile.createCurrentFocus(evalHarness);
    const changes: CurrentFocusUpdate = { title: "Renamed", description: undefined };

    const updated = await profile.updateCurrentFocus("eval-harness", changes);

    expect(updated).toEqual({ ...created, title: "Renamed", updatedAt: updated.updatedAt });
    expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt));
  });

  it("replaces the project and topics and clears the project, link and topics", async () => {
    await profile.createCurrentFocus(evalHarness);

    const replaced = await profile.updateCurrentFocus("eval-harness", {
      project: "fleet-board",
      topics: ["evals"],
    });
    expect(replaced.project?.slug).toBe("fleet-board");
    expect(replaced.topics.map((topic) => topic.slug)).toEqual(["evals"]);

    const cleared = await profile.updateCurrentFocus("eval-harness", {
      project: null,
      link: null,
      topics: [],
    });
    expect(cleared).toMatchObject({ project: null, link: null, topics: [] });
  });

  it("deletes an entry and keeps its project and topics", async () => {
    await profile.createCurrentFocus(evalHarness);

    await profile.deleteCurrentFocus("eval-harness");

    await expect(profile.getCurrentFocus("eval-harness")).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(profile.getProject("route-planner")).resolves.toMatchObject({
      slug: "route-planner",
    });
    await expect(profile.getTopic("rag")).resolves.toMatchObject({ slug: "rag" });
  });

  it("refuses to delete a project or topic a focus entry links as a conflict", async () => {
    const created = await profile.createCurrentFocus(evalHarness);

    await expect(profile.deleteProject("route-planner")).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining("current focus") as unknown,
    });
    await expect(profile.deleteTopic("rag")).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining("rag") as unknown,
    });
    await expect(profile.getCurrentFocus("eval-harness")).resolves.toEqual(created);
  });
});
