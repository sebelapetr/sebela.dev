import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  RoadmapAreaDetailSchema,
  RoadmapAreaSchema,
  RoadmapCurrentSchema,
  RoadmapModuleDetailSchema,
  RoadmapModuleSchema,
  RoadmapResourceSchema,
  RoadmapSchema,
  reservedRoadmapAreaSlugs,
  type Roadmap,
} from "@sebela/contracts";

import type { WriteEvent } from "./app.js";
import {
  anyText,
  bearer,
  connection,
  json,
  openTestBackend,
  type TestBackend,
} from "./test-support.js";

/** A small fictional roadmap. */
const basics = { slug: "basics", name: "Basics", weight: 40, position: 0 };
const practice = {
  slug: "practice",
  name: "Practice",
  description: "A **fictional** area.",
  weight: 60,
  position: 1,
};
const prompting = { slug: "prompting", area: "basics", name: "Prompting", position: 0 };
const shipping = { slug: "shipping", area: "practice", name: "Shipping", position: 0 };
const guide = {
  slug: "prompting-guide",
  module: "prompting",
  name: "A fictional prompting guide",
  type: "link",
  status: "completed",
  estimatedMinutes: 90,
  startedAt: "2025-01-02T18:00:00.000Z",
  finishedAt: "2025-01-05T18:00:00.000Z",
  link: "https://learn.example.test/prompting-guide",
  position: 0,
  topics: ["fictional-agents"],
};
const drills = {
  slug: "prompting-drills",
  module: "prompting",
  name: "Prompting drills",
  type: "project",
  status: "skipped",
  position: 1,
};

interface FieldError {
  path: string;
  message: string;
}

describe("the roadmap API", () => {
  let backend: TestBackend;
  let auth: Record<string, string>;

  beforeAll(async () => {
    backend = await openTestBackend();
    auth = bearer((await backend.services.apiKeys.createKey("roadmap routes")).key);
  });

  afterAll(async () => {
    await backend.close();
  });

  beforeEach(async () => {
    const { roadmap, profile } = backend.services;
    const { areas } = await roadmap.getRoadmap();
    for (const area of areas) {
      for (const module of area.modules) {
        for (const resource of module.resources) await roadmap.deleteResource(resource.slug);
        await roadmap.deleteModule(module.slug);
      }
      await roadmap.deleteArea(area.slug);
    }
    for (const { slug } of await profile.listTopics()) await profile.deleteTopic(slug);
    for (const [slug, name, position] of [
      ["fictional-agents", "Agents", 0],
      ["fictional-rag", "RAG", 1],
    ] as const) {
      await profile.createTopic({ slug, name, position });
    }
  });

  const request = (path: string, method = "GET", init: RequestInit = {}) =>
    backend.api().app.request(path, { method, ...init }, connection());
  const post = (path: string, body: object) => request(path, "POST", json(body, auth));
  const patch = (path: string, body: object) => request(path, "PATCH", json(body, auth));
  const remove = (path: string) => request(path, "DELETE", { headers: auth });
  const tree = async (): Promise<Roadmap> => {
    const response = await request("/v1/roadmap");
    expect(response.status).toBe(200);
    return RoadmapSchema.parse(await response.json());
  };
  const errorOf = async (response: Response) =>
    ((await response.json()) as { error: { code: string; fields?: FieldError[] } }).error;

  /** The fixture hierarchy: two areas, two modules, two resources. */
  const createHierarchy = async () => {
    for (const [path, body] of [
      ["/v1/roadmap/areas", basics],
      ["/v1/roadmap/areas", practice],
      ["/v1/roadmap/modules", prompting],
      ["/v1/roadmap/modules", shipping],
      ["/v1/roadmap/resources", guide],
      ["/v1/roadmap/resources", drills],
    ] as const) {
      expect((await post(path, body)).status, `${path} ${body.slug}`).toBe(201);
    }
  };

  it("reads an empty roadmap publicly", async () => {
    expect(await tree()).toEqual({
      summary: {
        areaCount: 0,
        moduleCount: 0,
        resourceCount: 0,
        completed: 0,
        total: 0,
        estimatedMinutes: 0,
        estimatedHours: 0,
        lastUpdatedAt: null,
      },
      areas: [],
    });
  });

  it("creates each level with its address and reads it publicly", async () => {
    const area = await post("/v1/roadmap/areas", basics);
    expect(area.status).toBe(201);
    expect(area.headers.get("location")).toBe("/v1/roadmap/areas/basics");
    const createdArea = RoadmapAreaSchema.parse(await area.json());
    expect(createdArea).toMatchObject({ ...basics, description: null });

    const module = await post("/v1/roadmap/modules", prompting);
    expect(module.status).toBe(201);
    expect(module.headers.get("location")).toBe("/v1/roadmap/modules/prompting");
    const createdModule = RoadmapModuleSchema.parse(await module.json());
    expect(createdModule).toMatchObject({ ...prompting, description: null });

    const resource = await post("/v1/roadmap/resources", guide);
    expect(resource.status).toBe(201);
    expect(resource.headers.get("location")).toBe("/v1/roadmap/resources/prompting-guide");
    const createdResource = RoadmapResourceSchema.parse(await resource.json());
    expect(createdResource).toMatchObject({
      ...guide,
      description: null,
      topics: [expect.objectContaining({ slug: "fictional-agents", name: "Agents" })],
    });

    expect(await (await request("/v1/roadmap/areas/basics")).json()).toEqual(createdArea);
    expect(await (await request("/v1/roadmap/modules/prompting")).json()).toEqual(createdModule);
    expect(await (await request("/v1/roadmap/resources/prompting-guide")).json()).toEqual(
      createdResource,
    );
  });

  it("fills omitted resource fields as a planned resource without extras", async () => {
    await post("/v1/roadmap/areas", basics);
    await post("/v1/roadmap/modules", prompting);
    const body = { slug: "bare", module: "prompting", name: "Bare", type: "text", position: 0 };

    const created = RoadmapResourceSchema.parse(
      await (await post("/v1/roadmap/resources", body)).json(),
    );

    expect(created).toMatchObject({
      status: "planned",
      description: null,
      estimatedMinutes: null,
      startedAt: null,
      finishedAt: null,
      link: null,
      topics: [],
    });
  });

  it("reads the whole ordered tree with derived progress in one call", async () => {
    await createHierarchy();

    const roadmap = await tree();

    expect(roadmap.areas.map(({ slug }) => slug)).toEqual(["basics", "practice"]);
    const [first, second] = roadmap.areas;
    expect(first?.modules.map(({ slug }) => slug)).toEqual(["prompting"]);
    expect(first?.modules[0]?.resources.map(({ slug }) => slug)).toEqual([
      "prompting-guide",
      "prompting-drills",
    ]);
    expect(first?.modules[0]?.resources[0]?.topics.map(({ slug }) => slug)).toEqual([
      "fictional-agents",
    ]);
    // Completed and skipped: completed, dated by the completed resource only.
    expect(first?.modules[0]?.progress).toMatchObject({
      completed: 1,
      total: 2,
      status: "completed",
      completedAt: guide.finishedAt,
      estimatedMinutes: 90,
    });
    expect(first?.progress).toMatchObject({
      completed: 1,
      total: 2,
      status: "completed",
      completedAt: guide.finishedAt,
    });
    // An area whose only module is empty is planned and undated.
    expect(second?.modules[0]?.resources).toEqual([]);
    expect(second?.progress).toMatchObject({
      completed: 0,
      total: 0,
      status: "planned",
      completedAt: null,
      lastUpdatedAt: null,
    });
    expect(roadmap.summary).toMatchObject({
      areaCount: 2,
      moduleCount: 2,
      resourceCount: 2,
      completed: 1,
      total: 2,
      estimatedMinutes: 90,
      estimatedHours: 2,
    });
    expect(roadmap.summary.lastUpdatedAt).not.toBeNull();
  });

  it("reads an area and a module detail publicly, equal to their overview nodes", async () => {
    await createHierarchy();
    const overview = await tree();
    const [area] = overview.areas;

    const areaResponse = await request("/v1/roadmap/tree/basics");
    expect(areaResponse.status).toBe(200);
    expect(RoadmapAreaDetailSchema.parse(await areaResponse.json())).toEqual({ area });

    const moduleResponse = await request("/v1/roadmap/tree/basics/prompting");
    expect(moduleResponse.status).toBe(200);
    const detail = RoadmapModuleDetailSchema.parse(await moduleResponse.json());
    expect(detail.module).toEqual(area?.modules[0]);
    expect(detail.area).toEqual(
      RoadmapAreaSchema.parse(await (await request("/v1/roadmap/areas/basics")).json()),
    );
  });

  it("answers a missing area, a missing module and a module of another area with not found", async () => {
    await createHierarchy();

    for (const path of [
      "/v1/roadmap/tree/missing",
      "/v1/roadmap/tree/missing/prompting",
      "/v1/roadmap/tree/basics/missing",
      // The module exists, but under the area "basics", not "practice".
      "/v1/roadmap/tree/practice/prompting",
    ]) {
      const response = await request(path);
      expect(response.status, path).toBe(404);
      expect(await response.json()).toEqual({ error: { code: "not_found", message: anyText } });
    }
  });

  it("refuses an invalid area or module slug in a detail address, naming the parameter", async () => {
    for (const [path, field] of [
      ["/v1/roadmap/tree/Not%20A%20Slug", "area"],
      ["/v1/roadmap/tree/basics/Not%20A%20Slug", "module"],
    ] as const) {
      const response = await request(path);
      expect(response.status, path).toBe(400);
      const error = await errorOf(response);
      expect(error.code).toBe("validation_failed");
      expect(error.fields?.map(({ path: name }) => name)).toEqual([field]);
    }
  });

  it("reads the current learning publicly: only in-progress areas and modules", async () => {
    expect(await (await request("/v1/roadmap/current")).json()).toEqual({ areas: [] });
    await createHierarchy();
    // Nothing is in progress yet: completed and empty parents are not current.
    expect(await (await request("/v1/roadmap/current")).json()).toEqual({ areas: [] });

    expect(
      (
        await post("/v1/roadmap/resources", {
          slug: "shipping-checklist",
          module: "shipping",
          name: "A fictional shipping checklist",
          type: "text",
          status: "in-progress",
          position: 0,
        })
      ).status,
    ).toBe(201);

    const response = await request("/v1/roadmap/current");
    expect(response.status).toBe(200);
    const current = RoadmapCurrentSchema.parse(await response.json());
    const practiceNode = (await tree()).areas[1];
    expect(current.areas.map(({ slug }) => slug)).toEqual(["practice"]);
    expect(current.areas[0]?.progress).toEqual(practiceNode?.progress);
    expect(current.areas[0]?.modules.map(({ slug }) => slug)).toEqual(["shipping"]);
    expect(current.areas[0]?.modules[0]?.progress).toEqual(practiceNode?.modules[0]?.progress);
    expect(current.areas[0]?.modules[0]).not.toHaveProperty("resources");
  });

  it.each(reservedRoadmapAreaSlugs)("refuses the reserved area slug %s", async (slug) => {
    const response = await post("/v1/roadmap/areas", { ...basics, slug });

    expect(response.status).toBe(400);
    const error = await errorOf(response);
    expect(error.code).toBe("validation_failed");
    expect(error.fields?.map(({ path }) => path)).toEqual(["slug"]);
    expect((await tree()).areas).toEqual([]);
  });

  it("refuses unknown parents and topics, naming the field", async () => {
    await createHierarchy();
    const before = await tree();

    for (const [response, field] of [
      [await post("/v1/roadmap/modules", { ...prompting, slug: "x", area: "missing" }), "area"],
      [await patch("/v1/roadmap/modules/prompting", { area: "missing" }), "area"],
      [await post("/v1/roadmap/resources", { ...drills, slug: "x", module: "missing" }), "module"],
      [await patch("/v1/roadmap/resources/prompting-drills", { module: "missing" }), "module"],
      [
        await post("/v1/roadmap/resources", { ...drills, slug: "x", topics: ["missing"] }),
        "topics",
      ],
      [await patch("/v1/roadmap/resources/prompting-guide", { topics: ["missing"] }), "topics"],
    ] as const) {
      expect(response.status).toBe(400);
      const error = await errorOf(response);
      expect(error.code).toBe("validation_failed");
      expect(error.fields?.map(({ path }) => path)).toEqual([field]);
    }
    expect(await tree()).toEqual(before);
  });

  it("refuses a finish before the stored start", async () => {
    await createHierarchy();

    const response = await patch("/v1/roadmap/resources/prompting-guide", {
      finishedAt: "2024-12-31T00:00:00.000Z",
    });

    expect(response.status).toBe(400);
    expect((await errorOf(response)).fields?.map(({ path }) => path)).toEqual(["finishedAt"]);
  });

  it("refuses a taken slug at every level as a conflict", async () => {
    await createHierarchy();

    for (const [path, body] of [
      ["/v1/roadmap/areas", basics],
      ["/v1/roadmap/modules", prompting],
      ["/v1/roadmap/resources", guide],
    ] as const) {
      const response = await post(path, body);
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: { code: "conflict", message: anyText } });
    }
  });

  it("refuses deleting content that is still referenced and keeps it", async () => {
    await createHierarchy();
    const before = await tree();

    for (const path of [
      "/v1/roadmap/areas/basics",
      "/v1/roadmap/modules/prompting",
      "/v1/topics/fictional-agents",
    ]) {
      const response = await remove(path);
      expect(response.status, path).toBe(409);
      expect((await errorOf(response)).code).toBe("conflict");
    }
    expect(await tree()).toEqual(before);
  });

  it("moves a module and a resource and replaces the topic links", async () => {
    await createHierarchy();

    const moved = await patch("/v1/roadmap/modules/prompting", { area: "practice", position: 1 });
    expect(moved.status).toBe(200);
    expect(RoadmapModuleSchema.parse(await moved.json())).toMatchObject({ area: "practice" });

    const relinked = await patch("/v1/roadmap/resources/prompting-guide", {
      module: "shipping",
      topics: ["fictional-rag", "fictional-agents"],
    });
    expect(relinked.status).toBe(200);
    const resource = RoadmapResourceSchema.parse(await relinked.json());
    expect(resource.module).toBe("shipping");
    expect(resource.topics.map(({ slug }) => slug)).toEqual(["fictional-rag", "fictional-agents"]);

    const roadmap = await tree();
    expect(roadmap.areas[0]?.modules).toEqual([]);
    expect(roadmap.areas[1]?.modules.map(({ slug }) => slug)).toEqual(["shipping", "prompting"]);
    expect(roadmap.areas[1]?.modules[0]?.resources.map(({ slug }) => slug)).toEqual([
      "prompting-guide",
    ]);
  });

  it("deletes leaves first, then their parents", async () => {
    await createHierarchy();

    for (const path of [
      "/v1/roadmap/resources/prompting-guide",
      "/v1/roadmap/resources/prompting-drills",
      "/v1/roadmap/modules/prompting",
      "/v1/roadmap/areas/basics",
    ]) {
      const response = await remove(path);
      expect(response.status, path).toBe(204);
      expect(await response.text()).toBe("");
      expect((await request(path)).status).toBe(404);
    }
    expect((await tree()).areas.map(({ slug }) => slug)).toEqual(["practice"]);
    // The topic is no longer linked and can go.
    expect((await remove("/v1/topics/fictional-agents")).status).toBe(204);
  });

  it("answers a missing record at every level with not found", async () => {
    for (const kind of ["areas", "modules", "resources"]) {
      const path = `/v1/roadmap/${kind}/missing`;
      for (const response of [
        await request(path),
        await patch(path, { name: "X" }),
        await remove(path),
      ]) {
        expect(response.status, path).toBe(404);
        expect(await response.json()).toEqual({ error: { code: "not_found", message: anyText } });
      }
    }
  });

  it("refuses a slug change and an empty change", async () => {
    await createHierarchy();

    for (const path of [
      "/v1/roadmap/areas/basics",
      "/v1/roadmap/modules/prompting",
      "/v1/roadmap/resources/prompting-guide",
    ]) {
      for (const body of [{ slug: "renamed" }, {}]) {
        const response = await patch(path, body);
        expect(response.status, path).toBe(400);
        expect((await errorOf(response)).code).toBe("validation_failed");
      }
    }
  });

  it("checks the key before the path and the body on every write", async () => {
    for (const kind of ["areas", "modules", "resources"]) {
      expect((await request(`/v1/roadmap/${kind}`, "POST", json(basics))).status).toBe(401);
      expect((await request(`/v1/roadmap/${kind}/basics`, "PATCH", json({}))).status).toBe(401);
      expect((await request(`/v1/roadmap/${kind}/Not%20A%20Slug`, "DELETE")).status).toBe(401);
    }
    expect((await tree()).areas).toEqual([]);
  });

  it("reports each committed write with its roadmap domain", async () => {
    const events: WriteEvent[] = [];
    const { app } = backend.api({
      onWrite: (event) => {
        events.push(event);
        return Promise.resolve();
      },
    });
    const send = (path: string, method: string, body?: object) =>
      app.request(path, { method, ...(body ? json(body, auth) : { headers: auth }) }, connection());

    await send("/v1/roadmap/areas", "POST", basics);
    await send("/v1/roadmap/modules", "POST", prompting);
    await send("/v1/roadmap/resources", "POST", drills);
    await send("/v1/roadmap/resources/prompting-drills", "PATCH", { status: "planned" });
    await send("/v1/roadmap/resources/missing", "PATCH", { status: "planned" });
    await send("/v1/roadmap/resources/prompting-drills", "DELETE");
    await send("/v1/roadmap/modules/prompting", "PATCH", { name: "Prompt design" });
    await send("/v1/roadmap/modules/prompting", "DELETE");
    await send("/v1/roadmap/areas/basics", "PATCH", { weight: 50 });
    await send("/v1/roadmap/areas/basics", "DELETE");

    expect(events.map(({ operationId, change }) => [operationId, change])).toEqual([
      ["createRoadmapArea", { domain: "roadmap-area", record: "basics", action: "created" }],
      ["createRoadmapModule", { domain: "roadmap-module", record: "prompting", action: "created" }],
      [
        "createRoadmapResource",
        { domain: "roadmap-resource", record: "prompting-drills", action: "created" },
      ],
      [
        "updateRoadmapResource",
        { domain: "roadmap-resource", record: "prompting-drills", action: "updated" },
      ],
      [
        "deleteRoadmapResource",
        { domain: "roadmap-resource", record: "prompting-drills", action: "deleted" },
      ],
      ["updateRoadmapModule", { domain: "roadmap-module", record: "prompting", action: "updated" }],
      ["deleteRoadmapModule", { domain: "roadmap-module", record: "prompting", action: "deleted" }],
      ["updateRoadmapArea", { domain: "roadmap-area", record: "basics", action: "updated" }],
      ["deleteRoadmapArea", { domain: "roadmap-area", record: "basics", action: "deleted" }],
    ]);
  });

  it("keeps a committed write when the notification fails", async () => {
    const { app } = backend.api({
      onWrite: () => Promise.reject(new Error("delivery failed")),
    });

    const response = await app.request(
      "/v1/roadmap/areas",
      { method: "POST", ...json(basics, auth) },
      connection(),
    );

    expect(response.status).toBe(201);
    expect((await request("/v1/roadmap/areas/basics")).status).toBe(200);
  });
});
