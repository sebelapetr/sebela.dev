import { describe, expect, it } from "vitest";

import {
  createApiClient,
  type Experience,
  type Exploration,
  type Person,
  type Service,
  type Technology,
} from "@sebela/api-client";

import { loadAsk } from "./load-ask";

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

function experience(slug: string): Experience {
  return {
    id: "6a1f3c2e-0b4d-4e7a-9c11-2f8d5b6e7a01",
    slug,
    title: "Engineer",
    kind: "main_job",
    startedOn: "2020-01-01",
    endedOn: null,
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

function service(slug: string): Service {
  return {
    id: "5d6e7f80-9a1b-4c2d-8e3f-4a5b6c7d8e9f",
    slug,
    name: `Fictional ${slug}`,
    summary: "Made up.",
    audience: "Fictional firms.",
    deliverable: "A fictional result.",
    position: 0,
    evidence: [],
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

function exploration(slug: string): Exploration {
  return {
    id: "8b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e",
    slug,
    name: "Fictional exploration",
    summary: "Made up.",
    status: "designed",
    concepts: [],
    startedOn: "2025-02-01",
    endedOn: null,
    position: 0,
    technologies: [],
    topics: [],
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

function technology(slug: string): Technology {
  return {
    id: "4a5b6c7d-8e9f-4a0b-9c1d-2e3f4a5b6c7d",
    slug,
    name: "Fictional technology",
    tier: "primary",
    group: "ai_engineering_focus",
    logoKey: null,
    position: 0,
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

const LISTS = ["/v1/experiences", "/v1/services", "/v1/explorations", "/v1/technologies"];

function routes(overrides: Record<string, Route> = {}): Record<string, Route> {
  return {
    "/v1/person": () => json(person()),
    "/v1/experiences": () => json([experience("fictional-role")]),
    "/v1/services": () => json([service("automation")]),
    "/v1/explorations": () => json([exploration("answer-checks")]),
    "/v1/technologies": () => json([technology("retrieval")]),
    ...overrides,
  };
}

describe("loadAsk", () => {
  it("returns the name and the public records the chat's answers rest on, in the API's order", async () => {
    const { client } = clientWith(routes());

    expect(await loadAsk(client)).toEqual({
      status: "ready",
      content: {
        name: "Robin Example",
        email: null,
        links: [],
        experiences: [experience("fictional-role")],
        services: [service("automation")],
        explorations: [exploration("answer-checks")],
        technologies: [technology("retrieval")],
      },
    });
  });

  it("keeps the person's email and only their web links", async () => {
    const { client } = clientWith(
      routes({
        "/v1/person": () =>
          json(
            person({
              email: "robin@example.test",
              links: [
                { label: "Code", url: "https://code.example.test/robin" },
                { label: "Chat", url: "ftp://files.example.test/robin" },
              ],
            }),
          ),
      }),
    );

    const result = await loadAsk(client);

    expect(result).toMatchObject({
      status: "ready",
      content: {
        email: "robin@example.test",
        links: [{ label: "Code", url: "https://code.example.test/robin" }],
      },
    });
  });

  it("reads only public routes, without credentials and without a cache", async () => {
    const { client, requests } = clientWith(routes());

    await loadAsk(client);

    expect(requests.map((request) => new URL(request.url).pathname).sort()).toEqual(
      ["/v1/person", ...LISTS].sort(),
    );
    for (const request of requests) {
      expect(request.method).toBe("GET");
      expect(request.headers.get("Authorization")).toBeNull();
      expect(request.cache).toBe("no-store");
    }
  });

  it("reports a profile that does not exist yet as missing", async () => {
    const { client } = clientWith(routes({ "/v1/person": () => apiError("not_found", 404) }));

    expect(await loadAsk(client)).toEqual({ status: "missing" });
  });

  const failures: [string, Route][] = [
    ["fails", () => apiError("internal_error", 500)],
    ["is rate limited", () => apiError("rate_limited", 429)],
    [
      "cannot be reached",
      () => {
        throw new TypeError("fetch failed");
      },
    ],
  ];

  it.each(failures)("is unavailable when the person route %s", async (_label, route) => {
    const { client } = clientWith(routes({ "/v1/person": route }));

    expect(await loadAsk(client)).toEqual({ status: "unavailable" });
  });

  it.each(LISTS)(
    "is unavailable when %s fails, never answering without part of the profile",
    async (path) => {
      const { client } = clientWith(routes({ [path]: () => apiError("internal_error", 500) }));

      expect(await loadAsk(client)).toEqual({ status: "unavailable" });
    },
  );

  it("gives up on an API that does not answer in time", async () => {
    const hang: Route = (request) =>
      new Promise<Response>((_resolve, reject) => {
        request.signal.addEventListener("abort", () => {
          reject(request.signal.reason as Error);
        });
      });
    const { client } = clientWith(routes({ "/v1/person": hang }));

    expect(await loadAsk(client, { timeoutMs: 20 })).toEqual({ status: "unavailable" });
  });
});
