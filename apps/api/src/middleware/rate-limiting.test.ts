import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  anyText,
  bearer,
  connection,
  openTestBackend,
  testConfig,
  type TestBackend,
} from "../test-support.js";

const once = { max: 1, windowMs: 30_000 };

function clock(start = 2_000_000) {
  let now = start;
  return {
    now: () => now,
    advance(ms: number) {
      now += ms;
    },
  };
}

async function expectLimited(response: Response, retryAfter = "30") {
  expect(response.status).toBe(429);
  expect(response.headers.get("retry-after")).toBe(retryAfter);
  expect(response.headers.get("content-type")).toMatch(/^application\/json/);
  expect(await response.json()).toEqual({
    error: { code: "rate_limited", message: anyText },
  });
}

describe("rate limiting", () => {
  let backend: TestBackend;

  beforeAll(async () => {
    backend = await openTestBackend();
  });

  afterAll(async () => {
    await backend.close();
  });

  it("limits every registered route and unknown paths, private ones before key verification", async () => {
    const config = testConfig({
      rateLimits: { health: once, public: once, private: once, key: once, upload: once },
    });
    const paths = backend.api().routes.map((route) => ({ method: route.method, path: route.path }));
    paths.push({ method: "GET", path: "/no-such-route" });

    for (const { method, path } of paths) {
      const { app } = backend.api({ config });
      const first = await app.request(path, { method }, connection());
      expect(first.status, `${method} ${path}`).not.toBe(429);
      await expectLimited(await app.request(path, { method }, connection()));
    }
  });

  it("keeps health checks usable when the other budgets are exhausted", async () => {
    const { app } = backend.api({
      config: testConfig({ rateLimits: { public: once, private: once } }),
    });
    await app.request("/v1/person", {}, connection());
    await app.request("/v1/person", { method: "DELETE" }, connection());
    await expectLimited(await app.request("/v1/person", {}, connection()));

    const health = await app.request("/health", {}, connection());
    expect(health.status).toBe(200);
  });

  it("limits each caller on its own", async () => {
    const { app } = backend.api({ config: testConfig({ rateLimits: { public: once } }) });
    await app.request("/v1/person", {}, connection("192.0.2.20"));

    await expectLimited(await app.request("/v1/person", {}, connection("192.0.2.20")));
    expect((await app.request("/v1/person", {}, connection("192.0.2.21"))).status).toBe(404);
  });

  it("recovers after the window", async () => {
    const time = clock();
    const { app } = backend.api({
      now: time.now,
      config: testConfig({ rateLimits: { public: once } }),
    });
    await app.request("/v1/person", {}, connection());
    time.advance(12_000);
    await expectLimited(await app.request("/v1/person", {}, connection()), "18");

    time.advance(18_000);
    expect((await app.request("/v1/person", {}, connection())).status).toBe(404);
  });

  it("counts invalid authentication attempts against the client's private budget", async () => {
    const { app } = backend.api({
      config: testConfig({ rateLimits: { private: { max: 2, windowMs: 30_000 } } }),
    });
    const wrong = bearer(`sebela_${"1".repeat(16)}_${"B".repeat(43)}`);
    expect((await app.request("/v1/person", { method: "DELETE" }, connection())).status).toBe(401);
    expect(
      (await app.request("/v1/person", { method: "DELETE", headers: wrong }, connection())).status,
    ).toBe(401);

    const { key } = await backend.services.apiKeys.createKey("after failures");
    await expectLimited(
      await app.request("/v1/person", { method: "DELETE", headers: bearer(key) }, connection()),
    );
  });

  it("gives every authenticated key its own budget, wherever it calls from", async () => {
    const { app } = backend.api({ config: testConfig({ rateLimits: { key: once } }) });
    const first = await backend.services.apiKeys.createKey("first");
    const second = await backend.services.apiKeys.createKey("second");
    const remove = (key: string, address: string) =>
      app.request("/v1/person", { method: "DELETE", headers: bearer(key) }, connection(address));

    expect((await remove(first.key, "192.0.2.30")).status).toBe(404);
    await expectLimited(await remove(first.key, "192.0.2.31"));
    expect((await remove(second.key, "192.0.2.30")).status).toBe(404);
  });

  it("ignores forwarded addresses from a connection that is not a trusted proxy", async () => {
    const { app } = backend.api({ config: testConfig({ rateLimits: { public: once } }) });
    const spoofed = (forwarded: string) =>
      app.request("/v1/person", { headers: { "x-forwarded-for": forwarded } }, connection());

    expect((await spoofed("198.51.100.1")).status).toBe(404);
    await expectLimited(await spoofed("198.51.100.2"));
  });

  it("believes the forwarded address only from a trusted proxy", async () => {
    const proxy = "203.0.113.5";
    const { app } = backend.api({
      config: testConfig({ trustedProxies: [proxy], rateLimits: { public: once } }),
    });
    const via = (forwarded: string) =>
      app.request("/v1/person", { headers: { "x-forwarded-for": forwarded } }, connection(proxy));

    expect((await via("198.51.100.1")).status).toBe(404);
    expect((await via("198.51.100.2")).status).toBe(404);
    // A client cannot escape its budget by prepending addresses: the proxy appends the real one.
    await expectLimited(await via("198.51.100.9, 198.51.100.2"));
  });
});
