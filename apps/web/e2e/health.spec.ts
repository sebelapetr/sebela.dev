import { expect, test } from "@playwright/test";

import { freePort, origin, required, startApi, startWebsite, type Started } from "./stack";

// The website's health route for uptime monitoring: it answers 200 only when the API and its
// database are ready. A failing database is checked by the unit tests and the production stack's
// smoke check (scripts/checks/production-stack.e2e.mjs), which stops Postgres.

test.describe("the health route with a ready API", () => {
  let api: Started;
  let website: Started;

  test.beforeAll(async () => {
    api = await startApi("with-experience");
    website = await startWebsite(api.url);
  });

  test.afterAll(async () => {
    await website.stop();
    await api.stop();
  });

  test("reports the API and the database healthy, uncached", async ({ request }) => {
    const response = await request.get(`${website.url}/health`);
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok", api: "ok", postgres: "ok" });
  });
});

test.describe("the health route while the API is unreachable", () => {
  let website: Started;

  test.beforeAll(async () => {
    // An address nothing listens on: the port was free a moment ago.
    const host = required("API_HOST");
    website = await startWebsite(origin(host, await freePort(host)));
  });

  test.afterAll(async () => {
    await website.stop();
  });

  test("reports the API failing and reveals nothing else", async ({ request }) => {
    const response = await request.get(`${website.url}/health`);
    expect(response.status()).toBe(503);
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(await response.json()).toEqual({
      status: "failing",
      api: "failing",
      postgres: "unknown",
    });
  });
});
