import { describe, expect, it } from "vitest";

import { createContentCache } from "./content-cache";

const BASE = "https://api.example.test";

/** A fake API: answers from `answer`, counting the requests it receives per address. */
function fakeApi(answer: (request: Request, count: number) => Response | Promise<Response>) {
  const counts = new Map<string, number>();
  return {
    counts,
    fetch: async (request: Request) => {
      const count = (counts.get(request.url) ?? 0) + 1;
      counts.set(request.url, count);
      return answer(request, count);
    },
  };
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const get = (path: string) => new Request(`${BASE}${path}`);

describe("createContentCache", () => {
  it("answers a repeated read of an address from the cache", async () => {
    const api = fakeApi((_request, count) => json({ read: count }));
    const cache = createContentCache({ fetch: api.fetch });

    const first = await cache.fetch(get("/v1/person"));
    const second = await cache.fetch(get("/v1/person"));

    expect(await first.json()).toEqual({ read: 1 });
    expect(second.status).toBe(200);
    expect(second.headers.get("Content-Type")).toBe("application/json");
    expect(await second.json()).toEqual({ read: 1 });
    expect(api.counts.get(`${BASE}/v1/person`)).toBe(1);
  });

  it("gives every hit a body of its own", async () => {
    const api = fakeApi(() => json({ name: "Robin Example" }));
    const cache = createContentCache({ fetch: api.fetch });
    await cache.fetch(get("/v1/person"));

    const [one, two] = await Promise.all([
      cache.fetch(get("/v1/person")),
      cache.fetch(get("/v1/person")),
    ]);

    expect(await one.text()).toBe(await two.text());
  });

  it("keeps different addresses apart", async () => {
    const api = fakeApi((request) => json({ url: request.url }));
    const cache = createContentCache({ fetch: api.fetch });

    await cache.fetch(get("/v1/person"));
    const services = await cache.fetch(get("/v1/services"));

    expect(await services.json()).toEqual({ url: `${BASE}/v1/services` });
  });

  it.each([404, 429, 500, 503])("never keeps an answer with status %i", async (status) => {
    const api = fakeApi((_request, count) => json({ read: count }, status));
    const cache = createContentCache({ fetch: api.fetch });

    await cache.fetch(get("/v1/person"));
    const again = await cache.fetch(get("/v1/person"));

    expect(again.status).toBe(status);
    expect(await again.json()).toEqual({ read: 2 });
  });

  it("never keeps a failed read, so the next read asks the API again", async () => {
    const api = fakeApi((_request, count) => {
      if (count === 1) throw new TypeError("fetch failed");
      return json({ read: count });
    });
    const cache = createContentCache({ fetch: api.fetch });

    await expect(cache.fetch(get("/v1/person"))).rejects.toThrow("fetch failed");
    const again = await cache.fetch(get("/v1/person"));

    expect(await again.json()).toEqual({ read: 2 });
  });

  it("passes every method but GET through uncached", async () => {
    const api = fakeApi((_request, count) => json({ read: count }));
    const cache = createContentCache({ fetch: api.fetch });

    await cache.fetch(new Request(`${BASE}/v1/chat`, { method: "POST", body: "{}" }));
    const again = await cache.fetch(new Request(`${BASE}/v1/chat`, { method: "POST", body: "{}" }));

    expect(await again.json()).toEqual({ read: 2 });
  });

  it("reads everything again after an invalidation", async () => {
    const api = fakeApi((_request, count) => json({ read: count }));
    const cache = createContentCache({ fetch: api.fetch });
    await cache.fetch(get("/v1/person"));
    await cache.fetch(get("/v1/services"));

    cache.invalidate();

    expect(await (await cache.fetch(get("/v1/person"))).json()).toEqual({ read: 2 });
    expect(await (await cache.fetch(get("/v1/services"))).json()).toEqual({ read: 2 });
  });

  it("does not keep a read that began before an invalidation, so older data cannot return", async () => {
    const gate: { release?: () => void } = {};
    const api = fakeApi(async (_request, count) => {
      if (count === 1) await new Promise<void>((resolve) => (gate.release = resolve));
      return json({ read: count });
    });
    const cache = createContentCache({ fetch: api.fetch });

    const early = cache.fetch(get("/v1/person"));
    while (gate.release === undefined) await new Promise((resolve) => setTimeout(resolve, 0));
    cache.invalidate();
    gate.release();
    expect(await (await early).json()).toEqual({ read: 1 });

    expect(await (await cache.fetch(get("/v1/person"))).json()).toEqual({ read: 2 });
  });

  it("reads an address again once its entry is older than the maximum age", async () => {
    let now = 1_000_000;
    const api = fakeApi((_request, count) => json({ read: count }));
    const cache = createContentCache({ fetch: api.fetch, now: () => now, maxAgeMs: 60_000 });
    await cache.fetch(get("/v1/person"));

    now += 59_999;
    expect(await (await cache.fetch(get("/v1/person"))).json()).toEqual({ read: 1 });
    now += 1;
    expect(await (await cache.fetch(get("/v1/person"))).json()).toEqual({ read: 2 });
  });

  it("keeps at most the given number of entries, forgetting the oldest first", async () => {
    const api = fakeApi((_request, count) => json({ read: count }));
    const cache = createContentCache({ fetch: api.fetch, maxEntries: 2 });
    await cache.fetch(get("/v1/one"));
    await cache.fetch(get("/v1/two"));
    await cache.fetch(get("/v1/three"));

    expect(await (await cache.fetch(get("/v1/three"))).json()).toEqual({ read: 1 });
    expect(await (await cache.fetch(get("/v1/two"))).json()).toEqual({ read: 1 });
    expect(await (await cache.fetch(get("/v1/one"))).json()).toEqual({ read: 2 });
  });

  it("returns but does not keep a body larger than the limit", async () => {
    const api = fakeApi((_request, count) => json({ read: count, padding: "x".repeat(64) }));
    const cache = createContentCache({ fetch: api.fetch, maxBodyBytes: 32 });

    const first = await cache.fetch(get("/v1/person"));
    expect(await first.json()).toMatchObject({ read: 1 });

    expect(await (await cache.fetch(get("/v1/person"))).json()).toMatchObject({ read: 2 });
  });
});
