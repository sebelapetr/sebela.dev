import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { readDatabaseConfig } from "../../config.js";
import { openConnection, type Connection } from "../../connection.js";
import { createTemporaryDatabase, type TemporaryDatabase } from "../../testing.js";
import {
  createProfilePersistence,
  type ExplorationFields,
  type ExplorationRelations,
  type ExplorationStatus,
  type ProfilePersistence,
} from "./index.js";

type ExplorationInput = ExplorationFields & ExplorationRelations & { slug: string };

const agentLab: ExplorationInput = {
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

const exploration = (
  slug: string,
  position: number,
  overrides: Partial<ExplorationInput> = {},
): ExplorationInput => ({
  ...agentLab,
  slug,
  position,
  technologies: [],
  topics: [],
  ...overrides,
});

const statuses: ExplorationStatus[] = ["built", "tested", "designed"];

describe("exploration persistence", () => {
  let database: TemporaryDatabase;
  let connection: Connection;
  let profile: ProfilePersistence;

  /** Counts every stored row of a table; the subject here is persistence integrity. */
  async function count(
    table:
      | "explorations"
      | "exploration_technologies"
      | "exploration_topics"
      | "experiences"
      | "projects",
  ) {
    const result = await connection.db.execute<{ count: string }>(
      sql`SELECT count(*) AS count FROM ${sql.identifier("profile")}.${sql.identifier(table)}`,
    );
    return Number(result.rows[0]?.count);
  }

  const linked = async (slug: string) => {
    const found = await profile.findExploration(slug);
    return {
      technologies: found?.technologies.map((technology) => technology.slug),
      topics: found?.topics.map((topic) => topic.slug),
    };
  };

  beforeAll(async () => {
    database = await createTemporaryDatabase(readDatabaseConfig(process.env));
    connection = openConnection(database.config);
    profile = createProfilePersistence(connection.db);
    const technology = (slug: string, position: number) => ({
      slug,
      name: slug,
      tier: "secondary" as const,
      group: null,
      logoKey: null,
      position,
    });
    await profile.createTechnology(technology("typescript", 1));
    await profile.createTechnology(technology("postgres", 2));
    await profile.createTechnology(technology("rust", 3));
    await profile.createTopic({ slug: "agents", name: "Agents", position: 1 });
    await profile.createTopic({ slug: "rag", name: "Retrieval", position: 2 });
    await profile.createTopic({ slug: "mcp", name: "MCP", position: 3 });
  });

  afterAll(async () => {
    await connection.close();
    await database.drop();
  });

  beforeEach(async () => {
    for (const { slug } of await profile.listExplorations()) await profile.deleteExploration(slug);
  });

  it("lists nothing while there are no explorations", async () => {
    await expect(profile.listExplorations()).resolves.toEqual([]);
  });

  it("creates an exploration with its technologies and topics resolved", async () => {
    const created = await profile.createExploration(agentLab);

    const { technologies, topics, ...fields } = agentLab;
    expect(created).toMatchObject({ ok: true, exploration: fields });
    const found = await profile.findExploration("agent-lab");
    expect(found).toMatchObject(fields);
    expect(found?.id).toEqual(expect.any(String));
    expect(found?.createdAt).toBeInstanceOf(Date);
    expect(found?.updatedAt).toBeInstanceOf(Date);
    expect(found?.technologies.map((technology) => technology.slug)).toEqual(technologies);
    expect(found?.technologies[0]).toMatchObject({ name: "typescript", tier: "secondary" });
    expect(found?.topics.map((topic) => topic.slug)).toEqual(topics);
    expect(found?.topics[1]).toMatchObject({ name: "Retrieval", position: 2 });
  });

  it.each(statuses)("stores and returns the status %s exactly", async (status) => {
    await profile.createExploration({ ...agentLab, status });

    await expect(profile.findExploration("agent-lab")).resolves.toMatchObject({ status });
  });

  it("keeps the concepts, technologies and topics in the order they were given", async () => {
    await profile.createExploration({
      ...agentLab,
      concepts: ["Zeta", "Alpha", "Mu"],
      technologies: ["rust", "typescript", "postgres"],
      topics: ["mcp", "agents"],
    });

    const found = await profile.findExploration("agent-lab");
    expect(found?.concepts).toEqual(["Zeta", "Alpha", "Mu"]);
    await expect(linked("agent-lab")).resolves.toEqual({
      technologies: ["rust", "typescript", "postgres"],
      topics: ["mcp", "agents"],
    });
  });

  it("stores an ongoing exploration without concepts, technologies or topics", async () => {
    await profile.createExploration(
      exploration("vector-notes", 0, { endedOn: null, concepts: [] }),
    );

    await expect(profile.findExploration("vector-notes")).resolves.toMatchObject({
      endedOn: null,
      concepts: [],
      technologies: [],
      topics: [],
    });
  });

  it("finds nothing for an unknown slug", async () => {
    await expect(profile.findExploration("missing")).resolves.toBeNull();
  });

  it("orders explorations by position, then slug", async () => {
    await profile.createExploration(exploration("late", 3));
    await profile.createExploration(exploration("tie-b", 1));
    await profile.createExploration(exploration("first", 0));
    await profile.createExploration(exploration("tie-a", 1));

    const slugs = (await profile.listExplorations()).map((record) => record.slug);

    expect(slugs).toEqual(["first", "tie-a", "tie-b", "late"]);
  });

  it("lists every exploration with its own technologies and topics", async () => {
    await profile.createExploration(agentLab);
    await profile.createExploration(
      exploration("vector-notes", 0, { technologies: ["rust"], topics: ["mcp"] }),
    );

    const listed = await profile.listExplorations();

    expect(
      listed.map((record) => [
        record.slug,
        record.technologies.map((technology) => technology.slug),
        record.topics.map((topic) => topic.slug),
      ]),
    ).toEqual([
      ["vector-notes", ["rust"], ["mcp"]],
      ["agent-lab", ["typescript", "postgres"], ["agents", "rag"]],
    ]);
  });

  it("stays outside the career timeline: no experience or project is written", async () => {
    await profile.createExploration(agentLab);

    expect(await count("experiences")).toBe(0);
    expect(await count("projects")).toBe(0);
    await expect(profile.listExperiences()).resolves.toEqual([]);
    await expect(profile.listProjects()).resolves.toEqual([]);
  });

  describe("an invalid create writes nothing", () => {
    const refusals: [string, Partial<ExplorationInput>, object][] = [
      [
        "unknown technologies",
        { technologies: ["typescript", "cobol", "postgres", "fortran"] },
        { reason: "unknown_technologies", slugs: ["cobol", "fortran"] },
      ],
      [
        "a repeated technology",
        { technologies: ["typescript", "rust", "typescript"] },
        { reason: "repeated_technologies" },
      ],
      [
        "unknown topics",
        { topics: ["agents", "quantum", "rag", "biology"] },
        { reason: "unknown_topics", slugs: ["quantum", "biology"] },
      ],
      ["a repeated topic", { topics: ["rag", "agents", "rag"] }, { reason: "repeated_topics" }],
      [
        "an end before the start",
        { startedOn: "2025-01-02", endedOn: "2025-01-01" },
        { reason: "invalid_period" },
      ],
    ];

    it.each(refusals)("refuses %s", async (_, changes, failure) => {
      await expect(profile.createExploration({ ...agentLab, ...changes })).resolves.toEqual({
        ok: false,
        ...failure,
      });
      expect(await count("explorations")).toBe(0);
      expect(await count("exploration_technologies")).toBe(0);
      expect(await count("exploration_topics")).toBe(0);
    });

    it("refuses a status outside the defined ones in the database itself", async () => {
      await expect(
        connection.db.execute(
          sql`INSERT INTO profile.explorations (slug, name, summary, status, started_on, position)
              VALUES ('rogue', 'Rogue', 'x', 'shipped', '2025-01-01', 0)`,
        ),
      ).rejects.toThrow();
      expect(await count("explorations")).toBe(0);
    });
  });

  it("refuses a duplicate slug as a conflict, also for concurrent creates", async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, () => profile.createExploration(agentLab)),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual(
      Array.from({ length: 3 }, () => ({ ok: false, reason: "conflict" })),
    );
    expect(await count("explorations")).toBe(1);
    expect(await count("exploration_technologies")).toBe(2);
    expect(await count("exploration_topics")).toBe(2);
  });

  describe("updates", () => {
    it("changes given fields, keeps the slug, id and createdAt and advances updatedAt", async () => {
      const created = await profile.createExploration(agentLab);
      if (!created.ok) throw new Error("expected an exploration");

      const updated = await profile.updateExploration("agent-lab", {
        name: "Agent workshop",
        status: "built",
        endedOn: null,
        concepts: ["Planning"],
      });

      expect(updated).toMatchObject({
        ok: true,
        exploration: {
          slug: "agent-lab",
          name: "Agent workshop",
          status: "built",
          endedOn: null,
          concepts: ["Planning"],
          summary: agentLab.summary,
          id: created.exploration.id,
          createdAt: created.exploration.createdAt,
        },
      });
      if (!updated.ok) throw new Error("expected an exploration");
      expect(updated.exploration.updatedAt.getTime()).toBeGreaterThan(
        created.exploration.updatedAt.getTime(),
      );
    });

    it("keeps the technologies and topics when they are omitted", async () => {
      await profile.createExploration(agentLab);

      await profile.updateExploration("agent-lab", { status: "designed" });

      await expect(linked("agent-lab")).resolves.toEqual({
        technologies: ["typescript", "postgres"],
        topics: ["agents", "rag"],
      });
    });

    it("replaces every technology and topic link with given lists, in their order", async () => {
      await profile.createExploration(agentLab);

      const updated = await profile.updateExploration("agent-lab", {
        technologies: ["rust", "typescript"],
        topics: ["mcp"],
      });

      expect(updated.ok).toBe(true);
      await expect(linked("agent-lab")).resolves.toEqual({
        technologies: ["rust", "typescript"],
        topics: ["mcp"],
      });
      expect(await count("exploration_technologies")).toBe(2);
      expect(await count("exploration_topics")).toBe(1);
    });

    it("replaces only the list that is given", async () => {
      await profile.createExploration(agentLab);

      await profile.updateExploration("agent-lab", { topics: [] });

      await expect(linked("agent-lab")).resolves.toEqual({
        technologies: ["typescript", "postgres"],
        topics: [],
      });
      expect(await count("exploration_topics")).toBe(0);
    });

    it("updates nothing for an unknown slug", async () => {
      await expect(profile.updateExploration("missing", { name: "Missing" })).resolves.toEqual({
        ok: false,
        reason: "not_found",
      });
    });

    // Each change also replaces the name, the technologies and the topics, so a refusal must undo
    // them all.
    const refusals: [string, Partial<ExplorationInput>, object][] = [
      [
        "unknown technologies",
        { technologies: ["rust", "cobol"] },
        { reason: "unknown_technologies", slugs: ["cobol"] },
      ],
      [
        "a repeated technology",
        { technologies: ["rust", "rust"] },
        { reason: "repeated_technologies" },
      ],
      [
        "unknown topics",
        { topics: ["mcp", "quantum"] },
        { reason: "unknown_topics", slugs: ["quantum"] },
      ],
      ["a repeated topic", { topics: ["mcp", "mcp"] }, { reason: "repeated_topics" }],
      ["an end before the stored start", { endedOn: "2020-01-01" }, { reason: "invalid_period" }],
      ["a start after the stored end", { startedOn: "2026-01-01" }, { reason: "invalid_period" }],
    ];

    it.each(refusals)("refuses %s and changes nothing", async (_, changes, failure) => {
      const created = await profile.createExploration(agentLab);
      if (!created.ok) throw new Error("expected an exploration");

      const result = await profile.updateExploration("agent-lab", {
        name: "Changed",
        technologies: ["rust"],
        topics: ["mcp"],
        ...changes,
      });

      expect(result).toEqual({ ok: false, ...failure });
      await expect(profile.findExploration("agent-lab")).resolves.toEqual(created.exploration);
      expect(await count("exploration_technologies")).toBe(2);
      expect(await count("exploration_topics")).toBe(2);
    });

    it("leaves exactly one of several concurrent link replacements", async () => {
      await profile.createExploration(agentLab);
      const lists = [["mcp"], ["agents", "rag"], ["rag", "mcp", "agents"], []];

      const results = await Promise.all(
        lists.map((topics) => profile.updateExploration("agent-lab", { topics })),
      );

      expect(results.every((result) => result.ok)).toBe(true);
      const { topics } = await linked("agent-lab");
      expect(lists).toContainEqual(topics);
      expect(await count("exploration_topics")).toBe(topics?.length);
    });
  });

  describe("deletes", () => {
    it("deletes an exploration once, with only its own links", async () => {
      await profile.createExploration(agentLab);
      await profile.createExploration(
        exploration("vector-notes", 0, { technologies: ["typescript"], topics: ["rag"] }),
      );

      await expect(profile.deleteExploration("agent-lab")).resolves.toEqual({ ok: true });
      await expect(profile.deleteExploration("agent-lab")).resolves.toEqual({
        ok: false,
        reason: "not_found",
      });

      await expect(profile.findExploration("agent-lab")).resolves.toBeNull();
      await expect(linked("vector-notes")).resolves.toEqual({
        technologies: ["typescript"],
        topics: ["rag"],
      });
      expect(await count("exploration_technologies")).toBe(1);
      expect(await count("exploration_topics")).toBe(1);
      await expect(profile.findTechnology("postgres")).resolves.not.toBeNull();
      await expect(profile.findTopic("agents")).resolves.not.toBeNull();
    });

    it("refuses to delete a technology that an exploration links to", async () => {
      await profile.createExploration(agentLab);

      await expect(profile.deleteTechnology("postgres")).resolves.toEqual({
        ok: false,
        reason: "referenced",
      });
      await expect(profile.findTechnology("postgres")).resolves.not.toBeNull();
      await expect(linked("agent-lab")).resolves.toMatchObject({
        technologies: ["typescript", "postgres"],
      });
    });

    it("refuses to delete a topic that an exploration links to", async () => {
      await profile.createExploration(agentLab);

      await expect(profile.deleteTopic("rag")).resolves.toEqual({
        ok: false,
        reason: "referenced",
      });
      await expect(profile.findTopic("rag")).resolves.not.toBeNull();
      await expect(linked("agent-lab")).resolves.toMatchObject({ topics: ["agents", "rag"] });
    });

    it("deletes a topic again once no exploration links to it", async () => {
      await profile.createExploration(agentLab);
      await profile.updateExploration("agent-lab", { topics: ["agents"] });
      await profile.createTopic({ slug: "spare", name: "Spare", position: 9 });

      await expect(profile.deleteTopic("spare")).resolves.toEqual({ ok: true });
    });
  });
});
