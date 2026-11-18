import { describe, expect, it } from "vitest";

import {
  createApiClient,
  type Diary,
  type DiaryDay,
  type Person,
  type Roadmap,
  type RoadmapTreeArea,
} from "@sebela/api-client";

import { loadRoadmapDiary, loadRoadmapDiaryDay } from "./load-roadmap-diary";

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

const day: DiaryDay = {
  date: "2026-03-02",
  notes: "Read about **fictional** signals.",
  entries: [
    {
      id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
      date: "2026-03-02",
      resource: {
        slug: "fictional-resource",
        name: "Fictional resource",
        type: "link",
        link: "https://example.test/fictional",
        module: "fictional-module",
        area: "fictional-area",
      },
      startedAt: "2026-03-02T08:00:00.000Z",
      endedAt: "2026-03-02T09:30:00.000Z",
      durationSeconds: 5400,
    },
  ],
  totalSeconds: 5400,
};

const diary: Diary = {
  days: [day, { date: "2026-03-01", notes: "Notes only.", entries: [], totalSeconds: 0 }],
};

const progress = {
  completed: 0,
  total: 1,
  status: "planned" as const,
  completedAt: null,
  lastUpdatedAt: null,
  estimatedMinutes: 0,
};

function area(slug: string, name: string, modules: [string, string][]): RoadmapTreeArea {
  return {
    id: "8c1e2f3a-4b5c-4d6e-8f70-81a2b3c4d5e6",
    slug,
    name,
    description: null,
    weight: 10,
    position: 0,
    createdAt: STAMP,
    updatedAt: STAMP,
    progress,
    modules: modules.map(([moduleSlug, moduleName]) => ({
      id: "9d2f3a4b-5c6d-4e7f-8a81-92b3c4d5e6f7",
      slug: moduleSlug,
      name: moduleName,
      description: null,
      position: 0,
      createdAt: STAMP,
      updatedAt: STAMP,
      progress,
      resources: [],
    })),
  };
}

const roadmap: Roadmap = {
  summary: {
    areaCount: 2,
    moduleCount: 2,
    resourceCount: 1,
    completed: 0,
    total: 1,
    estimatedMinutes: 0,
    estimatedHours: 0,
    lastUpdatedAt: null,
  },
  areas: [
    area("earlier-area", "Earlier area", [["earlier-module", "Earlier module"]]),
    area("fictional-area", "Fictional area", [["fictional-module", "Fictional module"]]),
  ],
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

const DIARY_PATH = "/v1/roadmap/diary";
const DAY_PATH = "/v1/roadmap/diary/2026-03-02";
const TREE_PATH = "/v1/roadmap";

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

function publicReads(requests: readonly Request[]) {
  for (const request of requests) {
    expect(request.headers.get("Authorization")).toBeNull();
    expect(request.cache).toBe("no-store");
  }
  return requests.map((request) => `${request.method} ${new URL(request.url).pathname}`).sort();
}

describe("loadRoadmapDiary", () => {
  it("returns the API's diary as it is, with the person's name and headline", async () => {
    const { client } = clientWith({
      "/v1/person": () => json(person()),
      [DIARY_PATH]: () => json(diary),
    });

    expect(await loadRoadmapDiary(client)).toEqual({
      status: "ready",
      content: { name: "Robin Example", headline: "Fictional engineer for tests", diary },
    });
  });

  it("returns an empty diary as ready, never as missing", async () => {
    const { client } = clientWith({
      "/v1/person": () => json(person()),
      [DIARY_PATH]: () => json({ days: [] }),
    });

    expect(await loadRoadmapDiary(client)).toMatchObject({
      status: "ready",
      content: { diary: { days: [] } },
    });
  });

  it("reads only public routes, without credentials and without a cache", async () => {
    const { client, requests } = clientWith({
      "/v1/person": () => json(person()),
      [DIARY_PATH]: () => json(diary),
    });

    await loadRoadmapDiary(client);

    expect(publicReads(requests)).toEqual(["GET /v1/person", `GET ${DIARY_PATH}`].sort());
  });

  it("reports a profile that does not exist yet as missing", async () => {
    const { client } = clientWith({
      "/v1/person": () => apiError("not_found", 404),
      [DIARY_PATH]: () => json(diary),
    });

    expect(await loadRoadmapDiary(client)).toEqual({ status: "missing" });
  });

  it.each(failures)("is unavailable, never empty, when the diary route %s", async (_l, route) => {
    const { client } = clientWith({ "/v1/person": () => json(person()), [DIARY_PATH]: route });

    expect(await loadRoadmapDiary(client)).toEqual({ status: "unavailable" });
  });

  it.each(failures)("is unavailable when the person route %s", async (_label, route) => {
    const { client } = clientWith({ "/v1/person": route, [DIARY_PATH]: () => json(diary) });

    expect(await loadRoadmapDiary(client)).toEqual({ status: "unavailable" });
  });

  it("gives up on an API that does not answer in time", async () => {
    const { client } = clientWith({ "/v1/person": hang, [DIARY_PATH]: hang });

    expect(await loadRoadmapDiary(client, { timeoutMs: 20 })).toEqual({ status: "unavailable" });
  });
});

describe("loadRoadmapDiaryDay", () => {
  it("returns the API's day as it is, with the roadmap's areas and modules in order", async () => {
    const { client } = clientWith({
      "/v1/person": () => json(person()),
      [DAY_PATH]: () => json(day),
      [TREE_PATH]: () => json(roadmap),
    });

    expect(await loadRoadmapDiaryDay(client, "2026-03-02")).toEqual({
      status: "ready",
      content: {
        name: "Robin Example",
        headline: "Fictional engineer for tests",
        day,
        areas: [
          {
            slug: "earlier-area",
            name: "Earlier area",
            modules: [{ slug: "earlier-module", name: "Earlier module" }],
          },
          {
            slug: "fictional-area",
            name: "Fictional area",
            modules: [{ slug: "fictional-module", name: "Fictional module" }],
          },
        ],
      },
    });
  });

  it("reads only public routes, without credentials and without a cache", async () => {
    const { client, requests } = clientWith({
      "/v1/person": () => json(person()),
      [DAY_PATH]: () => json(day),
      [TREE_PATH]: () => json(roadmap),
    });

    await loadRoadmapDiaryDay(client, "2026-03-02");

    expect(publicReads(requests)).toEqual(
      [`GET ${DAY_PATH}`, "GET /v1/person", `GET ${TREE_PATH}`].sort(),
    );
  });

  it.each([
    ["the day has no diary record", () => apiError("not_found", 404)],
    ["the address is not a calendar day", () => apiError("validation_failed", 400)],
  ])("reports the page as missing when %s", async (_label, route) => {
    const { client } = clientWith({
      "/v1/person": () => json(person()),
      [DAY_PATH]: route,
      [TREE_PATH]: () => json(roadmap),
    });

    expect(await loadRoadmapDiaryDay(client, "2026-03-02")).toEqual({ status: "missing" });
  });

  it("keeps the date inside the day's path segment", async () => {
    const { client, requests } = clientWith({
      "/v1/person": () => json(person()),
      "/v1/roadmap/diary/..%2F..%2Fperson": () => apiError("validation_failed", 400),
      [TREE_PATH]: () => json(roadmap),
    });

    expect(await loadRoadmapDiaryDay(client, "../../person")).toEqual({ status: "missing" });
    expect(requests.map((request) => new URL(request.url).pathname)).toContain(
      "/v1/roadmap/diary/..%2F..%2Fperson",
    );
  });

  it("reports a profile that does not exist yet as missing", async () => {
    const { client } = clientWith({
      "/v1/person": () => apiError("not_found", 404),
      [DAY_PATH]: () => json(day),
      [TREE_PATH]: () => json(roadmap),
    });

    expect(await loadRoadmapDiaryDay(client, "2026-03-02")).toEqual({ status: "missing" });
  });

  it.each(failures)("is unavailable, never missing, when the day route %s", async (_l, route) => {
    const { client } = clientWith({
      "/v1/person": () => json(person()),
      [DAY_PATH]: route,
      [TREE_PATH]: () => json(roadmap),
    });

    expect(await loadRoadmapDiaryDay(client, "2026-03-02")).toEqual({ status: "unavailable" });
  });

  it.each(failures)("is unavailable when the roadmap's tree route %s", async (_l, route) => {
    const { client } = clientWith({
      "/v1/person": () => json(person()),
      [DAY_PATH]: () => json(day),
      [TREE_PATH]: route,
    });

    expect(await loadRoadmapDiaryDay(client, "2026-03-02")).toEqual({ status: "unavailable" });
  });

  it.each(failures)("is unavailable when the person route %s", async (_label, route) => {
    const { client } = clientWith({
      "/v1/person": route,
      [DAY_PATH]: () => json(day),
      [TREE_PATH]: () => json(roadmap),
    });

    expect(await loadRoadmapDiaryDay(client, "2026-03-02")).toEqual({ status: "unavailable" });
  });

  it("gives up on an API that does not answer in time", async () => {
    const { client } = clientWith({ "/v1/person": hang, [DAY_PATH]: hang, [TREE_PATH]: hang });

    expect(await loadRoadmapDiaryDay(client, "2026-03-02", { timeoutMs: 20 })).toEqual({
      status: "unavailable",
    });
  });
});
