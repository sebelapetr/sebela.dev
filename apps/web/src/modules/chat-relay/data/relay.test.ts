import { describe, expect, it, vi } from "vitest";

import { chatRelayMaxBodyBytes, createChatRelay, type ChatRelaySettings } from "./relay";

const API = "http://api.example.test";
const SITE = "https://site.example.test";
const OPERATION = "22222222-0000-4000-8000-000000000001";

interface Upstream {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly body: string | null;
  readonly signal: AbortSignal | null;
}

function fakeApi(response: Response | Error = new Response("{}", { status: 200 })) {
  const calls: Upstream[] = [];
  const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: input instanceof Request ? input.url : input.toString(),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body:
        init?.body === undefined || init.body === null
          ? null
          : new TextDecoder().decode(init.body as Uint8Array),
      signal: init?.signal ?? null,
    });
    if (response instanceof Error) return Promise.reject(response);
    return Promise.resolve(response);
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

// A disposable fixture token.
const TOKEN = "fixture-chat-relay-token-0123456789abcdef";

function relay(
  api: ReturnType<typeof fakeApi>,
  settings: ChatRelaySettings | null = { token: TOKEN, trustedProxyHops: 1 },
) {
  return createChatRelay({ fetch: api.fetch, apiBaseUrl: () => API, settings: () => settings });
}

const question = JSON.stringify({
  requestId: "11111111-0000-4000-8000-000000000001",
  question: "What does Ilsa build?",
  challengeToken: "token",
});

function post(body: BodyInit, headers: Record<string, string> = {}): Request {
  return new Request(`${SITE}/api/chat/conversation/messages`, {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      origin: SITE,
      cookie: "sebela_chat=visitor",
      "x-forwarded-for": "203.0.113.7",
      ...headers,
    },
  });
}

describe("createChatRelay", () => {
  it("relays the conversation read with its page query and the visitor's cookie", async () => {
    const api = fakeApi();
    const request = new Request(
      `${SITE}/api/chat/conversation?before=00000000-0000-4000-8000-000000000001&limit=5&other=x`,
      { headers: { cookie: "sebela_chat=visitor", accept: "application/json" } },
    );

    await relay(api)(request, { kind: "conversation" });

    expect(api.calls[0]).toMatchObject({
      url: `${API}/v1/chat/conversation?before=00000000-0000-4000-8000-000000000001&limit=5`,
      method: "GET",
    });
    expect(api.calls[0]?.headers.get("cookie")).toBe("sebela_chat=visitor");
  });

  it("relays a question with its body, origin, content type and the relay's token and visitor address only", async () => {
    const api = fakeApi();

    await relay(api)(post(question, { authorization: "Bearer stolen", "x-api-key": "k" }), {
      kind: "messages",
    });

    const call = api.calls[0];
    expect(call).toMatchObject({
      url: `${API}/v1/chat/conversation/messages`,
      method: "POST",
      body: question,
    });
    expect(call?.headers.get("origin")).toBe(SITE);
    expect(call?.headers.get("content-type")).toBe("application/json");
    expect(call?.headers.get("x-sebela-chat-relay")).toBe(TOKEN);
    expect(call?.headers.get("x-sebela-chat-client")).toBe("203.0.113.7");
    expect(call?.headers.get("x-forwarded-for")).toBeNull();
    expect(call?.headers.get("authorization")).toBeNull();
    expect(call?.headers.get("x-api-key")).toBeNull();
  });

  it("sends its token on every route", async () => {
    const api = fakeApi();
    const routes = [
      [new Request(`${SITE}/api/chat/conversation`), { kind: "conversation" }],
      [post(question), { kind: "messages" }],
      [
        new Request(`${SITE}/api/chat/operations/${OPERATION}`),
        { kind: "operation", operationId: OPERATION },
      ],
      [
        new Request(`${SITE}/api/chat/operations/${OPERATION}/events`),
        { kind: "events", operationId: OPERATION },
      ],
      [new Request(`${SITE}/api/chat/usage`), { kind: "usage" }],
    ] as const;

    for (const [request, route] of routes) await relay(api)(request, route);

    expect(api.calls.map((call) => call.headers.get("x-sebela-chat-relay"))).toEqual([
      TOKEN,
      TOKEN,
      TOKEN,
      TOKEN,
      TOKEN,
    ]);
  });

  it("names the address the trusted proxies saw, counted from the right, and ignores the rest", async () => {
    const addressFor = async (forwardedFor: string | null, trustedProxyHops: number) => {
      const api = fakeApi();
      const headers: Record<string, string> =
        forwardedFor === null ? {} : { "x-forwarded-for": forwardedFor };
      const request = new Request(`${SITE}/api/chat/conversation/messages`, {
        method: "POST",
        body: question,
        headers: { "content-type": "application/json", origin: SITE, ...headers },
      });
      await relay(api, { token: TOKEN, trustedProxyHops })(request, { kind: "messages" });
      const call = api.calls[0];
      expect(call?.headers.get("x-forwarded-for")).toBeNull();
      return call?.headers.get("x-sebela-chat-client") ?? null;
    };

    // The visitor wrote the left entries; the host proxy appended the address it saw.
    expect(await addressFor("198.51.100.66, 203.0.113.7", 1)).toBe("203.0.113.7");
    expect(await addressFor("198.51.100.66,203.0.113.7", 1)).toBe("203.0.113.7");
    expect(await addressFor("198.51.100.66, 203.0.113.7, 192.0.2.1", 2)).toBe("203.0.113.7");
    expect(await addressFor("203.0.113.7", 1)).toBe("203.0.113.7");
    // No trusted hop, too few entries or none: no address.
    expect(await addressFor("198.51.100.66, 203.0.113.7", 0)).toBeNull();
    expect(await addressFor("203.0.113.7", 2)).toBeNull();
    expect(await addressFor(null, 1)).toBeNull();
    expect(await addressFor("", 1)).toBeNull();
  });

  it("answers 503 unavailable without its token, without reaching the API", async () => {
    const api = fakeApi();

    const response = await relay(api, null)(post(question), { kind: "messages" });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "unavailable" } });
    expect(api.calls).toHaveLength(0);
  });

  it("never invents an origin the browser did not send", async () => {
    const api = fakeApi();
    const request = new Request(`${SITE}/api/chat/conversation/messages`, {
      method: "POST",
      body: question,
      headers: { "content-type": "application/json" },
    });

    await relay(api)(request, { kind: "messages" });

    expect(api.calls[0]?.headers.get("origin")).toBeNull();
  });

  it("refuses an oversized question without reaching the API", async () => {
    const api = fakeApi();

    const response = await relay(api)(post("x".repeat(chatRelayMaxBodyBytes + 1)), {
      kind: "messages",
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "payload_too_large" } });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(api.calls).toHaveLength(0);
  });

  it("relays an operation's events from where the browser left off, with the request's signal", async () => {
    const api = fakeApi(
      new Response("event: chat\nid: 0\ndata: {}\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );
    const request = new Request(`${SITE}/api/chat/operations/${OPERATION}/events`, {
      headers: { cookie: "sebela_chat=visitor", "last-event-id": "4", accept: "text/event-stream" },
    });

    const response = await relay(api)(request, { kind: "events", operationId: OPERATION });

    expect(api.calls[0]?.url).toBe(`${API}/v1/chat/operations/${OPERATION}/events`);
    expect(api.calls[0]?.headers.get("last-event-id")).toBe("4");
    expect(api.calls[0]?.signal).not.toBeNull();
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.text()).resolves.toBe("event: chat\nid: 0\ndata: {}\n\n");
  });

  it("relays the visitor's usage read as a GET without a body, with the visitor's cookie", async () => {
    const api = fakeApi();
    const request = new Request(`${SITE}/api/chat/usage?ignored=1`, {
      method: "GET",
      headers: { cookie: "sebela_chat=visitor" },
    });

    await relay(api)(request, { kind: "usage" });

    const call = api.calls[0];
    expect(call?.url).toBe(`${API}/v1/chat/usage`);
    expect(call?.method).toBe("GET");
    expect(call?.body).toBeNull();
    expect(call?.headers.get("cookie")).toBe("sebela_chat=visitor");
    expect(call?.headers.get("x-sebela-chat-relay")).toBe(TOKEN);
  });

  it("relays an operation's state", async () => {
    const api = fakeApi();

    await relay(api)(new Request(`${SITE}/api/chat/operations/${OPERATION}`), {
      kind: "operation",
      operationId: OPERATION,
    });

    expect(api.calls[0]?.url).toBe(`${API}/v1/chat/operations/${OPERATION}`);
  });

  it("answers an operation that is not one 404 without reaching the API", async () => {
    const api = fakeApi();

    const response = await relay(api)(new Request(`${SITE}/api/chat/operations/x/events`), {
      kind: "events",
      operationId: "../../v1/admin",
    });

    expect(response.status).toBe(404);
    expect(api.calls).toHaveLength(0);
  });

  it("relays a stop as a POST without a body, with the visitor's cookie and origin", async () => {
    const api = fakeApi();
    const request = new Request(`${SITE}/api/chat/operations/${OPERATION}/stop`, {
      method: "POST",
      body: "ignored",
      headers: { cookie: "sebela_chat=visitor", origin: SITE },
    });

    await relay(api)(request, { kind: "stop", operationId: OPERATION });

    expect(api.calls[0]).toMatchObject({
      url: `${API}/v1/chat/operations/${OPERATION}/stop`,
      method: "POST",
      body: null,
    });
    expect(api.calls[0]?.headers.get("cookie")).toBe("sebela_chat=visitor");
    expect(api.calls[0]?.headers.get("origin")).toBe(SITE);
  });

  it("relays a retry as a POST with its body", async () => {
    const api = fakeApi();
    const retry = JSON.stringify({
      retryId: "44444444-0000-4000-8000-000000000001",
      challengeToken: "token",
    });
    const request = new Request(`${SITE}/api/chat/operations/${OPERATION}/retry`, {
      method: "POST",
      body: retry,
      headers: { "content-type": "application/json", origin: SITE },
    });

    await relay(api)(request, { kind: "retry", operationId: OPERATION });

    expect(api.calls[0]).toMatchObject({
      url: `${API}/v1/chat/operations/${OPERATION}/retry`,
      method: "POST",
      body: retry,
    });
    expect(api.calls[0]?.headers.get("content-type")).toBe("application/json");
  });

  it("relays a clear as a DELETE of the conversation with the confirmed conversation in its body", async () => {
    const api = fakeApi();
    const clear = JSON.stringify({ conversationId: "55555555-0000-4000-8000-000000000001" });
    const request = new Request(`${SITE}/api/chat/conversation?before=x`, {
      method: "DELETE",
      body: clear,
      headers: { "content-type": "application/json", origin: SITE },
    });

    await relay(api)(request, { kind: "clear" });

    expect(api.calls[0]).toMatchObject({
      url: `${API}/v1/chat/conversation`,
      method: "DELETE",
      body: clear,
    });
  });

  it("relays a compaction as a POST with its body, cookie, origin and token, never an API key", async () => {
    const api = fakeApi();
    const compact = JSON.stringify({
      requestId: "66666666-0000-4000-8000-000000000001",
      challengeToken: "token",
    });
    const request = new Request(`${SITE}/api/chat/conversation/compact`, {
      method: "POST",
      body: compact,
      headers: {
        "content-type": "application/json",
        origin: SITE,
        cookie: "sebela_chat=visitor",
        authorization: "Bearer not-forwarded",
      },
    });

    await relay(api)(request, { kind: "compact" });

    expect(api.calls[0]).toMatchObject({
      url: `${API}/v1/chat/conversation/compact`,
      method: "POST",
      body: compact,
    });
    expect(api.calls[0]?.headers.get("cookie")).toBe("sebela_chat=visitor");
    expect(api.calls[0]?.headers.get("origin")).toBe(SITE);
    expect(api.calls[0]?.headers.get("x-sebela-chat-relay")).toBe(TOKEN);
    expect(api.calls[0]?.headers.get("authorization")).toBeNull();
    expect(api.calls[0]?.headers.get("x-api-key")).toBeNull();
  });

  it("refuses an oversized compaction body without reaching the API", async () => {
    const api = fakeApi();
    const response = await relay(api)(
      new Request(`${SITE}/api/chat/conversation/compact`, {
        method: "POST",
        body: "x".repeat(chatRelayMaxBodyBytes + 1),
        headers: { "content-type": "application/json" },
      }),
      { kind: "compact" },
    );

    expect(response.status).toBe(413);
    expect(api.calls).toHaveLength(0);
  });

  it("refuses an oversized retry or clear body without reaching the API", async () => {
    const api = fakeApi();
    const oversized = (url: string, method: string) =>
      new Request(url, {
        method,
        body: "x".repeat(chatRelayMaxBodyBytes + 1),
        headers: { "content-type": "application/json" },
      });

    const retry = await relay(api)(
      oversized(`${SITE}/api/chat/operations/${OPERATION}/retry`, "POST"),
      { kind: "retry", operationId: OPERATION },
    );
    const clear = await relay(api)(oversized(`${SITE}/api/chat/conversation`, "DELETE"), {
      kind: "clear",
    });

    expect(retry.status).toBe(413);
    expect(clear.status).toBe(413);
    expect(api.calls).toHaveLength(0);
  });

  it("answers a stop or retry of an operation that is not one 404 without reaching the API", async () => {
    const api = fakeApi();
    const request = () =>
      new Request(`${SITE}/api/chat/operations/x/stop`, { method: "POST", body: "{}" });

    const stop = await relay(api)(request(), { kind: "stop", operationId: "../admin" });
    const retry = await relay(api)(request(), { kind: "retry", operationId: "not-a-uuid" });

    expect(stop.status).toBe(404);
    expect(retry.status).toBe(404);
    expect(api.calls).toHaveLength(0);
  });

  it("returns the API's answer as it is: status, body, every cookie and Retry-After, never cached", async () => {
    const headers = new Headers({
      "content-type": "application/json",
      "retry-after": "120",
      "cache-control": "public, max-age=60",
      "x-internal": "hidden",
    });
    headers.append("set-cookie", "sebela_chat=visitor; HttpOnly; SameSite=Lax; Path=/");
    headers.append("set-cookie", "other=1; Path=/");
    const body = JSON.stringify({ error: { code: "chat_quota_exceeded", message: "Later." } });
    const api = fakeApi(new Response(body, { status: 429, headers }));

    const response = await relay(api)(post(question), { kind: "messages" });

    expect(response.status).toBe(429);
    await expect(response.text()).resolves.toBe(body);
    expect(response.headers.getSetCookie()).toEqual([
      "sebela_chat=visitor; HttpOnly; SameSite=Lax; Path=/",
      "other=1; Path=/",
    ]);
    expect(response.headers.get("retry-after")).toBe("120");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-internal")).toBeNull();
    expect(response.headers.get("x-accel-buffering")).toBeNull();
  });

  it("answers 503 unavailable when the API cannot be reached", async () => {
    const api = fakeApi(new TypeError("connection refused"));

    const response = await relay(api)(new Request(`${SITE}/api/chat/conversation`), {
      kind: "conversation",
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "unavailable" } });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
