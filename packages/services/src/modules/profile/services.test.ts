import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  ServiceListSchema,
  ServiceSchema,
  type ServiceCreate,
  type ServiceEvidenceInput,
} from "@sebela/contracts";
import { createPersistence, readDatabaseConfig, type Persistence } from "@sebela/db";
import { createTemporaryDatabase, type TemporaryDatabase } from "@sebela/db/testing";

import { DomainError } from "../../errors.js";
import { createProfileService, type ProfileService } from "./index.js";

const roadmap: ServiceEvidenceInput = { kind: "link", label: "Roadmap", path: "/roadmap" };

const automation: ServiceCreate = {
  slug: "process-automation",
  name: "Process automation",
  summary: "A **fictional** service that connects existing tools.",
  audience: "Fictional teams that copy data between systems by hand.",
  deliverable: "A working integration with its documentation.",
  position: 1,
  evidence: [
    { kind: "project", project: "routing-engine" },
    roadmap,
    { kind: "exploration", exploration: "agent-lab" },
  ],
};

const prototyping: ServiceCreate = {
  ...automation,
  slug: "ai-prototyping",
  name: "AI prototyping",
  position: 0,
  evidence: [],
};

describe("service service", () => {
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
    for (const [position, slug] of ["routing-engine", "fleet-dashboard"].entries()) {
      await profile.createProject({
        slug,
        experience: "northwind-lead",
        name: slug,
        summary: "A fictional project.",
        problem: "A fictional problem.",
        workDone: "Fictional work.",
        result: "A fictional result.",
        startedOn: "2022-01-01",
        endedOn: null,
        links: [],
        selectedForHomepage: false,
        position,
        technologies: [],
      });
    }
    for (const [position, slug] of ["agent-lab", "vector-notes"].entries()) {
      await profile.createExploration({
        slug,
        name: slug,
        summary: "A fictional exploration.",
        status: "designed",
        concepts: [],
        startedOn: "2025-02-01",
        endedOn: null,
        position,
        technologies: [],
        topics: [],
      });
    }
  });

  afterAll(async () => {
    await persistence.close();
    await database.drop();
  });

  beforeEach(async () => {
    for (const { slug } of await persistence.profile.listServices()) {
      await persistence.profile.deleteService(slug);
    }
  });

  it("lists no services", async () => {
    await expect(profile.listServices()).resolves.toEqual([]);
  });

  it("creates a service in the contract shape with its evidence resolved in order", async () => {
    const created = await profile.createService(automation);

    expect(ServiceSchema.parse(created)).toEqual(created);
    const { evidence, ...fields } = automation;
    expect(created).toMatchObject(fields);
    expect(created.evidence).toEqual([
      {
        kind: "project",
        project: {
          slug: "routing-engine",
          name: "routing-engine",
          summary: "A fictional project.",
          experience: "northwind-lead",
        },
      },
      evidence[1],
      {
        kind: "exploration",
        exploration: {
          slug: "agent-lab",
          name: "agent-lab",
          summary: "A fictional exploration.",
          status: "designed",
        },
      },
    ]);
    await expect(profile.getService("process-automation")).resolves.toEqual(created);
  });

  it("creates a service without evidence", async () => {
    await expect(profile.createService(prototyping)).resolves.toMatchObject({ evidence: [] });
  });

  it("lists services by position", async () => {
    const later = await profile.createService(automation);
    const first = await profile.createService(prototyping);

    const listed = await profile.listServices();

    expect(ServiceListSchema.parse(listed)).toEqual([first, later]);
  });

  it("reports an unknown slug as not found", async () => {
    await expect(profile.getService("missing")).rejects.toBeInstanceOf(DomainError);
    await expect(profile.getService("missing")).rejects.toMatchObject({ code: "not_found" });
    await expect(profile.updateService("missing", { name: "X" })).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(profile.deleteService("missing")).rejects.toMatchObject({ code: "not_found" });
  });

  it("refuses a duplicate slug as a conflict", async () => {
    await profile.createService(automation);

    await expect(profile.createService(automation)).rejects.toMatchObject({ code: "conflict" });
  });

  const refusals: [string, ServiceEvidenceInput[], string][] = [
    [
      "unknown projects",
      [
        { kind: "project", project: "routing-engine" },
        { kind: "project", project: "ghost-portal" },
        { kind: "project", project: "lost-app" },
      ],
      "ghost-portal, lost-app",
    ],
    [
      "a repeated project",
      [
        { kind: "project", project: "fleet-dashboard" },
        { kind: "project", project: "fleet-dashboard" },
      ],
      "once",
    ],
    [
      "unknown explorations",
      [
        { kind: "exploration", exploration: "agent-lab" },
        { kind: "exploration", exploration: "quantum-notes" },
      ],
      "quantum-notes",
    ],
    [
      "a repeated exploration",
      [
        { kind: "exploration", exploration: "vector-notes" },
        { kind: "exploration", exploration: "vector-notes" },
      ],
      "once",
    ],
  ];

  it.each(refusals)("refuses a create with %s as invalid", async (_, evidence, text) => {
    await expect(profile.createService({ ...automation, evidence })).rejects.toMatchObject({
      code: "validation_failed",
      fields: [{ path: "evidence", message: expect.stringContaining(text) as unknown }],
    });
    await expect(profile.listServices()).resolves.toEqual([]);
  });

  it.each(refusals)("refuses an update with %s and changes nothing", async (_, evidence) => {
    const created = await profile.createService(automation);

    await expect(
      profile.updateService("process-automation", { name: "Changed", evidence }),
    ).rejects.toMatchObject({ code: "validation_failed", fields: [{ path: "evidence" }] });
    await expect(profile.getService("process-automation")).resolves.toEqual(created);
  });

  it("changes only the given fields and keeps the evidence when it is omitted", async () => {
    const created = await profile.createService(automation);

    const updated = await profile.updateService("process-automation", {
      deliverable: "A fictional handover.",
      summary: undefined,
    });

    expect(updated).toMatchObject({
      deliverable: "A fictional handover.",
      summary: automation.summary,
    });
    expect(updated.evidence).toEqual(created.evidence);
    expect(updated.id).toBe(created.id);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt));
  });

  it("replaces the evidence with a given list in its order and removes it with an empty one", async () => {
    await profile.createService(automation);

    const replaced = await profile.updateService("process-automation", {
      evidence: [
        { kind: "exploration", exploration: "vector-notes" },
        { kind: "project", project: "fleet-dashboard" },
        roadmap,
      ],
    });

    expect(
      replaced.evidence.map((piece) =>
        piece.kind === "project"
          ? piece.project.slug
          : piece.kind === "exploration"
            ? piece.exploration.slug
            : piece.path,
      ),
    ).toEqual(["vector-notes", "fleet-dashboard", "/roadmap"]);
    await expect(
      profile.updateService("process-automation", { evidence: [] }),
    ).resolves.toMatchObject({ evidence: [] });
  });

  it("deletes a service and keeps the projects and explorations it names", async () => {
    await profile.createService(automation);

    await profile.deleteService("process-automation");

    await expect(profile.getService("process-automation")).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(profile.getProject("routing-engine")).resolves.toMatchObject({
      slug: "routing-engine",
    });
    await expect(profile.getExploration("agent-lab")).resolves.toMatchObject({
      slug: "agent-lab",
    });
  });

  it("refuses to delete a project or an exploration a service names as a conflict", async () => {
    const created = await profile.createService(automation);

    await expect(profile.deleteProject("routing-engine")).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining("service") as unknown,
    });
    await expect(profile.deleteExploration("agent-lab")).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining("service") as unknown,
    });
    await expect(profile.getService("process-automation")).resolves.toEqual(created);
  });
});
