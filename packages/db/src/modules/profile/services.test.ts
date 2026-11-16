import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { readDatabaseConfig } from "../../config.js";
import { openConnection, type Connection } from "../../connection.js";
import { createTemporaryDatabase, type TemporaryDatabase } from "../../testing.js";
import {
  createProfilePersistence,
  type ProfilePersistence,
  type ServiceEvidence,
  type ServiceFields,
} from "./index.js";

type ServiceInput = ServiceFields & { slug: string; evidence: ServiceEvidence[] };

const harbor = { kind: "project", project: "harbor-portal" } as const;
const ledger = { kind: "project", project: "ledger-sync" } as const;
const agentLab = { kind: "exploration", exploration: "agent-lab" } as const;
const vectorNotes = { kind: "exploration", exploration: "vector-notes" } as const;
const roadmap = { kind: "link", label: "Roadmap", path: "/roadmap" } as const;

const automation: ServiceInput = {
  slug: "process-automation",
  name: "Process automation",
  summary: "A **fictional** service that connects existing tools.",
  audience: "Fictional teams that copy data by hand.",
  deliverable: "A working integration.",
  position: 1,
  evidence: [harbor, roadmap, agentLab],
};

const service = (
  slug: string,
  position: number,
  overrides: Partial<ServiceInput> = {},
): ServiceInput => ({ ...automation, slug, position, evidence: [], ...overrides });

const projectInput = (slug: string, name: string) => ({
  slug,
  experience: "northwind-lead",
  name,
  summary: `The fictional ${name}.`,
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
const explorationInput = (slug: string, name: string, status: "built" | "designed" = "built") => ({
  slug,
  name,
  summary: `The fictional ${name}.`,
  status,
  concepts: [],
  startedOn: "2025-01-01",
  endedOn: null,
  position: 0,
  technologies: [],
  topics: [],
});

describe("service persistence", () => {
  let database: TemporaryDatabase;
  let connection: Connection;
  let profile: ProfilePersistence;

  /** Counts every stored row of a table; the subject here is persistence integrity. */
  async function count(table: "services" | "service_evidence" | "projects" | "explorations") {
    const result = await connection.db.execute<{ count: string }>(
      sql`SELECT count(*) AS count FROM ${sql.identifier("profile")}.${sql.identifier(table)}`,
    );
    return Number(result.rows[0]?.count);
  }

  /** The evidence of a service in a short form: the kind and the target slug or the path. */
  const evidenceOf = async (slug: string) =>
    (await profile.findService(slug))?.evidence.map((piece) =>
      piece.kind === "project"
        ? `project:${piece.project.slug}`
        : piece.kind === "exploration"
          ? `exploration:${piece.exploration.slug}`
          : `link:${piece.path}`,
    );

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
    await profile.createExperience({
      slug: "northwind-lead",
      organization: "northwind",
      title: "Engineer",
      kind: "main_job",
      summary: "A fictional role.",
      responsibilities: [],
      startedOn: "2021-03-01",
      endedOn: null,
      inCv: true,
      technologies: [],
    });
    await profile.createProject(projectInput("harbor-portal", "Harbor portal"));
    await profile.createProject(projectInput("ledger-sync", "Ledger sync"));
    await profile.createExploration(explorationInput("agent-lab", "Agent lab", "designed"));
    await profile.createExploration(explorationInput("vector-notes", "Vector notes", "built"));
  });

  afterAll(async () => {
    await connection.close();
    await database.drop();
  });

  beforeEach(async () => {
    for (const { slug } of await profile.listServices()) await profile.deleteService(slug);
  });

  it("lists nothing while there are no services", async () => {
    await expect(profile.listServices()).resolves.toEqual([]);
  });

  it("creates a service with its mixed evidence resolved in the given order", async () => {
    const created = await profile.createService(automation);

    const { evidence, ...fields } = automation;
    expect(created).toMatchObject({ ok: true, service: fields });
    const found = await profile.findService("process-automation");
    expect(found).toMatchObject(fields);
    expect(found?.id).toEqual(expect.any(String));
    expect(found?.createdAt).toBeInstanceOf(Date);
    expect(found?.updatedAt).toBeInstanceOf(Date);
    expect(found?.evidence).toEqual([
      {
        kind: "project",
        project: {
          slug: "harbor-portal",
          name: "Harbor portal",
          summary: "The fictional Harbor portal.",
          experience: "northwind-lead",
        },
      },
      roadmap,
      {
        kind: "exploration",
        exploration: {
          slug: "agent-lab",
          name: "Agent lab",
          summary: "The fictional Agent lab.",
          status: "designed",
        },
      },
    ]);
    expect(evidence).toHaveLength(3);
  });

  it("stores a service without evidence", async () => {
    await profile.createService(service("custom-software", 0));

    await expect(profile.findService("custom-software")).resolves.toMatchObject({ evidence: [] });
    expect(await count("service_evidence")).toBe(0);
  });

  it("keeps the evidence in any order, including several links", async () => {
    const evidence = [
      vectorNotes,
      roadmap,
      ledger,
      { kind: "link", label: "Contact", path: "/contact" } as const,
      harbor,
    ];
    await profile.createService({ ...automation, evidence });

    await expect(evidenceOf("process-automation")).resolves.toEqual([
      "exploration:vector-notes",
      "link:/roadmap",
      "project:ledger-sync",
      "link:/contact",
      "project:harbor-portal",
    ]);
  });

  it("finds nothing for an unknown slug", async () => {
    await expect(profile.findService("missing")).resolves.toBeNull();
  });

  it("orders services by position, then slug, each with its own evidence", async () => {
    await profile.createService(service("b-service", 1, { evidence: [ledger] }));
    await profile.createService(service("late", 5, { evidence: [agentLab, harbor] }));
    await profile.createService(service("first", 0));
    await profile.createService(service("a-service", 1, { evidence: [roadmap] }));

    const listed = await profile.listServices();

    expect(listed.map((record) => record.slug)).toEqual([
      "first",
      "a-service",
      "b-service",
      "late",
    ]);
    expect(listed.map((record) => record.evidence.length)).toEqual([0, 1, 1, 2]);
    await expect(evidenceOf("late")).resolves.toEqual([
      "exploration:agent-lab",
      "project:harbor-portal",
    ]);
  });

  it("shows the current name of a project and the current status of an exploration", async () => {
    await profile.createService(automation);
    await profile.updateProject("harbor-portal", { name: "Harbor portal 2" });
    await profile.updateExploration("agent-lab", { status: "built" });

    const found = await profile.findService("process-automation");

    const [project, , exploration] = found?.evidence ?? [];
    expect(project).toMatchObject({ project: { name: "Harbor portal 2" } });
    expect(exploration).toMatchObject({ exploration: { status: "built" } });
    await profile.updateProject("harbor-portal", { name: "Harbor portal" });
    await profile.updateExploration("agent-lab", { status: "designed" });
  });

  describe("an invalid create writes nothing", () => {
    const refusals: [string, ServiceEvidence[], object][] = [
      [
        "unknown projects",
        [
          harbor,
          { kind: "project", project: "ghost" },
          roadmap,
          { kind: "project", project: "void" },
        ],
        { reason: "unknown_projects", slugs: ["ghost", "void"] },
      ],
      [
        "unknown explorations",
        [agentLab, { kind: "exploration", exploration: "ghost" }],
        { reason: "unknown_explorations", slugs: ["ghost"] },
      ],
      ["a repeated project", [harbor, roadmap, harbor], { reason: "repeated_projects" }],
      ["a repeated exploration", [agentLab, agentLab], { reason: "repeated_explorations" }],
    ];

    it.each(refusals)("refuses %s", async (_, evidence, failure) => {
      await expect(profile.createService({ ...automation, evidence })).resolves.toEqual({
        ok: false,
        ...failure,
      });
      expect(await count("services")).toBe(0);
      expect(await count("service_evidence")).toBe(0);
    });

    it("refuses evidence whose columns do not match its kind in the database itself", async () => {
      await profile.createService(service("custom-software", 0));

      await expect(
        connection.db.execute(
          sql`INSERT INTO profile.service_evidence (service_id, position, kind, link_label, link_path)
              SELECT id, 0, 'project', 'x', '/x' FROM profile.services`,
        ),
      ).rejects.toThrow();
      expect(await count("service_evidence")).toBe(0);
    });
  });

  it("refuses a duplicate slug as a conflict, also for concurrent creates", async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, () => profile.createService(automation)),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual(
      Array.from({ length: 3 }, () => ({ ok: false, reason: "conflict" })),
    );
    expect(await count("services")).toBe(1);
    expect(await count("service_evidence")).toBe(3);
  });

  describe("updates", () => {
    it("changes given fields, keeps the slug, id, createdAt and evidence and advances updatedAt", async () => {
      const created = await profile.createService(automation);
      if (!created.ok) throw new Error("expected a service");

      const updated = await profile.updateService("process-automation", {
        name: "Automation",
        audience: "Other fictional teams.",
      });

      if (!updated.ok) throw new Error("expected an update");
      expect(updated.service).toMatchObject({
        ...created.service,
        name: "Automation",
        audience: "Other fictional teams.",
        updatedAt: expect.any(Date) as unknown,
      });
      expect(updated.service.evidence).toEqual(created.service.evidence);
      expect(updated.service.updatedAt.getTime()).toBeGreaterThan(
        created.service.updatedAt.getTime(),
      );
    });

    it("replaces all evidence with a given list, in its order", async () => {
      await profile.createService(automation);

      await profile.updateService("process-automation", { evidence: [agentLab, ledger, harbor] });
      await expect(evidenceOf("process-automation")).resolves.toEqual([
        "exploration:agent-lab",
        "project:ledger-sync",
        "project:harbor-portal",
      ]);

      await profile.updateService("process-automation", { evidence: [roadmap] });
      await expect(evidenceOf("process-automation")).resolves.toEqual(["link:/roadmap"]);

      await profile.updateService("process-automation", { evidence: [] });
      await expect(evidenceOf("process-automation")).resolves.toEqual([]);
      expect(await count("service_evidence")).toBe(0);
    });

    it("updates nothing for an unknown slug", async () => {
      await expect(profile.updateService("missing", { name: "Missing" })).resolves.toEqual({
        ok: false,
        reason: "not_found",
      });
    });

    // Each change also replaces the name and the evidence, so a refusal must undo them all.
    const refusals: [string, ServiceEvidence[], object][] = [
      [
        "unknown projects",
        [ledger, { kind: "project", project: "ghost" }],
        { reason: "unknown_projects", slugs: ["ghost"] },
      ],
      [
        "unknown explorations",
        [vectorNotes, { kind: "exploration", exploration: "ghost" }],
        { reason: "unknown_explorations", slugs: ["ghost"] },
      ],
      ["a repeated project", [ledger, ledger], { reason: "repeated_projects" }],
      ["a repeated exploration", [vectorNotes, vectorNotes], { reason: "repeated_explorations" }],
    ];

    it.each(refusals)("refuses %s and changes nothing", async (_, evidence, failure) => {
      const created = await profile.createService(automation);
      if (!created.ok) throw new Error("expected a service");

      const result = await profile.updateService("process-automation", {
        name: "Changed",
        evidence,
      });

      expect(result).toEqual({ ok: false, ...failure });
      await expect(profile.findService("process-automation")).resolves.toEqual(created.service);
      expect(await count("service_evidence")).toBe(3);
    });

    it("leaves exactly one of several concurrent evidence replacements", async () => {
      await profile.createService(automation);
      const lists = [[ledger], [agentLab, roadmap], [vectorNotes, harbor, ledger], []];

      const results = await Promise.all(
        lists.map((evidence) => profile.updateService("process-automation", { evidence })),
      );

      expect(results.every((result) => result.ok)).toBe(true);
      const stored = await profile.findService("process-automation");
      const lengths = lists.map((list) => list.length);
      expect(lengths).toContain(stored?.evidence.length);
      expect(await count("service_evidence")).toBe(stored?.evidence.length);
    });
  });

  describe("deletes", () => {
    it("deletes a service once, with only its own evidence", async () => {
      await profile.createService(automation);
      await profile.createService(service("custom-software", 0, { evidence: [harbor, roadmap] }));

      await expect(profile.deleteService("process-automation")).resolves.toEqual({ ok: true });
      await expect(profile.deleteService("process-automation")).resolves.toEqual({
        ok: false,
        reason: "not_found",
      });

      await expect(profile.findService("process-automation")).resolves.toBeNull();
      await expect(evidenceOf("custom-software")).resolves.toEqual([
        "project:harbor-portal",
        "link:/roadmap",
      ]);
      expect(await count("service_evidence")).toBe(2);
      expect(await count("projects")).toBe(2);
      expect(await count("explorations")).toBe(2);
    });

    it("refuses to delete a project or an exploration that a service names as evidence", async () => {
      await profile.createService(automation);

      await expect(profile.deleteProject("harbor-portal")).resolves.toEqual({
        ok: false,
        reason: "referenced",
      });
      await expect(profile.deleteExploration("agent-lab")).resolves.toEqual({
        ok: false,
        reason: "referenced",
      });
      await expect(profile.findProject("harbor-portal")).resolves.not.toBeNull();
      await expect(profile.findExploration("agent-lab")).resolves.not.toBeNull();
      await expect(evidenceOf("process-automation")).resolves.toEqual([
        "project:harbor-portal",
        "link:/roadmap",
        "exploration:agent-lab",
      ]);
    });

    it("deletes a project and an exploration again once no service names them", async () => {
      await profile.createProject(projectInput("spare-project", "Spare project"));
      await profile.createExploration(explorationInput("spare-exploration", "Spare exploration"));
      const spares: ServiceEvidence[] = [
        { kind: "project", project: "spare-project" },
        { kind: "exploration", exploration: "spare-exploration" },
      ];
      await profile.createService({ ...automation, evidence: spares });
      await profile.updateService("process-automation", { evidence: [roadmap] });

      await expect(profile.deleteProject("spare-project")).resolves.toEqual({ ok: true });
      await expect(profile.deleteExploration("spare-exploration")).resolves.toEqual({ ok: true });
    });
  });
});
