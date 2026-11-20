import { describe, expect, it } from "vitest";

import { createApiClient } from "@sebela/api-client";

import { checkHealth, healthResponse } from "./check-health";

const BASE = "https://api.example.test";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function clientAnswering(answer: (request: Request) => Response | Promise<Response>) {
  const requests: Request[] = [];
  const client = createApiClient({
    baseUrl: BASE,
    fetch: async (request) => {
      requests.push(request);
      return answer(request);
    },
  });
  return { client, requests };
}

describe("checkHealth", () => {
  it("reports the API and the database healthy when the API is ready", async () => {
    const { client, requests } = clientAnswering(() => json({ status: "ready" }));
    await expect(checkHealth(client)).resolves.toEqual({
      status: "ok",
      api: "ok",
      postgres: "ok",
    });
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual(["/health/ready"]);
  });

  it("reports the database failing when the API answers that it cannot reach it", async () => {
    const { client } = clientAnswering(() =>
      json({ error: { code: "unavailable", message: "A fictional outage." } }, 503),
    );
    await expect(checkHealth(client)).resolves.toEqual({
      status: "failing",
      api: "ok",
      postgres: "failing",
    });
  });

  it("reports the API failing when it cannot be reached, and the database unknown", async () => {
    const { client } = clientAnswering(() => {
      throw new TypeError("fetch failed");
    });
    await expect(checkHealth(client)).resolves.toEqual({
      status: "failing",
      api: "failing",
      postgres: "unknown",
    });
  });

  it("reports the API failing when it answers anything other than ready", async () => {
    for (const response of [
      () => json({ error: { code: "internal", message: "A fictional failure." } }, 500),
      () => json({ error: { code: "unavailable", message: "Not from the API." } }, 502),
      () => new Response("<html>gateway</html>", { status: 503 }),
      () => json({ status: "starting" }),
    ]) {
      const { client } = clientAnswering(response);
      await expect(checkHealth(client)).resolves.toEqual({
        status: "failing",
        api: "failing",
        postgres: "unknown",
      });
    }
  });

  it("reports the API failing when it does not answer in time", async () => {
    const { client } = clientAnswering(
      (request) =>
        new Promise<Response>((_resolve, reject) => {
          request.signal.addEventListener("abort", () => {
            reject(request.signal.reason as Error);
          });
        }),
    );
    await expect(checkHealth(client, { timeoutMs: 20 })).resolves.toEqual({
      status: "failing",
      api: "failing",
      postgres: "unknown",
    });
  });

  it("reports the API failing without a usable client (an invalid configuration)", async () => {
    await expect(checkHealth(null)).resolves.toEqual({
      status: "failing",
      api: "failing",
      postgres: "unknown",
    });
  });
});

describe("healthResponse", () => {
  it("answers 200 with the report when everything is healthy, never cached or indexed", async () => {
    const response = healthResponse({ status: "ok", api: "ok", postgres: "ok" });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(response.headers.get("content-type")).toMatch(/^application\/json/);
    await expect(response.json()).resolves.toEqual({ status: "ok", api: "ok", postgres: "ok" });
  });

  it("answers 503 naming the failing part", async () => {
    const response = healthResponse({ status: "failing", api: "ok", postgres: "failing" });
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      status: "failing",
      api: "ok",
      postgres: "failing",
    });
  });
});
