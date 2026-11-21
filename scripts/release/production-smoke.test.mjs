// Behaviour of the production smoke check (docs/release-workflow.md, "Deployment"): which
// answers of the public edge pass and which fail. A local HTTP server plays the edge.

import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, it } from "node:test";

import { PAGES, REFUSED, smoke } from "./production-smoke.mjs";

let server;
let baseUrl;
let behaviour;
const requests = [];

const healthy = {
  page: () => [200, "text/html; charset=utf-8", "<!doctype html><title>x</title>"],
  health: () => [
    200,
    "application/json",
    JSON.stringify({ status: "ok", api: "ok", postgres: "ok" }),
  ],
  refused: () => [404, "text/html", "not found"],
};

before(async () => {
  server = http.createServer((request, response) => {
    requests.push({
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization,
    });
    const pathname = new URL(request.url ?? "/", "http://edge").pathname;
    let answer;
    if (pathname === "/health") answer = behaviour.health(request);
    else if (PAGES.includes(pathname) && request.method === "GET") answer = behaviour.page(request);
    else answer = behaviour.refused(request);
    const [status, type, body] = answer;
    response.writeHead(status, { "content-type": type });
    response.end(body);
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const address = server.address();
  // The test server listens on every interface, so its own address reaches it.
  baseUrl = new URL(
    `http://${address.family === "IPv6" ? `[${address.address}]` : address.address}`,
  );
  baseUrl.port = String(address.port);
  baseUrl = baseUrl.origin;
});

after(() => {
  server.close();
});

async function check(overrides = {}, options = {}) {
  behaviour = { ...healthy, ...overrides };
  requests.length = 0;
  return smoke({ baseUrl, apiKey: "a-valid-looking-key", ...options });
}

const failed = (results) => results.filter(({ ok }) => !ok).map(({ name }) => name);

describe("production smoke check", () => {
  it("passes a healthy edge that refuses the private routes", async () => {
    const results = await check();
    assert.deepEqual(failed(results), []);
    assert.equal(results.length, PAGES.length + 1 + REFUSED.length);
  });

  it("asks for the private routes with the key", async () => {
    await check();
    const privateRequests = requests.filter(({ url }) => REFUSED.some(({ path }) => url === path));
    assert.equal(privateRequests.length, REFUSED.length);
    assert.ok(
      privateRequests.every(({ authorization }) => authorization === "Bearer a-valid-looking-key"),
    );
  });

  it("covers the API's private routes, admin MCP and the website's internal routes", () => {
    const paths = REFUSED.map(({ path }) => path);
    assert.ok(paths.some((path) => path.startsWith("/v1/")));
    assert.ok(paths.includes("/mcp"));
    assert.ok(paths.some((path) => path.startsWith("/internal/")));
    assert.ok(
      REFUSED.some(({ method }) => method !== "GET"),
      "a write",
    );
  });

  it("fails when a page does not respond", async () => {
    const results = await check({ page: () => [502, "text/html", "bad gateway"] });
    assert.equal(failed(results).length, PAGES.length);
  });

  it("fails when the health route is not green", async () => {
    const unhealthy = () => [
      503,
      "application/json",
      JSON.stringify({ status: "failing", api: "ok", postgres: "failing" }),
    ];
    assert.deepEqual(failed(await check({ health: unhealthy })), ["health"]);
    const lying = () => [200, "application/json", JSON.stringify({ status: "ok", api: "failing" })];
    assert.deepEqual(failed(await check({ health: lying })), ["health"]);
  });

  for (const status of [200, 201, 204, 400, 401, 500]) {
    it(`fails when a private route answers ${status}`, async () => {
      const results = await check({ refused: () => [status, "application/json", "{}"] });
      assert.equal(failed(results).length, REFUSED.length);
    });
  }

  for (const status of [403, 404, 405]) {
    it(`counts ${status} from a private route as refused`, async () => {
      const results = await check({ refused: () => [status, "text/html", "no"] });
      assert.deepEqual(failed(results), []);
    });
  }

  it("fails a check when the edge does not answer", async () => {
    const results = await smoke({ baseUrl: "http://edge.invalid", apiKey: "k", timeoutMs: 2000 });
    assert.equal(failed(results).length, results.length);
  });
});
