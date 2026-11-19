import { describe, expect, it } from "vitest";

import { createApiClient, type Person } from "@sebela/api-client";

import { loadRoadmapReadingGuide } from "./load-roadmap-reading-guide";

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

/**
 * Requests the API never answers, held here: otherwise nothing but their own abort listeners
 * reaches them, and garbage collection may drop them before their deadline aborts them.
 */
const hanging = new Set<Request>();

const hang: Route = (request) =>
  new Promise<Response>((_resolve, reject) => {
    hanging.add(request);
    request.signal.addEventListener("abort", () => {
      hanging.delete(request);
      reject(request.signal.reason as Error);
    });
  });

describe("loadRoadmapReadingGuide", () => {
  it("returns the person's name, reading nothing but the person", async () => {
    const { client, requests } = clientWith({ "/v1/person": () => json(person()) });

    expect(await loadRoadmapReadingGuide(client)).toEqual({
      status: "ready",
      content: { name: "Robin Example" },
    });
    // The guide is static text: no roadmap or supporting-content read can make it unavailable.
    expect(requests.map((request) => `${request.method} ${new URL(request.url).pathname}`)).toEqual(
      ["GET /v1/person"],
    );
  });

  it("reads only a public route, without credentials and without a cache", async () => {
    const { client, requests } = clientWith({ "/v1/person": () => json(person()) });

    await loadRoadmapReadingGuide(client);

    for (const request of requests) {
      expect(request.headers.get("Authorization")).toBeNull();
      expect(request.cache).toBe("no-store");
    }
  });

  it("reports a profile that does not exist yet as missing", async () => {
    const { client } = clientWith({ "/v1/person": () => apiError("not_found", 404) });

    expect(await loadRoadmapReadingGuide(client)).toEqual({ status: "missing" });
  });

  it.each(failures)("is unavailable when the person route %s", async (_label, route) => {
    const { client } = clientWith({ "/v1/person": route });

    expect(await loadRoadmapReadingGuide(client)).toEqual({ status: "unavailable" });
  });

  it("gives up on an API that does not answer in time", async () => {
    const { client } = clientWith({ "/v1/person": hang });

    expect(await loadRoadmapReadingGuide(client, { timeoutMs: 20 })).toEqual({
      status: "unavailable",
    });
  });
});
