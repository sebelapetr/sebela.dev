// The MCP Admin HTTP surface in-process, against a fake content API: the deterministic security
// cases of .plan/05-mcp-admin/security.md that do not need the real API (D01, D02, D05–D09, D14,
// D15). The real API path, revocation on a live key and two real keys are in mcp.e2e.test.ts.
import { afterEach, describe, expect, it } from "vitest";

import { createMcpAdminApp, type McpAdminApp } from "./app.js";
import {
  API_BASE,
  connectClient,
  fakeApi,
  fictionalPerson,
  initialize,
  KEY_A,
  KEY_B,
  rpc,
  send,
  testConfig,
  toolText,
  UNKNOWN_KEY,
  type FakeApi,
} from "./test-support/index.js";

const opened: McpAdminApp[] = [];

function open(
  options: { overrides?: Record<string, string>; api?: FakeApi; now?: () => number } = {},
) {
  const api = options.api ?? fakeApi();
  const lines: string[] = [];
  const admin = createMcpAdminApp({
    config: testConfig(options.overrides),
    fetch: api.fetch,
    log: (line) => lines.push(line),
    ...(options.now ? { now: options.now } : {}),
  });
  opened.push(admin);
  const fetch = admin.app.fetch;
  return { api, admin, fetch, lines };
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((admin) => admin.close()));
});

const bearer = (key: string) => ({ authorization: `Bearer ${key}` });
const listTools = { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} };

/** A refusal must not reveal the catalogue, a key, a hash or whether a key exists. */
async function expectUniformRefusal(response: Response) {
  expect(response.status).toBe(401);
  expect(response.headers.get("www-authenticate")).toBe("Bearer");
  const body = await response.text();
  expect(JSON.parse(body)).toEqual({
    error: { code: "unauthorized", message: "A valid API key is required." },
  });
  for (const hidden of ["get", "describe", "sebela_", "inputSchema"]) {
    expect(body).not.toContain(`"${hidden}"`);
  }
}

describe("health and unauthenticated access (D06)", () => {
  it("answers a minimal health response without credentials", async () => {
    const { fetch, api } = open();

    const response = await send(fetch, "/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(api.calls).toEqual([]);
  });

  it("refuses every protocol method, discovery path and guessed endpoint without a key", async () => {
    const { fetch, api } = open();
    const attempts: [string, RequestInit][] = [
      ["/mcp", rpc(initialize)],
      ["/mcp", rpc(listTools)],
      ["/mcp", rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get" } })],
      ["/mcp", rpc([initialize, listTools])],
      ["/mcp", { method: "GET", headers: { accept: "text/event-stream" } }],
      ["/mcp", { method: "DELETE", headers: { "mcp-session-id": "guessed" } }],
      ["/mcp", { method: "OPTIONS", headers: { "access-control-request-method": "POST" } }],
      ["/", { method: "GET" }],
      ["/sse", { method: "GET" }],
      ["/messages", rpc(listTools)],
      ["/mcp/tools", { method: "GET" }],
      ["/.well-known/oauth-protected-resource", { method: "GET" }],
      ["/.well-known/oauth-authorization-server", { method: "GET" }],
      ["/v1/person", { method: "GET" }],
    ];

    for (const [path, init] of attempts) {
      await expectUniformRefusal(await send(fetch, path, init));
    }
    // Nothing reached the content API: there was no key to check.
    expect(api.calls).toEqual([]);
  });
});

describe("authentication (D01, D02)", () => {
  it("refuses a missing, malformed, unknown or foreign token the same way", async () => {
    const { fetch } = open();
    const foreignJwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmaWN0aW9uYWwiLCJpc3MiOiJlbHNld2hlcmUudGVzdCJ9.c2lnbmF0dXJl";
    const headerSets: Record<string, string>[] = [
      {},
      { authorization: "" },
      { authorization: "Bearer" },
      { authorization: "Bearer " },
      { authorization: `Basic ${Buffer.from(`user:${KEY_A}`).toString("base64")}` },
      { authorization: `Token ${KEY_A}` },
      { authorization: `Bearer ${KEY_A} extra` },
      bearer("not-a-key"),
      bearer(UNKNOWN_KEY),
      bearer(foreignJwt),
      { "x-api-key": KEY_A },
    ];

    for (const headers of headerSets) {
      await expectUniformRefusal(await send(fetch, "/mcp", rpc(initialize, headers)));
    }
  });

  it("never authenticates with a token in the body", async () => {
    const { fetch } = open();
    const smuggled = [
      {
        ...initialize,
        params: { ...initialize.params, _meta: { authorization: `Bearer ${KEY_A}` } },
      },
      { ...initialize, authorization: `Bearer ${KEY_A}`, apiKey: KEY_A },
    ];

    for (const body of smuggled) {
      await expectUniformRefusal(await send(fetch, "/mcp", rpc(body)));
    }
  });

  it("refuses credentials in the address with the API's refusal, even next to a valid header", async () => {
    const { fetch, api } = open();

    for (const query of [`api_key=${KEY_A}`, `token=${KEY_A}`, `x=${KEY_A}`, "access_token=abc"]) {
      const response = await send(fetch, `/mcp?${query}`, rpc(initialize, bearer(KEY_A)));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: {
          code: "credentials_in_url",
          message: "Send the API key in the Authorization header, never in the URL.",
        },
      });
    }
    expect(api.calls).toEqual([]);
  });

  it("checks the presented key with the content API and lists only the read tools", async () => {
    const { fetch, api } = open();

    const client = await connectClient(fetch, KEY_A);
    const { tools } = await client.listTools();
    await client.close();

    expect(tools.map((tool) => tool.name).sort()).toEqual(["describe", "get"]);
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.annotations?.destructiveHint).toBe(false);
    }
    const checks = api.calls.filter((call) => call.url === `${API_BASE}/v1/authentication`);
    expect(checks.length).toBeGreaterThanOrEqual(2);
    for (const check of checks) expect(check.authorization).toBe(`Bearer ${KEY_A}`);
  });

  it("rejects credentials and unknown arguments in tool arguments without calling the API", async () => {
    const { fetch, api } = open();
    const client = await connectClient(fetch, KEY_A);
    const before = api.calls.length;

    for (const args of [
      { entity: "person", apiKey: KEY_B },
      { entity: "person", authorization: `Bearer ${KEY_B}` },
      { entity: KEY_B },
      { entity: "project" },
      {},
    ]) {
      const outcome = await client
        .callTool({ name: "get", arguments: args })
        .then((result) => ({ isError: result.isError === true, text: toolText(result) }))
        .catch((error: unknown) => ({ isError: true, text: String(error) }));
      expect(outcome.isError, JSON.stringify(Object.keys(args))).toBe(true);
      expect(outcome.text).not.toContain(KEY_B);
    }
    await client.close();

    const reads = api.calls
      .slice(before)
      .filter((call) => !call.url.endsWith("/v1/authentication"));
    expect(reads).toEqual([]);
  });
});

describe("the read tools", () => {
  it("reads the person through the public route, without a key", async () => {
    const { fetch, api } = open();
    const client = await connectClient(fetch, KEY_A);

    const result = await client.callTool({ name: "get", arguments: { entity: "person" } });
    await client.close();

    expect(result.isError).not.toBe(true);
    expect(JSON.parse(toolText(result))).toEqual(fictionalPerson);
    const read = api.calls.find((call) => call.url === `${API_BASE}/v1/person`);
    expect(read).toMatchObject({ method: "GET", authorization: null });
  });

  it("says a missing person is missing, not invented", async () => {
    const api = fakeApi();
    api.answer("/v1/person", () =>
      Response.json({ error: { code: "not_found", message: "No person yet." } }, { status: 404 }),
    );
    const { fetch } = open({ api });
    const client = await connectClient(fetch, KEY_A);

    const result = await client.callTool({ name: "get", arguments: { entity: "person" } });
    await client.close();

    expect(result.isError).toBe(true);
    expect(JSON.parse(toolText(result))).toEqual({
      error: { code: "not_found", message: "No person is stored yet." },
    });
  });

  it("describes the project contract and its relationships from the shared contracts", async () => {
    const { fetch, api } = open();
    const client = await connectClient(fetch, KEY_A);
    const before = api.calls.length;

    const result = await client.callTool({ name: "describe", arguments: { entity: "project" } });
    await client.close();

    expect(result.isError).not.toBe(true);
    const description = JSON.parse(toolText(result)) as {
      entity: string;
      create: { properties: Record<string, unknown>; required: string[] };
      update: { properties: Record<string, unknown> };
      relationships: { field: string; target: string; rule: string }[];
    };
    expect(description.entity).toBe("project");
    expect(Object.keys(description.create.properties)).toEqual(
      expect.arrayContaining(["slug", "name", "experience", "technologies", "startedOn"]),
    );
    expect(description.create.required).toEqual(expect.arrayContaining(["slug", "experience"]));
    expect(description.update.properties).not.toHaveProperty("slug");
    expect(description.update.properties).not.toHaveProperty("caseStudy");
    expect(description.relationships.map(({ field, target }) => ({ field, target }))).toEqual([
      { field: "experience", target: "experience" },
      { field: "technologies", target: "technology" },
    ]);
    for (const rule of description.relationships) expect(rule.rule.length).toBeGreaterThan(10);
    // Describing reads no content: only the authentication check reached the API.
    expect(api.calls.slice(before).every((call) => call.url.endsWith("/v1/authentication"))).toBe(
      true,
    );
  });
});

describe("revocation and two callers (D03, D04)", () => {
  it("refuses the next operation on an open connection after the key is revoked", async () => {
    const { fetch, api } = open();
    const client = await connectClient(fetch, KEY_A);
    await client.listTools();

    api.revoke(KEY_A);
    const before = api.calls.length;
    await expect(
      client.callTool({ name: "get", arguments: { entity: "person" } }),
    ).rejects.toThrow();
    await client.close();

    expect(api.calls.slice(before).map((call) => new URL(call.url).pathname)).toEqual([
      "/v1/authentication",
    ]);
  });

  it("checks each concurrent caller with its own key and shares none", async () => {
    // Room for all six calls at once: this case is about keys, the limit itself is D08's.
    const { fetch, api } = open({ overrides: { MCP_ADMIN_MAX_CONCURRENT: "8" } });
    const [first, second] = await Promise.all([
      connectClient(fetch, KEY_A),
      connectClient(fetch, KEY_B),
    ]);

    await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        (index % 2 === 0 ? first : second).callTool({
          name: "get",
          arguments: { entity: "person" },
        }),
      ),
    );
    await Promise.all([first.close(), second.close()]);

    const checks = api.calls.filter((call) => call.url.endsWith("/v1/authentication"));
    const byKey = (key: string) => checks.filter((call) => call.authorization === `Bearer ${key}`);
    expect(byKey(KEY_A).length).toBeGreaterThanOrEqual(3);
    expect(byKey(KEY_B).length).toBeGreaterThanOrEqual(3);
    expect(byKey(KEY_A).length + byKey(KEY_B).length).toBe(checks.length);
    const reads = api.calls.filter((call) => call.url.endsWith("/v1/person"));
    expect(reads).toHaveLength(6);
    for (const read of reads) expect(read.authorization).toBeNull();
  });
});

describe("an unavailable authentication check fails closed (D05)", () => {
  const failures: [string, (request: Request) => Response | Promise<Response>][] = [
    ["a server error", () => new Response("SELECT secret FROM api_keys", { status: 500 })],
    ["a malformed answer", () => Response.json({ status: "ok", keyHash: "deadbeef" })],
    ["a non-JSON answer", () => new Response("authenticated", { status: 200 })],
    ["an unexpected status", () => Response.json({ status: "authenticated" }, { status: 202 })],
    [
      "a network failure",
      () => {
        throw new TypeError("connect ECONNREFUSED at Socket.<anonymous> (node:net:1)");
      },
    ],
    [
      "a timeout",
      (request) =>
        new Promise<Response>((_, reject) => {
          request.signal.addEventListener("abort", () => {
            reject(request.signal.reason as Error);
          });
        }),
    ],
  ];

  for (const [name, handler] of failures) {
    it(`answers a sanitized unavailable error on ${name}`, async () => {
      const api = fakeApi();
      api.answer("/v1/authentication", handler);
      const { fetch, lines } = open({ api, overrides: { MCP_ADMIN_TIMEOUT_MS: "200" } });

      const response = await send(fetch, "/mcp", rpc(initialize, bearer(KEY_A)));

      expect(response.status).toBe(503);
      const body = await response.text();
      expect(JSON.parse(body)).toEqual({
        error: { code: "unavailable", message: "The content API is unavailable; retry later." },
      });
      for (const leak of ["SELECT", "ECONNREFUSED", "deadbeef", "node:net", KEY_A]) {
        expect(body).not.toContain(leak);
        for (const line of lines) expect(line).not.toContain(KEY_A);
      }
      expect(api.calls.some((call) => call.url.endsWith("/v1/person"))).toBe(false);
    });
  }
});

describe("Origin, Host and client identity (D07)", () => {
  it("rejects an invalid Host or Origin, and admits a caller without an Origin", async () => {
    const { fetch } = open({ overrides: { MCP_ADMIN_ALLOWED_ORIGINS: "console.test" } });

    const badHost = await fetch(
      new Request("http://attacker.test/mcp", rpc(initialize, bearer(KEY_A))),
      { incoming: { socket: { remoteAddress: "203.0.113.7" } } },
    );
    expect(badHost.status).toBe(403);

    const badOrigin = await send(
      fetch,
      "/mcp",
      rpc(initialize, { ...bearer(KEY_A), origin: "https://attacker.test" }),
    );
    expect(badOrigin.status).toBe(403);

    const goodOrigin = await send(
      fetch,
      "/mcp",
      rpc(initialize, { ...bearer(KEY_A), origin: "https://console.test" }),
    );
    expect(goodOrigin.status).toBe(200);

    const noOrigin = await send(fetch, "/mcp", rpc(initialize, bearer(KEY_A)));
    expect(noOrigin.status).toBe(200);

    // A missing Origin never stands in for a key.
    await expectUniformRefusal(await send(fetch, "/mcp", rpc(initialize)));
  });

  it("rejects every present Origin when none is configured", async () => {
    const { fetch } = open();

    const response = await send(
      fetch,
      "/mcp",
      rpc(initialize, { ...bearer(KEY_A), origin: "https://mcp-admin.test" }),
    );

    expect(response.status).toBe(403);
  });

  it("believes forwarded addresses only from a configured proxy", async () => {
    const limited = { MCP_ADMIN_RATE_LIMIT_PREAUTH: "2/60" };

    // Not a proxy: spoofed X-Forwarded-For values do not create fresh budgets.
    const direct = open({ overrides: limited });
    const statuses = [];
    for (const spoofed of ["198.51.100.1", "198.51.100.2", "198.51.100.3"]) {
      const response = await send(
        direct.fetch,
        "/mcp",
        rpc(initialize, { "x-forwarded-for": spoofed }),
      );
      statuses.push(response.status);
    }
    expect(statuses).toEqual([401, 401, 429]);

    // A configured proxy: each forwarded client has its own budget.
    const proxied = open({ overrides: { ...limited, MCP_ADMIN_TRUSTED_PROXIES: "203.0.113.7" } });
    const forwarded = [];
    for (const client of ["198.51.100.1", "198.51.100.2", "198.51.100.3"]) {
      const response = await send(
        proxied.fetch,
        "/mcp",
        rpc(initialize, { "x-forwarded-for": `198.51.100.250, ${client}` }),
      );
      forwarded.push(response.status);
    }
    expect(forwarded).toEqual([401, 401, 401]);
  });
});

describe("limits (D08)", () => {
  it("refuses an oversized body before reading it all", async () => {
    const { fetch } = open({ overrides: { MCP_ADMIN_BODY_LIMIT_BYTES: "1024" } });
    const padded = { ...initialize, params: { ...initialize.params, padding: "x".repeat(4096) } };

    const response = await send(fetch, "/mcp", rpc(padded, bearer(KEY_A)));

    expect(response.status).toBe(413);
  });

  it("bounds a slow upstream read by the configured time", async () => {
    const api = fakeApi();
    api.answer(
      "/v1/person",
      (request) =>
        new Promise<Response>((_, reject) => {
          request.signal.addEventListener("abort", () => {
            reject(request.signal.reason as Error);
          });
        }),
    );
    const { fetch } = open({ api, overrides: { MCP_ADMIN_TIMEOUT_MS: "300" } });
    const client = await connectClient(fetch, KEY_A);

    const started = Date.now();
    const outcome = await client
      .callTool({ name: "get", arguments: { entity: "person" } })
      .then((result) => ({ isError: result.isError === true, text: toolText(result) }))
      .catch((error: unknown) => ({ isError: true, text: String(error) }));
    await client.close();

    expect(outcome.isError).toBe(true);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(outcome.text).not.toMatch(/at \S+ \(|AbortError|TimeoutError/);
  });

  it("refuses work beyond the concurrency limit and releases capacity on cancellation", async () => {
    const api = fakeApi();
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let slow = true;
    api.answer("/v1/person", async (request) => {
      if (slow) {
        await Promise.race([
          held,
          new Promise((resolve) => {
            request.signal.addEventListener("abort", resolve);
          }),
        ]);
      }
      return Response.json(fictionalPerson);
    });
    const { fetch } = open({ api, overrides: { MCP_ADMIN_MAX_CONCURRENT: "1" } });
    const call = {
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: { name: "get", arguments: { entity: "person" } },
    };
    const headers = { ...bearer(KEY_A), "mcp-protocol-version": "2025-06-18" };

    const cancel = new AbortController();
    const first = send(fetch, "/mcp", { ...rpc(call, headers), signal: cancel.signal }).catch(
      () => null,
    );
    // Let the first request take the only slot.
    await new Promise((resolve) => setTimeout(resolve, 100));

    const busy = await send(fetch, "/mcp", rpc(call, headers));
    expect(busy.status).toBe(503);
    expect(await busy.json()).toEqual({
      error: { code: "busy", message: "Too many requests in progress; retry later." },
    });

    cancel.abort();
    await first;
    slow = false;
    release();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const after = await send(fetch, "/mcp", rpc(call, headers));
    expect(after.status).toBe(200);
  });
});

describe("rate budgets (D09)", () => {
  it("keeps an anonymous flood from one address away from a caller at another", async () => {
    const { fetch } = open({ overrides: { MCP_ADMIN_RATE_LIMIT_PREAUTH: "3/60" } });

    const flood = [];
    for (let index = 0; index < 5; index += 1) {
      flood.push(
        (await send(fetch, "/mcp", rpc(initialize, bearer(UNKNOWN_KEY)), "198.51.100.66")).status,
      );
    }
    expect(flood).toEqual([401, 401, 401, 429, 429]);

    const other = await send(fetch, "/mcp", rpc(initialize, bearer(KEY_A)), "198.51.100.77");
    expect(other.status).toBe(200);
  });

  it("gives every key its own budget, and lets it recover when its window ends", async () => {
    let now = 1_000_000;
    const { fetch } = open({
      overrides: { MCP_ADMIN_RATE_LIMIT_KEY: "2/60" },
      now: () => now,
    });
    const ask = (key: string) => send(fetch, "/mcp", rpc(initialize, bearer(key)));

    expect((await ask(KEY_A)).status).toBe(200);
    expect((await ask(KEY_A)).status).toBe(200);
    const limited = await ask(KEY_A);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);

    expect((await ask(KEY_B)).status).toBe(200);

    now += 61_000;
    expect((await ask(KEY_A)).status).toBe(200);
  });

  it("keeps working when more callers arrive than it tracks", async () => {
    const { fetch } = open({
      overrides: { MCP_ADMIN_RATE_LIMIT_PREAUTH: "1/60", MCP_ADMIN_RATE_LIMIT_MAX_TRACKED: "4" },
    });

    for (let index = 1; index <= 20; index += 1) {
      const response = await send(fetch, "/mcp", rpc(initialize), `198.51.100.${String(index)}`);
      expect(response.status).toBe(401);
    }
  });
});

describe("the content API destination (D14)", () => {
  it("never follows a redirect of the authentication check", async () => {
    const api = fakeApi();
    api.answer(
      "/v1/authentication",
      () =>
        new Response(null, { status: 307, headers: { location: "http://collector.test/steal" } }),
    );
    const { fetch } = open({ api });

    const response = await send(fetch, "/mcp", rpc(initialize, bearer(KEY_A)));

    expect(response.status).toBe(503);
    expect(api.calls.every((call) => call.url.startsWith(`${API_BASE}/`))).toBe(true);
    expect(api.calls.every((call) => call.redirect === "manual")).toBe(true);
  });

  it("never follows a redirect of a read and returns an upstream failure", async () => {
    const api = fakeApi();
    api.answer(
      "/v1/person",
      () => new Response(null, { status: 302, headers: { location: "http://collector.test/" } }),
    );
    const { fetch } = open({ api });
    const client = await connectClient(fetch, KEY_A);

    const result = await client.callTool({ name: "get", arguments: { entity: "person" } });
    await client.close();

    expect(result.isError).toBe(true);
    expect(JSON.parse(toolText(result))).toEqual({
      error: { code: "unavailable", message: "The content API is unavailable; retry later." },
    });
    expect(api.calls.every((call) => call.url.startsWith(`${API_BASE}/`))).toBe(true);
  });

  it("lets no request header or argument choose another API", async () => {
    const { fetch, api } = open();
    const client = await connectClient(fetch, KEY_A);
    await send(
      fetch,
      "/mcp",
      rpc(
        {
          jsonrpc: "2.0",
          id: 5,
          method: "tools/call",
          params: { name: "get", arguments: { entity: "person" } },
        },
        {
          ...bearer(KEY_A),
          "mcp-protocol-version": "2025-06-18",
          "x-forwarded-host": "collector.test",
          "x-api-url": "http://collector.test",
          forwarded: "host=collector.test",
        },
      ),
    );
    await client
      .callTool({ name: "get", arguments: { entity: "http://collector.test/v1/person" } })
      .catch(() => null);
    await client.close();

    expect(api.calls.length).toBeGreaterThan(0);
    expect(api.calls.every((call) => call.url.startsWith(`${API_BASE}/`))).toBe(true);
  });
});

describe("secrets stay out of answers and logs (D15)", () => {
  it("keeps keys, upstream internals and stacks out of tool errors and the log", async () => {
    const sentinel = "fixture-sentinel-0123456789abcdef";
    const api = fakeApi();
    api.answer(
      "/v1/person",
      () =>
        new Response(
          `error: relation "person" at Object.query (/srv/db.js:1:1) ${sentinel} ${KEY_A}`,
          { status: 500 },
        ),
    );
    const { fetch, lines } = open({ api });
    const client = await connectClient(fetch, KEY_A);

    const result = await client.callTool({ name: "get", arguments: { entity: "person" } });
    await client.close();
    await send(fetch, `/mcp?api_key=${KEY_B}`, rpc(initialize));
    await send(fetch, `/${KEY_B}`, { method: "GET", headers: bearer(KEY_B) });

    const text = toolText(result);
    expect(result.isError).toBe(true);
    for (const leak of [sentinel, KEY_A, "relation", "/srv/db.js"])
      expect(text).not.toContain(leak);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      for (const leak of [sentinel, KEY_A, KEY_B, KEY_A.split("_")[2], KEY_B.split("_")[2]]) {
        expect(line).not.toContain(leak);
      }
    }
  });

  it("answers an unexpected failure with a fixed 500 and logs a redacted line about it", async () => {
    const { fetch, lines } = open({
      now: () => {
        throw new TypeError(`clock broke for ${KEY_A}`);
      },
    });

    const response = await send(fetch, "/mcp", rpc(initialize, bearer(KEY_A)));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: "internal", message: "Something went wrong." },
    });
    expect(lines).toContain("POST /mcp internal error: TypeError");
    for (const line of lines) expect(line).not.toContain(KEY_A.split("_")[2]);
  });
});
