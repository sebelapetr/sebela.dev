import { describe, expect, it } from "vitest";

import { createApiClient, type Experience, type Person } from "@sebela/api-client";

import { loadExperience } from "./load-experience";

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
    careerStartedOn: "2015-09-01",
    photoId: null,
    cvPdfId: null,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  };
}

function experience(slug: string, endedOn: string | null): Experience {
  return {
    id: "6a1f3c2e-0b4d-4e7a-9c11-2f8d5b6e7a01",
    slug,
    title: "Engineer",
    kind: "main_job",
    startedOn: "2020-01-01",
    endedOn,
    summary: "Fictional.",
    responsibilities: [],
    inCv: true,
    organization: {
      id: "3c9e1b7a-5d2f-4a6b-8e0c-1f2a3b4c5d60",
      slug: "fictional-org",
      name: "Fictional Org",
      website: null,
      description: null,
      logoId: null,
      createdAt: STAMP,
      updatedAt: STAMP,
    },
    technologies: [],
    projects: [],
    testimonials: [],
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

const twoExperiences = [experience("current", null), experience("older", "2019-12-31")];

describe("loadExperience", () => {
  it("returns the person's header facts and the experiences in the API's order", async () => {
    const { client } = clientWith({
      "/v1/person": () => json(person()),
      "/v1/experiences": () => json({ items: twoExperiences }),
    });

    expect(await loadExperience(client)).toEqual({
      status: "ready",
      content: {
        name: "Robin Example",
        headline: "Fictional engineer for tests",
        careerStartedOn: "2015-09-01",
        experiences: twoExperiences,
      },
    });
  });

  it("is ready without experiences", async () => {
    const { client } = clientWith({
      "/v1/person": () => json(person({ careerStartedOn: null })),
      "/v1/experiences": () => json({ items: [] }),
    });

    const result = await loadExperience(client);

    expect(result.status === "ready" && result.content.experiences).toEqual([]);
    expect(result.status === "ready" && result.content.careerStartedOn).toBeNull();
  });

  it("reads only public routes, without credentials and without a cache", async () => {
    const { client, requests } = clientWith({
      "/v1/person": () => json(person()),
      "/v1/experiences": () => json({ items: [] }),
    });

    await loadExperience(client);

    expect(
      requests.map((request) => [request.method, new URL(request.url).pathname]).sort(),
    ).toEqual([
      ["GET", "/v1/experiences"],
      ["GET", "/v1/person"],
    ]);
    for (const request of requests) {
      expect(request.headers.get("Authorization")).toBeNull();
      expect(request.cache).toBe("no-store");
    }
  });

  it("reports a profile that does not exist yet as missing", async () => {
    const { client } = clientWith({
      "/v1/person": () => apiError("not_found", 404),
      "/v1/experiences": () => json({ items: [] }),
    });

    expect(await loadExperience(client)).toEqual({ status: "missing" });
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
      "/v1/experiences": () => json({ items: twoExperiences }),
    });

    expect(await loadExperience(client)).toEqual({ status: "unavailable" });
  });

  it.each(failures)(
    "is unavailable, never an empty timeline, when the experiences route %s",
    async (_label, route) => {
      const { client } = clientWith({
        "/v1/person": () => json(person()),
        "/v1/experiences": route,
      });

      expect(await loadExperience(client)).toEqual({ status: "unavailable" });
    },
  );

  it("gives up on an API that does not answer in time", async () => {
    const hang: Route = (request) =>
      new Promise<Response>((_resolve, reject) => {
        request.signal.addEventListener("abort", () => {
          reject(request.signal.reason as Error);
        });
      });
    const { client } = clientWith({ "/v1/person": hang, "/v1/experiences": hang });

    expect(await loadExperience(client, { timeoutMs: 20 })).toEqual({ status: "unavailable" });
  });
});
