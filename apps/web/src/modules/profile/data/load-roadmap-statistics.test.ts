import { describe, expect, it } from "vitest";

import { createApiClient, type Person, type RoadmapStatistics } from "@sebela/api-client";

import { createContentCache } from "./content-cache";
import { loadRoadmapStatistics } from "./load-roadmap-statistics";

const BASE = "https://api.example.test";
const STAMP = "2026-01-01T00:00:00.000Z";
const STATISTICS_PATH = "/v1/roadmap/statistics";

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

const split = { totalSeconds: 5400, resourceSeconds: 3600, bookSeconds: 0, eventSeconds: 1800 };

// The API's figures; the loader must keep them as they are and never recount them.
const statistics: RoadmapStatistics = {
  totals: { ...split, activeDays: 1 },
  days: [{ date: "2026-03-02", ...split }],
  weeks: [{ startsOn: "2026-03-02", ...split }],
  months: [{ month: "2026-03", ...split }],
  areas: [
    {
      slug: "orbit-foundations",
      name: "Orbit foundations",
      totalSeconds: 3600,
      resourceSeconds: 3600,
      bookSeconds: 0,
      modules: [
        {
          slug: "signal-basics",
          name: "Signal basics",
          totalSeconds: 3600,
          resourceSeconds: 3600,
          bookSeconds: 0,
        },
      ],
    },
  ],
  resources: [
    {
      slug: "signal-explainer",
      name: "A fictional signal explainer",
      type: "youtube-video",
      category: "resource",
      module: { slug: "signal-basics", name: "Signal basics" },
      area: { slug: "orbit-foundations", name: "Orbit foundations" },
      book: null,
      totalSeconds: 3600,
    },
  ],
  events: [
    {
      slug: "spring-signals-lecture",
      name: "Spring signals lecture",
      kind: "lecture",
      startsOn: "2026-03-02",
      endsOn: "2026-03-02",
      totalSeconds: 1800,
    },
  ],
};

const empty: RoadmapStatistics = {
  totals: { totalSeconds: 0, resourceSeconds: 0, bookSeconds: 0, eventSeconds: 0, activeDays: 0 },
  days: [],
  weeks: [],
  months: [],
  areas: [],
  resources: [],
  events: [],
};

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

describe("loadRoadmapStatistics", () => {
  it("returns the API's statistics as they are, with the person's name and headline", async () => {
    const { client } = clientWith({
      "/v1/person": () => json(person()),
      [STATISTICS_PATH]: () => json(statistics),
    });

    expect(await loadRoadmapStatistics(client)).toEqual({
      status: "ready",
      content: { name: "Robin Example", headline: "Fictional engineer for tests", statistics },
    });
  });

  it("returns no logged time as ready with zero totals, never as missing", async () => {
    const { client } = clientWith({
      "/v1/person": () => json(person()),
      [STATISTICS_PATH]: () => json(empty),
    });

    expect(await loadRoadmapStatistics(client)).toEqual({
      status: "ready",
      content: {
        name: "Robin Example",
        headline: "Fictional engineer for tests",
        statistics: empty,
      },
    });
  });

  it("reads only public routes, without credentials and without a cache", async () => {
    const { client, requests } = clientWith({
      "/v1/person": () => json(person()),
      [STATISTICS_PATH]: () => json(statistics),
    });

    await loadRoadmapStatistics(client);

    for (const request of requests) {
      expect(request.headers.get("Authorization")).toBeNull();
      expect(request.cache).toBe("no-store");
    }
    expect(
      requests.map((request) => `${request.method} ${new URL(request.url).pathname}`).sort(),
    ).toEqual(["GET /v1/person", `GET ${STATISTICS_PATH}`].sort());
  });

  it("reports a profile that does not exist yet as missing", async () => {
    const { client } = clientWith({
      "/v1/person": () => apiError("not_found", 404),
      [STATISTICS_PATH]: () => json(statistics),
    });

    expect(await loadRoadmapStatistics(client)).toEqual({ status: "missing" });
  });

  it.each(failures)(
    "is unavailable, never zero activity, when the statistics route %s",
    async (_label, route) => {
      const { client } = clientWith({
        "/v1/person": () => json(person()),
        [STATISTICS_PATH]: route,
      });

      expect(await loadRoadmapStatistics(client)).toEqual({ status: "unavailable" });
    },
  );

  it.each(failures)("is unavailable when the person route %s", async (_label, route) => {
    const { client } = clientWith({
      "/v1/person": route,
      [STATISTICS_PATH]: () => json(statistics),
    });

    expect(await loadRoadmapStatistics(client)).toEqual({ status: "unavailable" });
  });

  it("gives up on an API that does not answer in time", async () => {
    const { client } = clientWith({ "/v1/person": hang, [STATISTICS_PATH]: hang });

    expect(await loadRoadmapStatistics(client, { timeoutMs: 20 })).toEqual({
      status: "unavailable",
    });
  });

  it("does not keep a failed read through the content cache: the next read has the figures", async () => {
    let statisticsReads = 0;
    const routes: Record<string, Route> = {
      "/v1/person": () => json(person()),
      [STATISTICS_PATH]: () => {
        statisticsReads += 1;
        return statisticsReads === 1 ? apiError("internal_error", 500) : json(statistics);
      },
    };
    const contentCache = createContentCache({
      fetch: async (request) => {
        const route = routes[new URL(request.url).pathname];
        if (!route) throw new Error(`unexpected request to ${request.url}`);
        return route(request);
      },
    });
    const client = createApiClient({ baseUrl: BASE, fetch: contentCache.fetch });

    expect(await loadRoadmapStatistics(client)).toEqual({ status: "unavailable" });
    expect(await loadRoadmapStatistics(client)).toMatchObject({
      status: "ready",
      content: { statistics },
    });
    expect(statisticsReads).toBe(2);
  });
});
