import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ServiceListSchema, ServiceSchema, type Service } from "@sebela/contracts";

import type { WriteEvent } from "./app.js";
import {
  anyText,
  bearer,
  connection,
  json,
  openTestBackend,
  type TestBackend,
} from "./test-support.js";

const roadmap = { kind: "link", label: "Roadmap", path: "/roadmap" };

/** Fictional services. */
const automation = {
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
const prototyping = {
  slug: "ai-prototyping",
  name: "AI prototyping",
  summary: "A fictional service that tries an idea quickly.",
  audience: "Fictional founders with an untested idea.",
  deliverable: "A working prototype.",
  position: 0,
};

interface FieldError {
  path: string;
  message: string;
}

/** What each piece of evidence points at: a project or exploration slug, or a site path. */
const targets = (service: Service) =>
  service.evidence.map((piece) =>
    piece.kind === "project"
      ? piece.project.slug
      : piece.kind === "exploration"
        ? piece.exploration.slug
        : piece.path,
  );

describe("the service API", () => {
  let backend: TestBackend;
  let auth: Record<string, string>;

  beforeAll(async () => {
    backend = await openTestBackend();
    auth = bearer((await backend.services.apiKeys.createKey("service routes")).key);
    const { profile } = backend.services;
    await profile.createOrganization({
      logoId: null,
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
        coverId: null,
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
    await backend.close();
  });

  beforeEach(async () => {
    const { profile } = backend.services;
    for (const { slug } of await profile.listServices()) {
      await profile.deleteService(slug);
    }
  });

  const request = (path: string, method = "GET", init: RequestInit = {}) =>
    backend.api().app.request(path, { method, ...init }, connection());
  const create = (body: object) => request("/v1/services", "POST", json(body, auth));

  it("lists no services publicly", async () => {
    const response = await request("/v1/services");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it("creates a service with its address, and reads it publicly with typed evidence in order", async () => {
    const created = await create(automation);

    expect(created.status).toBe(201);
    expect(created.headers.get("location")).toBe("/v1/services/process-automation");
    const body = ServiceSchema.parse(await created.json());
    const { evidence, ...fields } = automation;
    expect(body).toMatchObject(fields);
    expect(Object.keys(body).sort()).toEqual(
      [...Object.keys(automation), "id", "createdAt", "updatedAt"].sort(),
    );
    expect(body.evidence).toEqual([
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

    const read = await request("/v1/services/process-automation");
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual(body);
  });

  it("fills omitted evidence with an empty list", async () => {
    const created = ServiceSchema.parse(await (await create(prototyping)).json());

    expect(created.evidence).toEqual([]);
  });

  it("lists services by position, then slug", async () => {
    for (const service of [automation, prototyping, { ...prototyping, slug: "data-review" }]) {
      expect((await create(service)).status).toBe(201);
    }

    const listed = ServiceListSchema.parse(await (await request("/v1/services")).json());

    expect(listed.map((service) => service.slug)).toEqual([
      "ai-prototyping",
      "data-review",
      "process-automation",
    ]);
    expect(targets(listed[2] as Service)).toEqual(["routing-engine", "/roadmap", "agent-lab"]);
  });

  it("refuses a duplicate slug with a conflict", async () => {
    await create(automation);

    const again = await create(automation);

    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: { code: "conflict", message: anyText } });
  });

  const project = (slug: string) => ({ kind: "project", project: slug });
  const exploration = (slug: string) => ({ kind: "exploration", exploration: slug });
  const link = (path: string) => ({ kind: "link", label: "Somewhere", path });

  it.each([
    ["an unknown project", [project("routing-engine"), project("ghost-portal")], "evidence"],
    ["an unknown exploration", [exploration("quantum-notes")], "evidence"],
    ["a repeated project", [project("fleet-dashboard"), project("fleet-dashboard")], "evidence"],
    ["a repeated exploration", [exploration("agent-lab"), exploration("agent-lab")], "evidence"],
    ["an unsupported kind", [{ kind: "testimonial", testimonial: "x" }], "evidence"],
    ["a javascript link", [link("javascript:alert(1)")], "evidence"],
    ["an outside link", [link("https://example.com/")], "evidence"],
    ["a scheme-relative link", [link("//example.com/")], "evidence"],
    ["a project without its slug", [{ kind: "project" }], "evidence"],
  ])("refuses evidence with %s and stores nothing", async (_, evidence, field) => {
    const response = await create({ ...automation, evidence });

    expect(response.status).toBe(400);
    const { error } = (await response.json()) as {
      error: { code: string; fields?: FieldError[] };
    };
    expect(error.code).toBe("validation_failed");
    // The evidence is named by its path or by a path below it.
    expect(error.fields?.some(({ path }) => path === field || path.startsWith(`${field}.`))).toBe(
      true,
    );
    await expect(backend.services.profile.listServices()).resolves.toEqual([]);
  });

  it("names the missing projects in the refusal", async () => {
    const response = await create({
      ...automation,
      evidence: [project("ghost-portal"), project("lost-app")],
    });

    expect(await response.json()).toEqual({
      error: {
        code: "validation_failed",
        message: anyText,
        fields: [
          {
            path: "evidence",
            message: expect.stringContaining("ghost-portal, lost-app") as unknown,
          },
        ],
      },
    });
  });

  it.each([
    ["a missing name", { ...automation, name: undefined }, "name"],
    ["a missing audience", { ...automation, audience: undefined }, "audience"],
    ["an empty deliverable", { ...automation, deliverable: " " }, "deliverable"],
    ["a negative position", { ...automation, position: -1 }, "position"],
    ["a visibility flag", { ...automation, visible: true }, "visible"],
  ])("refuses %s with the field and stores nothing", async (_, body, field) => {
    const response = await create(body);

    expect(response.status).toBe(400);
    const { error } = (await response.json()) as {
      error: { code: string; fields?: FieldError[] };
    };
    expect(error.code).toBe("validation_failed");
    expect(
      error.fields?.some(({ path, message }) => path === field || message.includes(`"${field}"`)),
    ).toBe(true);
    await expect(backend.services.profile.listServices()).resolves.toEqual([]);
  });

  it("updates only the given fields and keeps the evidence when it is omitted", async () => {
    const created = (await (await create(automation)).json()) as Service;

    const response = await request(
      "/v1/services/process-automation",
      "PATCH",
      json({ deliverable: "A fictional handover." }, auth),
    );

    expect(response.status).toBe(200);
    const updated = ServiceSchema.parse(await response.json());
    expect(updated).toMatchObject({
      deliverable: "A fictional handover.",
      name: automation.name,
      id: created.id,
      createdAt: created.createdAt,
    });
    expect(updated.evidence).toEqual(created.evidence);
    expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt));
  });

  it("replaces the evidence with a given list in its order, and removes it with an empty one", async () => {
    await create(automation);

    const replaced = ServiceSchema.parse(
      await (
        await request(
          "/v1/services/process-automation",
          "PATCH",
          json(
            {
              evidence: [exploration("vector-notes"), roadmap, project("fleet-dashboard")],
            },
            auth,
          ),
        )
      ).json(),
    );
    const cleared = ServiceSchema.parse(
      await (
        await request("/v1/services/process-automation", "PATCH", json({ evidence: [] }, auth))
      ).json(),
    );

    expect(targets(replaced)).toEqual(["vector-notes", "/roadmap", "fleet-dashboard"]);
    expect(cleared.evidence).toEqual([]);
  });

  it.each([
    ["a change of the slug", { slug: "renamed" }, undefined],
    ["an empty change", {}, undefined],
    ["cleared evidence", { evidence: null }, "evidence"],
    ["an unknown project", { name: "Changed", evidence: [project("ghost-portal")] }, "evidence"],
    [
      "an unknown exploration",
      { name: "Changed", evidence: [roadmap, exploration("quantum-notes")] },
      "evidence",
    ],
  ])("refuses an update with %s and changes nothing", async (_, body, field) => {
    const created = await (await create(automation)).json();

    const response = await request("/v1/services/process-automation", "PATCH", json(body, auth));

    expect(response.status).toBe(400);
    const { error } = (await response.json()) as {
      error: { code: string; fields?: FieldError[] };
    };
    expect(error.code).toBe("validation_failed");
    if (field) expect(error.fields).toEqual([expect.objectContaining({ path: field })]);
    expect(await (await request("/v1/services/process-automation")).json()).toEqual(created);
  });

  it("answers a missing service with not found", async () => {
    for (const response of [
      await request("/v1/services/missing"),
      await request("/v1/services/missing", "PATCH", json({ name: "X" }, auth)),
      await request("/v1/services/missing", "DELETE", { headers: auth }),
    ]) {
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: { code: "not_found", message: anyText } });
    }
  });

  it("refuses a malformed slug in the path with the field", async () => {
    for (const response of [
      await request("/v1/services/Not%20A%20Slug"),
      await request("/v1/services/process.automation", "PATCH", json({ name: "X" }, auth)),
      await request("/v1/services/UPPER", "DELETE", { headers: auth }),
    ]) {
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: {
          code: "validation_failed",
          message: anyText,
          fields: [expect.objectContaining({ path: "slug" })],
        },
      });
    }
  });

  it("checks the key before the path and the body", async () => {
    expect((await request("/v1/services/Not%20A%20Slug", "DELETE")).status).toBe(401);
    expect((await request("/v1/services/process-automation", "PATCH", json({}))).status).toBe(401);
    expect((await request("/v1/services", "POST", json(automation))).status).toBe(401);
    await expect(backend.services.profile.listServices()).resolves.toEqual([]);
  });

  it("refuses to delete a project or an exploration a service names", async () => {
    await create(automation);

    for (const response of [
      await request("/v1/projects/routing-engine", "DELETE", { headers: auth }),
      await request("/v1/explorations/agent-lab", "DELETE", { headers: auth }),
    ]) {
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: { code: "conflict", message: anyText } });
    }
    expect((await request("/v1/projects/routing-engine")).status).toBe(200);
    expect((await request("/v1/explorations/agent-lab")).status).toBe(200);
  });

  it("deletes a service with the key, keeps what it names, and reports each write", async () => {
    const events: WriteEvent[] = [];
    const { app } = backend.api({
      onWrite: (event) => {
        events.push(event);
        return Promise.resolve();
      },
    });
    await app.request("/v1/services", { method: "POST", ...json(automation, auth) }, connection());

    const deleted = await app.request(
      "/v1/services/process-automation",
      { method: "DELETE", headers: auth },
      connection(),
    );

    expect(deleted.status).toBe(204);
    expect(await deleted.text()).toBe("");
    expect(events).toEqual([
      { operationId: "createService", method: "POST", path: "/v1/services" },
      { operationId: "deleteService", method: "DELETE", path: "/v1/services/process-automation" },
    ]);
    expect((await request("/v1/services/process-automation")).status).toBe(404);
    expect((await request("/v1/projects/routing-engine")).status).toBe(200);
    expect((await request("/v1/explorations/agent-lab")).status).toBe(200);
  });
});
