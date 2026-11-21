import { describe, expect, it } from "vitest";

import { createApiClient, type Person, type Service } from "@sebela/api-client";

import { loadServices } from "./load-services";

const BASE = "https://api.example.test";
const STAMP = "2026-01-01T00:00:00.000Z";

function person(overrides: Partial<Person> = {}): Person {
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
    ...overrides,
  };
}

function service(slug: string): Service {
  return {
    id: "5d6e7f80-9a1b-4c2d-8e3f-4a5b6c7d8e9f",
    slug,
    name: `Fictional ${slug}`,
    summary: "Made up.",
    audience: "Fictional firms.",
    deliverable: "A fictional result.",
    position: 0,
    evidence: [{ kind: "link", label: "Experience", path: "/experience" }],
    createdAt: STAMP,
    updatedAt: STAMP,
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

/**
 * Requests the API never answers, held here: otherwise nothing but their own abort listeners
 * reaches them, and garbage collection may drop them before their deadline aborts them.
 */
const hanging = new Set<Request>();

describe("loadServices", () => {
  it("returns the services in the API's order with the person's services prose", async () => {
    const services = [service("automation"), service("software"), service("ai")];
    const steps = [
      { title: "Understand the problem", description: "A short **call**." },
      { title: "Build in small steps", description: "Increments." },
    ];
    const { client } = clientWith({
      "/v1/person": () =>
        json(
          person({
            servicesIntro: "Robin connects *fictional* systems.",
            collaborationSteps: steps,
            servicesNote: "Software is long-standing practice; AI is newer.",
          }),
        ),
      "/v1/services": () => json(services),
    });

    expect(await loadServices(client)).toEqual({
      status: "ready",
      content: {
        name: "Robin Example",
        headline: "Fictional engineer for tests",
        intro: "Robin connects *fictional* systems.",
        services,
        collaborationSteps: steps,
        note: "Software is long-standing practice; AI is newer.",
      },
    });
  });

  it("is ready without services and without any services prose", async () => {
    const { client } = clientWith({
      "/v1/person": () => json(person()),
      "/v1/services": () => json([]),
    });

    expect(await loadServices(client)).toEqual({
      status: "ready",
      content: {
        name: "Robin Example",
        headline: "Fictional engineer for tests",
        intro: null,
        services: [],
        collaborationSteps: [],
        note: null,
      },
    });
  });

  it("reads only public routes, without credentials and without a cache", async () => {
    const { client, requests } = clientWith({
      "/v1/person": () => json(person()),
      "/v1/services": () => json([]),
    });

    await loadServices(client);

    expect(
      requests.map((request) => [request.method, new URL(request.url).pathname]).sort(),
    ).toEqual([
      ["GET", "/v1/person"],
      ["GET", "/v1/services"],
    ]);
    for (const request of requests) {
      expect(request.headers.get("Authorization")).toBeNull();
      expect(request.cache).toBe("no-store");
    }
  });

  it("reports a profile that does not exist yet as missing", async () => {
    const { client } = clientWith({
      "/v1/person": () => apiError("not_found", 404),
      "/v1/services": () => json([]),
    });

    expect(await loadServices(client)).toEqual({ status: "missing" });
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
      "/v1/services": () => json([service("a")]),
    });

    expect(await loadServices(client)).toEqual({ status: "unavailable" });
  });

  it.each(failures)(
    "is unavailable, never a page without its services, when the services route %s",
    async (_label, route) => {
      const { client } = clientWith({
        "/v1/person": () => json(person()),
        "/v1/services": route,
      });

      expect(await loadServices(client)).toEqual({ status: "unavailable" });
    },
  );

  it("gives up on an API that does not answer in time", async () => {
    const hang: Route = (request) =>
      new Promise<Response>((_resolve, reject) => {
        hanging.add(request);
        request.signal.addEventListener("abort", () => {
          hanging.delete(request);
          reject(request.signal.reason as Error);
        });
      });
    const { client } = clientWith({ "/v1/person": hang, "/v1/services": hang });

    expect(await loadServices(client, { timeoutMs: 20 })).toEqual({ status: "unavailable" });
  });
});
