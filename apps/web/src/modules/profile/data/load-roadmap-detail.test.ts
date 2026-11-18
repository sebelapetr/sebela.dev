import { describe, expect, it } from "vitest";

import {
  createApiClient,
  type Person,
  type RoadmapArea,
  type RoadmapAreaDetail,
  type RoadmapModuleDetail,
  type RoadmapProgress,
  type RoadmapTreeModule,
} from "@sebela/api-client";

import { loadRoadmapArea, loadRoadmapModule } from "./load-roadmap-detail";

const BASE = "https://api.example.test";
const STAMP = "2026-01-01T00:00:00.000Z";

function person(): Person {
  return {
    id: "0b6f4f43-61a4-4c1e-8f0e-6f1c1c5d2a10",
    name: "Robin Example",
    headline: "Fictional engineer for tests",
    shortBio: "Robin is **made up** for the tests.",
    longBio: null,
    location: null,
    email: null,
    links: [],
    availability: null,
    careerStartedOn: null,
    servicesIntro: null,
    collaborationSteps: [],
    servicesNote: null,
    photoId: null,
    cvPdfId: null,
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

const progress: RoadmapProgress = {
  completed: 1,
  total: 2,
  status: "in-progress",
  completedAt: null,
  lastUpdatedAt: STAMP,
  estimatedMinutes: 90,
};

const area: RoadmapArea = {
  id: "8c1e2f3a-4b5c-4d6e-8f70-81a2b3c4d5e6",
  slug: "fictional-area",
  name: "Fictional area",
  description: "A made-up **area**.",
  weight: 40,
  position: 0,
  createdAt: STAMP,
  updatedAt: STAMP,
};

const treeModule: RoadmapTreeModule = {
  id: "9d2f3a4b-5c6d-4e7f-8a81-92b3c4d5e6f7",
  slug: "fictional-module",
  name: "Fictional module",
  description: null,
  position: 0,
  createdAt: STAMP,
  updatedAt: STAMP,
  progress,
  resources: [],
};

const areaDetail: RoadmapAreaDetail = { area: { ...area, progress, modules: [treeModule] } };
const moduleDetail: RoadmapModuleDetail = { area, module: treeModule };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function apiError(code: string, status: number): Response {
  return json({ error: { code, message: "A fictional failure." } }, status);
}

type Route = (request: Request) => Response | Promise<Response>;

const AREA_PATH = "/v1/roadmap/tree/fictional-area";
const MODULE_PATH = "/v1/roadmap/tree/fictional-area/fictional-module";

function clientWith(routes: Record<string, Route>) {
  const requests: Request[] = [];
  const client = createApiClient({
    baseUrl: BASE,
    fetch: async (request) => {
      requests.push(request);
      const path = new URL(request.url).pathname;
      const route = routes[path];
      if (!route) throw new Error(`unexpected request to ${path}`);
      return route(request);
    },
  });
  return { client, requests };
}

const failures: [string, Route][] = [
  ["fails", () => apiError("internal_error", 500)],
  ["is rate limited", () => apiError("rate_limited", 429)],
  ["answers through a failing proxy", () => new Response("Bad gateway", { status: 502 })],
  [
    "cannot be reached",
    () => {
      throw new TypeError("fetch failed");
    },
  ],
];

const hang: Route = (request) =>
  new Promise<Response>((_resolve, reject) => {
    request.signal.addEventListener("abort", () => {
      reject(request.signal.reason as Error);
    });
  });

describe("loadRoadmapArea", () => {
  it("returns the API's area as it is, with the person's name and headline", async () => {
    const { client } = clientWith({
      "/v1/person": () => json(person()),
      [AREA_PATH]: () => json(areaDetail),
    });

    expect(await loadRoadmapArea(client, "fictional-area")).toEqual({
      status: "ready",
      content: {
        name: "Robin Example",
        headline: "Fictional engineer for tests",
        area: areaDetail.area,
      },
    });
  });

  it("reads only public routes, without credentials and without a cache", async () => {
    const { client, requests } = clientWith({
      "/v1/person": () => json(person()),
      [AREA_PATH]: () => json(areaDetail),
    });

    await loadRoadmapArea(client, "fictional-area");

    expect(
      requests.map((request) => `${request.method} ${new URL(request.url).pathname}`).sort(),
    ).toEqual([`GET ${AREA_PATH}`, "GET /v1/person"].sort());
    for (const request of requests) {
      expect(request.headers.get("Authorization")).toBeNull();
      expect(request.cache).toBe("no-store");
    }
  });

  it("keeps the slug inside the area's path segment", async () => {
    const { client, requests } = clientWith({
      "/v1/person": () => json(person()),
      "/v1/roadmap/tree/..%2Fperson": () => apiError("validation_failed", 400),
    });

    expect(await loadRoadmapArea(client, "../person")).toEqual({ status: "missing" });
    expect(requests.map((request) => new URL(request.url).pathname)).toContain(
      "/v1/roadmap/tree/..%2Fperson",
    );
  });

  it.each([
    ["the area does not exist", () => apiError("not_found", 404)],
    ["the address is not a slug", () => apiError("validation_failed", 400)],
  ])("reports the page as missing when %s", async (_label, route) => {
    const { client } = clientWith({ "/v1/person": () => json(person()), [AREA_PATH]: route });

    expect(await loadRoadmapArea(client, "fictional-area")).toEqual({ status: "missing" });
  });

  it("reports a profile that does not exist yet as missing", async () => {
    const { client } = clientWith({
      "/v1/person": () => apiError("not_found", 404),
      [AREA_PATH]: () => json(areaDetail),
    });

    expect(await loadRoadmapArea(client, "fictional-area")).toEqual({ status: "missing" });
  });

  it.each(failures)("is unavailable, never missing, when the area route %s", async (_l, route) => {
    const { client } = clientWith({ "/v1/person": () => json(person()), [AREA_PATH]: route });

    expect(await loadRoadmapArea(client, "fictional-area")).toEqual({ status: "unavailable" });
  });

  it.each(failures)("is unavailable when the person route %s", async (_label, route) => {
    const { client } = clientWith({ "/v1/person": route, [AREA_PATH]: () => json(areaDetail) });

    expect(await loadRoadmapArea(client, "fictional-area")).toEqual({ status: "unavailable" });
  });

  it("gives up on an API that does not answer in time", async () => {
    const { client } = clientWith({ "/v1/person": hang, [AREA_PATH]: hang });

    expect(await loadRoadmapArea(client, "fictional-area", { timeoutMs: 20 })).toEqual({
      status: "unavailable",
    });
  });
});

describe("loadRoadmapModule", () => {
  it("returns the API's module and its area as they are, with the person's name", async () => {
    const { client } = clientWith({
      "/v1/person": () => json(person()),
      [MODULE_PATH]: () => json(moduleDetail),
    });

    expect(await loadRoadmapModule(client, "fictional-area", "fictional-module")).toEqual({
      status: "ready",
      content: {
        name: "Robin Example",
        headline: "Fictional engineer for tests",
        area,
        module: treeModule,
      },
    });
  });

  it("reads only public routes, without credentials and without a cache", async () => {
    const { client, requests } = clientWith({
      "/v1/person": () => json(person()),
      [MODULE_PATH]: () => json(moduleDetail),
    });

    await loadRoadmapModule(client, "fictional-area", "fictional-module");

    expect(
      requests.map((request) => `${request.method} ${new URL(request.url).pathname}`).sort(),
    ).toEqual([`GET ${MODULE_PATH}`, "GET /v1/person"].sort());
    for (const request of requests) {
      expect(request.headers.get("Authorization")).toBeNull();
      expect(request.cache).toBe("no-store");
    }
  });

  it.each([
    ["the module does not exist or lies under another area", () => apiError("not_found", 404)],
    ["the address is not a slug", () => apiError("validation_failed", 400)],
  ])("reports the page as missing when %s", async (_label, route) => {
    const { client } = clientWith({ "/v1/person": () => json(person()), [MODULE_PATH]: route });

    expect(await loadRoadmapModule(client, "fictional-area", "fictional-module")).toEqual({
      status: "missing",
    });
  });

  it.each(failures)(
    "is unavailable, never missing, when the module route %s",
    async (_l, route) => {
      const { client } = clientWith({ "/v1/person": () => json(person()), [MODULE_PATH]: route });

      expect(await loadRoadmapModule(client, "fictional-area", "fictional-module")).toEqual({
        status: "unavailable",
      });
    },
  );

  it("gives up on an API that does not answer in time", async () => {
    const { client } = clientWith({ "/v1/person": hang, [MODULE_PATH]: hang });

    expect(
      await loadRoadmapModule(client, "fictional-area", "fictional-module", { timeoutMs: 20 }),
    ).toEqual({ status: "unavailable" });
  });
});
