import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { readDatabaseConfig } from "../../config.js";
import { openConnection, type Connection } from "../../connection.js";
import { createTemporaryDatabase, type TemporaryDatabase } from "../../testing.js";
import {
  createProfilePersistence,
  type CurrentFocusFields,
  type CurrentFocusRelations,
  type ProfilePersistence,
} from "./index.js";

type FocusInput = CurrentFocusFields & CurrentFocusRelations & { slug: string };

/** A fictional focus entry about a project, with topics. */
const evalHarness: FocusInput = {
  slug: "eval-harness",
  title: "An evaluation harness for agents",
  description: "Building a **fictional** harness that scores tool-calling agents.",
  link: "https://example.com/eval-harness",
  position: 1,
  project: "route-planner",
  topics: ["rag", "agents"],
};

/** A fictional focus entry without a link, project or topics. */
const learning: FocusInput = {
  slug: "learning-rust",
  title: "Learning Rust",
  description: "Working through a fictional book.",
  link: null,
  position: 0,
  project: null,
  topics: [],
};

const focus = (slug: string, position: number): FocusInput => ({ ...learning, slug, position });

describe("current-focus persistence", () => {
  let database: TemporaryDatabase;
  let connection: Connection;
  let profile: ProfilePersistence;

  /** Counts every stored row of a table; the subject here is persistence integrity. */
  async function count(table: "current_focus" | "current_focus_topics" | "projects" | "topics") {
    const result = await connection.db.execute<{ count: string }>(
      sql`SELECT count(*) AS count FROM ${sql.identifier("profile")}.${sql.identifier(table)}`,
    );
    return Number(result.rows[0]?.count);
  }

  const project = (slug: string, experience: string) => ({
    slug,
    experience,
    name: `Project ${slug}`,
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
  });

  beforeAll(async () => {
    database = await createTemporaryDatabase(readDatabaseConfig(process.env));
    connection = openConnection(database.config);
    profile = createProfilePersistence(connection.db);
    await profile.createOrganization({
      slug: "northwind",
      name: "Northwind",
      website: null,
      description: null,
    });
    const experience = {
      title: "Engineer",
      kind: "main_job" as const,
      organization: "northwind",
      summary: "A fictional role.",
      responsibilities: [],
      inCv: true,
      technologies: [],
      endedOn: null,
    };
    await profile.createExperience({
      ...experience,
      slug: "northwind-lead",
      startedOn: "2021-03-01",
    });
    await profile.createExperience({
      ...experience,
      slug: "acme-founder",
      startedOn: "2023-01-01",
    });
  });

  afterAll(async () => {
    await connection.close();
    await database.drop();
  });

  beforeEach(async () => {
    for (const { slug } of await profile.listCurrentFocus()) await profile.deleteCurrentFocus(slug);
    for (const { slug } of await profile.listProjects()) await profile.deleteProject(slug);
    for (const { slug } of await profile.listTopics()) await profile.deleteTopic(slug);
    await profile.createProject(project("route-planner", "northwind-lead"));
    await profile.createProject(project("fleet-board", "acme-founder"));
    for (const [position, slug] of ["agents", "rag", "evals"].entries()) {
      await profile.createTopic({ slug, name: slug.toUpperCase(), position });
    }
  });

  it("lists nothing while there is no focus entry", async () => {
    await expect(profile.listCurrentFocus()).resolves.toEqual([]);
  });

  it("creates an entry without a link, project or topics", async () => {
    const created = await profile.createCurrentFocus(learning);

    expect(created).toMatchObject({ ok: true, focus: { ...learning, project: null, topics: [] } });
    const found = await profile.findCurrentFocus("learning-rust");
    expect(found?.id).toEqual(expect.any(String));
    expect(found?.createdAt).toBeInstanceOf(Date);
    expect(found?.updatedAt).toBeInstanceOf(Date);
    if (!created.ok) throw new Error("expected a focus entry");
    expect(found).toEqual(created.focus);
  });

  it("creates an entry with its project and topics resolved in link order", async () => {
    const created = await profile.createCurrentFocus(evalHarness);

    if (!created.ok) throw new Error("expected a focus entry");
    expect(created.focus).toMatchObject({
      slug: "eval-harness",
      title: evalHarness.title,
      description: evalHarness.description,
      link: evalHarness.link,
      position: 1,
      project: {
        slug: "route-planner",
        name: "Project route-planner",
        experience: "northwind-lead",
      },
    });
    expect(created.focus.topics.map((topic) => topic.slug)).toEqual(["rag", "agents"]);
    await expect(profile.findCurrentFocus("eval-harness")).resolves.toEqual(created.focus);
  });

  it("finds nothing for an unknown slug", async () => {
    await expect(profile.findCurrentFocus("missing")).resolves.toBeNull();
  });

  it("lists entries by position, then slug", async () => {
    await profile.createCurrentFocus(focus("pear", 2));
    await profile.createCurrentFocus(focus("kiwi", 1));
    await profile.createCurrentFocus(focus("fig", 2));
    await profile.createCurrentFocus({ ...evalHarness, slug: "date", position: 0 });

    const listed = await profile.listCurrentFocus();

    expect(listed.map((record) => record.slug)).toEqual(["date", "kiwi", "fig", "pear"]);
    expect(listed[0]?.topics.map((topic) => topic.slug)).toEqual(["rag", "agents"]);
    expect(listed[1]?.project).toBeNull();
  });

  it("refuses a taken slug and keeps the stored entry", async () => {
    await profile.createCurrentFocus(learning);

    await expect(
      profile.createCurrentFocus({ ...evalHarness, slug: "learning-rust" }),
    ).resolves.toEqual({ ok: false, reason: "conflict" });
    await expect(profile.findCurrentFocus("learning-rust")).resolves.toMatchObject({
      title: "Learning Rust",
      topics: [],
    });
    expect(await count("current_focus_topics")).toBe(0);
  });

  it("refuses an unknown project and writes nothing", async () => {
    await expect(
      profile.createCurrentFocus({ ...evalHarness, project: "missing" }),
    ).resolves.toEqual({ ok: false, reason: "unknown_project" });
    expect(await count("current_focus")).toBe(0);
    expect(await count("current_focus_topics")).toBe(0);
  });

  it("refuses unknown topics, naming them, and writes nothing", async () => {
    await expect(
      profile.createCurrentFocus({ ...evalHarness, topics: ["rag", "ghost", "spirit"] }),
    ).resolves.toEqual({ ok: false, reason: "unknown_topics", slugs: ["ghost", "spirit"] });
    await expect(
      profile.createCurrentFocus({ ...evalHarness, topics: ["rag", "rag"] }),
    ).resolves.toEqual({ ok: false, reason: "repeated_topics" });
    expect(await count("current_focus")).toBe(0);
    expect(await count("current_focus_topics")).toBe(0);
  });

  describe("updates", () => {
    beforeEach(async () => {
      await profile.createCurrentFocus(evalHarness);
    });

    it("changes only the given scalars and keeps the project and topics", async () => {
      const before = await profile.findCurrentFocus("eval-harness");

      const updated = await profile.updateCurrentFocus("eval-harness", { title: "Renamed" });

      if (!updated.ok || !before) throw new Error("expected a focus entry");
      expect(updated.focus).toEqual({
        ...before,
        title: "Renamed",
        updatedAt: updated.focus.updatedAt,
      });
      expect(updated.focus.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
      expect(updated.focus.createdAt).toEqual(before.createdAt);
    });

    it("replaces the project with another and clears it with null", async () => {
      const moved = await profile.updateCurrentFocus("eval-harness", { project: "fleet-board" });
      expect(moved).toMatchObject({
        ok: true,
        focus: { project: { slug: "fleet-board", experience: "acme-founder" } },
      });

      const cleared = await profile.updateCurrentFocus("eval-harness", { project: null });
      expect(cleared).toMatchObject({ ok: true, focus: { project: null } });
    });

    it("clears the link with null", async () => {
      await expect(
        profile.updateCurrentFocus("eval-harness", { link: null }),
      ).resolves.toMatchObject({ ok: true, focus: { link: null } });
    });

    it("replaces the topics in their new order and removes them with an empty list", async () => {
      const replaced = await profile.updateCurrentFocus("eval-harness", {
        topics: ["evals", "rag"],
      });
      if (!replaced.ok) throw new Error("expected a focus entry");
      expect(replaced.focus.topics.map((topic) => topic.slug)).toEqual(["evals", "rag"]);

      const removed = await profile.updateCurrentFocus("eval-harness", { topics: [] });
      expect(removed).toMatchObject({ ok: true, focus: { topics: [] } });
      expect(await count("current_focus_topics")).toBe(0);
      expect(await count("topics")).toBe(3);
    });

    it("keeps the old state when a project or topic in the same change is unknown", async () => {
      const before = await profile.findCurrentFocus("eval-harness");

      await expect(
        profile.updateCurrentFocus("eval-harness", { title: "Renamed", project: "missing" }),
      ).resolves.toEqual({ ok: false, reason: "unknown_project" });
      await expect(
        profile.updateCurrentFocus("eval-harness", {
          title: "Renamed",
          project: null,
          topics: ["evals", "ghost"],
        }),
      ).resolves.toEqual({ ok: false, reason: "unknown_topics", slugs: ["ghost"] });

      await expect(profile.findCurrentFocus("eval-harness")).resolves.toEqual(before);
    });

    it("refuses an unknown entry", async () => {
      await expect(profile.updateCurrentFocus("missing", { title: "x" })).resolves.toEqual({
        ok: false,
        reason: "not_found",
      });
    });
  });

  describe("deletes", () => {
    it("removes the entry and its topic links but keeps the project and topics", async () => {
      await profile.createCurrentFocus(evalHarness);

      await expect(profile.deleteCurrentFocus("eval-harness")).resolves.toEqual({ ok: true });

      await expect(profile.findCurrentFocus("eval-harness")).resolves.toBeNull();
      expect(await count("current_focus_topics")).toBe(0);
      expect(await count("projects")).toBe(2);
      expect(await count("topics")).toBe(3);
    });

    it("refuses an unknown entry", async () => {
      await expect(profile.deleteCurrentFocus("missing")).resolves.toEqual({
        ok: false,
        reason: "not_found",
      });
    });

    it("refuses to delete a project or topic a focus entry links to", async () => {
      await profile.createCurrentFocus(evalHarness);

      await expect(profile.deleteProject("route-planner")).resolves.toEqual({
        ok: false,
        reason: "referenced",
      });
      await expect(profile.deleteTopic("agents")).resolves.toEqual({
        ok: false,
        reason: "referenced",
      });
      await expect(profile.findCurrentFocus("eval-harness")).resolves.toMatchObject({
        project: { slug: "route-planner" },
      });

      await expect(profile.deleteTopic("evals")).resolves.toEqual({ ok: true });
      await profile.updateCurrentFocus("eval-harness", { project: null });
      await expect(profile.deleteProject("route-planner")).resolves.toEqual({ ok: true });
    });
  });
});
