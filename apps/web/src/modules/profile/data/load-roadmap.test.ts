import { describe, expect, it } from "vitest";

import { createApiClient, type Person, type Roadmap } from "@sebela/api-client";

import { loadRoadmap } from "./load-roadmap";

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

const progress = {
  completed: 1,
  total: 2,
  status: "in-progress" as const,
  completedAt: null,
  lastUpdatedAt: STAMP,
  estimatedMinutes: 90,
};

function roadmap(): Roadmap {
  return {
    summary: {
      areaCount: 1,
      moduleCount: 1,
      resourceCount: 2,
      completed: 1,
      total: 2,
      estimatedMinutes: 90,
      estimatedHours: 2,
      lastUpdatedAt: STAMP,
    },
    areas: [
      {
        id: "8c1e2f3a-4b5c-4d6e-8f70-81a2b3c4d5e6",
        slug: "fictional-area",
        name: "Fictional area",
        description: "A made-up **area**.",
        weight: 40,
        position: 0,
        createdAt: STAMP,
        updatedAt: STAMP,
        progress,
        modules: [
          {
            id: "9d2f3a4b-5c6d-4e7f-8a81-92b3c4d5e6f7",
            slug: "fictional-module",
            name: "Fictional module",
            description: null,
            position: 0,
            createdAt: STAMP,
            updatedAt: STAMP,
            progress,
            resources: [],
          },
        ],
      },
    ],
  };
}

function emptyRoadmap(): Roadmap {
  return {
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
  };
}

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

describe("loadRoadmap", () => {
  it("returns the API's roadmap as it is, with the person's name and headline", async () => {
    const tree = roadmap();
    const { client } = clientWith({
      "/v1/person": () => json(person()),
      "/v1/roadmap": () => json(tree),
    });

    expect(await loadRoadmap(client)).toEqual({
      status: "ready",
      content: { name: "Robin Example", headline: "Fictional engineer for tests", roadmap: tree },
    });
  });

  it("is ready with a roadmap that has no areas yet", async () => {
    const { client } = clientWith({
      "/v1/person": () => json(person()),
      "/v1/roadmap": () => json(emptyRoadmap()),
    });

    expect(await loadRoadmap(client)).toEqual({
      status: "ready",
      content: {
        name: "Robin Example",
        headline: "Fictional engineer for tests",
        roadmap: emptyRoadmap(),
      },
    });
  });

  it("reads only public routes, without credentials and without a cache", async () => {
    const { client, requests } = clientWith({
      "/v1/person": () => json(person()),
      "/v1/roadmap": () => json(emptyRoadmap()),
    });

    await loadRoadmap(client);

    expect(
      requests.map((request) => [request.method, new URL(request.url).pathname]).sort(),
    ).toEqual([
      ["GET", "/v1/person"],
      ["GET", "/v1/roadmap"],
    ]);
    for (const request of requests) {
      expect(request.headers.get("Authorization")).toBeNull();
      expect(request.cache).toBe("no-store");
    }
  });

  it("reports a profile that does not exist yet as missing", async () => {
    const { client } = clientWith({
      "/v1/person": () => apiError("not_found", 404),
      "/v1/roadmap": () => json(roadmap()),
    });

    expect(await loadRoadmap(client)).toEqual({ status: "missing" });
  });

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

  it.each(failures)("is unavailable when the person route %s", async (_label, route) => {
    const { client } = clientWith({
      "/v1/person": route,
      "/v1/roadmap": () => json(roadmap()),
    });

    expect(await loadRoadmap(client)).toEqual({ status: "unavailable" });
  });

  it.each(failures)(
    "is unavailable, never an empty roadmap, when the roadmap route %s",
    async (_label, route) => {
      const { client } = clientWith({
        "/v1/person": () => json(person()),
        "/v1/roadmap": route,
      });

      expect(await loadRoadmap(client)).toEqual({ status: "unavailable" });
    },
  );

  it("gives up on an API that does not answer in time", async () => {
    const hang: Route = (request) =>
      new Promise<Response>((_resolve, reject) => {
        request.signal.addEventListener("abort", () => {
          reject(request.signal.reason as Error);
        });
      });
    const { client } = clientWith({ "/v1/person": hang, "/v1/roadmap": hang });

    expect(await loadRoadmap(client, { timeoutMs: 20 })).toEqual({ status: "unavailable" });
  });
});
