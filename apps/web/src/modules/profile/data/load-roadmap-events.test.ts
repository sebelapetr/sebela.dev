import { describe, expect, it } from "vitest";

import {
  createApiClient,
  type Person,
  type RoadmapEvent,
  type RoadmapEventList,
} from "@sebela/api-client";

import { loadRoadmapEvents } from "./load-roadmap-events";

const BASE = "https://api.example.test";
const STAMP = "2026-01-01T00:00:00.000Z";
const EVENTS_PATH = "/v1/roadmap/events";

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

function event(slug: string, startsOn: string, endsOn: string): RoadmapEvent {
  return {
    id: "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f",
    slug,
    name: `Fictional ${slug}`,
    kind: "meetup",
    organizer: null,
    startsOn,
    endsOn,
    place: null,
    online: true,
    link: null,
    takeaways: null,
    topics: [],
    attendanceSeconds: 0,
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

// The API's order, newest first; the loader must keep it as it is.
const events: RoadmapEventList = [
  event("later", "2026-03-02", "2026-03-03"),
  event("earlier", "2025-11-20", "2025-11-20"),
];

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

describe("loadRoadmapEvents", () => {
  it("returns the API's events as they are, with the person's name and headline", async () => {
    const { client } = clientWith({
      "/v1/person": () => json(person()),
      [EVENTS_PATH]: () => json(events),
    });

    expect(await loadRoadmapEvents(client)).toEqual({
      status: "ready",
      content: { name: "Robin Example", headline: "Fictional engineer for tests", events },
    });
  });

  it("returns no events as ready, never as missing", async () => {
    const { client } = clientWith({
      "/v1/person": () => json(person()),
      [EVENTS_PATH]: () => json([]),
    });

    expect(await loadRoadmapEvents(client)).toMatchObject({
      status: "ready",
      content: { events: [] },
    });
  });

  it("reads only public routes, without credentials and without a cache", async () => {
    const { client, requests } = clientWith({
      "/v1/person": () => json(person()),
      [EVENTS_PATH]: () => json(events),
    });

    await loadRoadmapEvents(client);

    for (const request of requests) {
      expect(request.headers.get("Authorization")).toBeNull();
      expect(request.cache).toBe("no-store");
    }
    expect(
      requests.map((request) => `${request.method} ${new URL(request.url).pathname}`).sort(),
    ).toEqual(["GET /v1/person", `GET ${EVENTS_PATH}`].sort());
  });

  it("reports a profile that does not exist yet as missing", async () => {
    const { client } = clientWith({
      "/v1/person": () => apiError("not_found", 404),
      [EVENTS_PATH]: () => json(events),
    });

    expect(await loadRoadmapEvents(client)).toEqual({ status: "missing" });
  });

  it.each(failures)("is unavailable, never empty, when the events route %s", async (_l, route) => {
    const { client } = clientWith({ "/v1/person": () => json(person()), [EVENTS_PATH]: route });

    expect(await loadRoadmapEvents(client)).toEqual({ status: "unavailable" });
  });

  it.each(failures)("is unavailable when the person route %s", async (_label, route) => {
    const { client } = clientWith({ "/v1/person": route, [EVENTS_PATH]: () => json(events) });

    expect(await loadRoadmapEvents(client)).toEqual({ status: "unavailable" });
  });

  it("gives up on an API that does not answer in time", async () => {
    const { client } = clientWith({ "/v1/person": hang, [EVENTS_PATH]: hang });

    expect(await loadRoadmapEvents(client, { timeoutMs: 20 })).toEqual({ status: "unavailable" });
  });
});
