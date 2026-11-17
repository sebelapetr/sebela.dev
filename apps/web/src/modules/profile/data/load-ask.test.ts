import { describe, expect, it } from "vitest";

import { createApiClient, type Person } from "@sebela/api-client";

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

describe("loadAsk", () => {
  it("returns the person's name, which the chat's suggestions and answers speak about", async () => {
    const { client } = clientWith({ "/v1/person": () => json(person()) });

    expect(await loadAsk(client)).toEqual({ status: "ready", content: { name: "Robin Example" } });
  });

  it("reads only the public person route, without credentials and without a cache", async () => {
    const { client, requests } = clientWith({ "/v1/person": () => json(person()) });

    await loadAsk(client);

    expect(requests.map((request) => [request.method, new URL(request.url).pathname])).toEqual([
      ["GET", "/v1/person"],
    ]);
    expect(requests[0]?.headers.get("Authorization")).toBeNull();
    expect(requests[0]?.cache).toBe("no-store");
  });

  it("reports a profile that does not exist yet as missing", async () => {
    const { client } = clientWith({ "/v1/person": () => apiError("not_found", 404) });

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
    const { client } = clientWith({ "/v1/person": route });

    expect(await loadAsk(client)).toEqual({ status: "unavailable" });
  });

  it("gives up on an API that does not answer in time", async () => {
    const hang: Route = (request) =>
      new Promise<Response>((_resolve, reject) => {
        request.signal.addEventListener("abort", () => {
          reject(request.signal.reason as Error);
        });
      });
    const { client } = clientWith({ "/v1/person": hang });

    expect(await loadAsk(client, { timeoutMs: 20 })).toEqual({ status: "unavailable" });
  });
});
