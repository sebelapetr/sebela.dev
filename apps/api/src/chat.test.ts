import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type {
  ChatCompactionResult,
  ChatContextSummary,
  ChatGenerationResult,
} from "@sebela/contracts";
import { chatPolicy } from "@sebela/services";
import type {
  ChallengeVerifier,
  ChatCompactionDispatch,
  ChatDispatch,
  ChatPolicy,
} from "@sebela/services";

import type { Api } from "./app.js";
import type { ChatHttpConfig } from "./config.js";
import { chatCookieName, createChatSupervisor, type ChatDispatcher } from "./modules/chat/index.js";
import {
  CLIENT,
  anyText,
  bearer,
  connection,
  json,
  openTestBackend,
  testConfig,
  type TestBackend,
} from "./test-support.js";

// Fictional values only: settings, tokens, addresses and answers.
const chatSettings = {
  fingerprintKey: "fictional-fingerprint-key-of-at-least-32-chars",
  retentionDays: 730,
  model: "fictional-model",
  effort: "medium",
  pricingVersion: "fictional-pricing-1",
};
const ORIGIN = "https://www.example.test";
const AI_SERVICE = "https://ai.example.test";
const AI_TOKEN = "fictional-ai-service-token-0123456789abcdef";
const CONTROL_TOKEN = "fictional-control-token-0123456789abcdefgh";
const RELAY_TOKEN = "fictional-chat-relay-token-0123456789abcdef";
const chatHttp: ChatHttpConfig = {
  allowedOrigins: [ORIGIN],
  cookieSecure: true,
  aiService: { url: AI_SERVICE, token: AI_TOKEN },
  controlToken: CONTROL_TOKEN,
  relayToken: RELAY_TOKEN,
};
/** The headers the website's chat relay adds: its token and, when it knows it, the visitor's address. */
const RELAY_HEADER = "x-sebela-chat-relay";
const CLIENT_HEADER = "x-sebela-chat-client";
const relayed = { [RELAY_HEADER]: RELAY_TOKEN };
const GRACE_MS = 1_000;
const timing = { pollMs: 10, progressMs: 30, graceMs: GRACE_MS };

const CONVERSATION = "/v1/chat/conversation";
const MESSAGES = "/v1/chat/conversation/messages";
const USAGE = "/v1/chat/usage";
const CLAIM = "/v1/internal/chat/grants/claim";
const operationPath = (id: string) => `/v1/chat/operations/${id}`;
const eventsPath = (id: string) => `/v1/chat/operations/${id}/events`;
const resultPath = (id: string) => `/v1/internal/chat/operations/${id}/result`;
const stopPath = (id: string) => `/v1/chat/operations/${id}/stop`;
const retryPath = (id: string) => `/v1/chat/operations/${id}/retry`;
const COMPACT = "/v1/chat/conversation/compact";
const compactionPath = (id: string) => `/v1/internal/chat/operations/${id}/compaction`;

const answerFor = (grant: string, text = "A fictional answer."): ChatGenerationResult => ({
  grant,
  outcome: "answered",
  reason: null,
  language: "en",
  text,
  blocks: [
    { type: "ServiceCard", title: "Fictional service", summary: "A summary.", href: "/services" },
  ],
  sources: [{ record: { kind: "service", id: "svc-1" }, title: "Fictional service", href: "/" }],
  related: [],
  usage: {
    costUsd: 0.004,
    costUncertain: false,
    inputTokens: 100,
    outputTokens: 50,
    modelAttempts: 1,
  },
  versions: { agent: "1" },
  latencyMs: 1200,
});

const summary: ChatContextSummary = {
  language: "en",
  goals: ["Find a fictional service for a small team"],
  openQuestions: ["The fictional timeline"],
  covered: ["Fictional services"],
  visitorClaims: [],
  references: [{ kind: "service", recordId: "svc-1", title: "Fictional service" }],
};

const compactedFor = (grant: string, kept = 1): ChatCompactionResult => ({
  grant,
  outcome: "compacted",
  reason: null,
  summary,
  kept,
  summaryTokens: 120,
  nextInputTokens: 900,
  usage: {
    costUsd: 0.003,
    costUncertain: false,
    inputTokens: 2000,
    outputTokens: 150,
    modelAttempts: 1,
  },
  versions: { prompt: "compaction-v1" },
  latencyMs: 900,
});

/**
 * A verifier that answers as told and records the tokens and addresses it was given. Like
 * Siteverify, it refuses a token it has already redeemed; `delayMs` makes it answer late.
 */
function fakeVerifier(): ChallengeVerifier & {
  addresses: (string | null)[];
  tokens: string[];
  answer: boolean;
  delayMs: number;
} {
  const verifier = {
    addresses: [] as (string | null)[],
    tokens: [] as string[],
    answer: true,
    delayMs: 0,
    verify: async (token: string, remoteAddress: string | null) => {
      const redeemed = verifier.tokens.includes(token);
      verifier.tokens.push(token);
      verifier.addresses.push(remoteAddress);
      if (verifier.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, verifier.delayMs));
      }
      return verifier.answer && token.length > 0 && !redeemed;
    },
  };
  return verifier;
}

/**
 * A dispatcher that only records what it was handed, questions and compactions apart, and what it
 * was told to stop.
 */
function capturingDispatcher(): ChatDispatcher & {
  dispatched: ChatDispatch[];
  compactions: ChatCompactionDispatch[];
  cancelled: string[];
} {
  const dispatcher = {
    dispatched: [] as ChatDispatch[],
    compactions: [] as ChatCompactionDispatch[],
    cancelled: [] as string[],
    dispatch: (dispatch: ChatDispatch | ChatCompactionDispatch) => {
      if ("question" in dispatch) dispatcher.dispatched.push(dispatch);
      else dispatcher.compactions.push(dispatch);
    },
    cancel: (operationId: string) => {
      dispatcher.cancelled.push(operationId);
    },
  };
  return dispatcher;
}

interface Frame {
  readonly event: string;
  readonly id: string | null;
  readonly data: Record<string, unknown>;
}

/** The reader of a stream and what it read past the last frame, kept across `readFrames` calls. */
const streams = new WeakMap<
  Response,
  { reader: ReadableStreamDefaultReader<string>; buffer: string }
>();

/**
 * Reads server-sent event frames until `until` accepts one or the stream ends. A later call on the
 * same response continues where the previous one stopped.
 */
async function readFrames(
  response: Response,
  until: (frame: Frame) => boolean = () => false,
): Promise<{ frames: Frame[]; ended: boolean; cancel: () => Promise<void> }> {
  let state = streams.get(response);
  if (state === undefined) {
    const body = response.body;
    if (body === null) throw new Error("The response has no body.");
    state = { reader: body.pipeThrough(new TextDecoderStream()).getReader(), buffer: "" };
    streams.set(response, state);
  }
  const { reader } = state;
  const frames: Frame[] = [];
  for (;;) {
    let boundary = state.buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const raw = state.buffer.slice(0, boundary);
      state.buffer = state.buffer.slice(boundary + 2);
      boundary = state.buffer.indexOf("\n\n");
      const fields = new Map<string, string>();
      for (const line of raw.split("\n")) {
        const colon = line.indexOf(":");
        if (colon > 0) fields.set(line.slice(0, colon), line.slice(colon + 1).trimStart());
      }
      const data = fields.get("data");
      if (data === undefined) continue;
      const frame: Frame = {
        event: fields.get("event") ?? "message",
        id: fields.get("id") ?? null,
        data: JSON.parse(data) as Record<string, unknown>,
      };
      frames.push(frame);
      if (until(frame)) return { frames, ended: false, cancel: () => reader.cancel() };
    }
    const read = await reader.read();
    if (read.done) return { frames, ended: true, cancel: () => reader.cancel() };
    state.buffer += read.value;
  }
}

const cookieOf = (response: Response) => {
  const header = response.headers.get("set-cookie");
  const value = header?.match(new RegExp(`^${chatCookieName}=([^;]+)`))?.[1];
  if (value === undefined) throw new Error("No chat cookie was set.");
  return value;
};

const terminal = (frame: Frame) =>
  frame.event === "chat" && (frame.data["type"] === "complete" || frame.data["type"] === "error");

describe("the visitor chat over HTTP", () => {
  let backend: TestBackend;
  let verifier: ReturnType<typeof fakeVerifier>;
  let dispatcher: ReturnType<typeof capturingDispatcher>;
  let clock: Date;
  let api: Api;
  let contentKey: string;

  beforeAll(async () => {
    verifier = fakeVerifier();
    backend = await openTestBackend({
      chat: { config: chatSettings, verifier, now: () => clock },
    });
    contentKey = (await backend.services.apiKeys.createKey("content writer")).key;
  });

  afterAll(async () => {
    await backend.close();
  });

  let day = 0;
  beforeEach(() => {
    // Each test asks on a day of its own, so no test meets another's fingerprint quota.
    day += 1;
    clock = new Date(Date.UTC(2031, 2, day, 12));
    verifier.answer = true;
    verifier.addresses.length = 0;
    verifier.tokens.length = 0;
    verifier.delayMs = 0;
    dispatcher = capturingDispatcher();
    api = chatApi();
  });

  function chatApi(http: Partial<ChatHttpConfig> = {}, trustedProxies: string[] = []) {
    return backend.api({
      config: testConfig({ chat: { ...chatHttp, ...http }, trustedProxies }),
      chatDispatcher: dispatcher,
      chatTiming: timing,
      now: () => clock.getTime(),
    });
  }

  /** A request as the website's relay sends it: with the relay token unless `relay` is `null`. */
  const request = (
    path: string,
    init: RequestInit = {},
    on: Api = api,
    address = CLIENT,
    relay: string | null = RELAY_TOKEN,
  ) => {
    const headers = new Headers(init.headers);
    if (relay !== null) headers.set(RELAY_HEADER, relay);
    return on.app.request(path, { ...init, headers }, connection(address));
  };

  /** A visitor with a cookie, as the website's server forwards it. */
  async function visitor(on: Api = api) {
    const opened = await request(CONVERSATION, {}, on);
    expect(opened.status).toBe(200);
    const cookie = `${chatCookieName}=${cookieOf(opened)}`;
    const { conversationId } = (await opened.json()) as { conversationId: string };
    return { cookie, conversationId };
  }

  const ask = (
    cookie: string,
    question = "What do you build?",
    requestId: string = randomUUID(),
    headers: Record<string, string> = {},
    on: Api = api,
  ) =>
    request(
      MESSAGES,
      {
        method: "POST",
        ...json(
          { requestId, question, challengeToken: `fictional-token-${randomUUID()}` },
          { cookie, origin: ORIGIN, ...headers },
        ),
      },
      on,
    );

  const control = (path: string, body: unknown, token: string = CONTROL_TOKEN) =>
    request(path, { method: "POST", ...json(body, bearer(token)) });

  const lastDispatch = () => {
    const dispatch = dispatcher.dispatched.at(-1);
    if (dispatch === undefined) throw new Error("Nothing was dispatched.");
    return dispatch;
  };

  /** Answers the last dispatched operation, so its visitor may ask again. */
  async function settleLast() {
    const dispatch = lastDispatch();
    await backend.services.chat.claim({ operationId: dispatch.operationId, grant: dispatch.grant });
    await backend.services.chat.reconcile(dispatch.operationId, answerFor(dispatch.grant));
  }

  describe("identity", () => {
    it("sets a first-party HttpOnly cookie for the retention period, then reuses it", async () => {
      const first = await request(CONVERSATION);

      expect(first.status).toBe(200);
      expect(first.headers.get("cache-control")).toBe("no-store");
      const header = first.headers.get("set-cookie") ?? "";
      expect(header).toMatch(new RegExp(`^${chatCookieName}=[A-Za-z0-9_-]{43};`));
      expect(header).toContain(`Max-Age=${String(730 * 86_400)}`);
      expect(header).toContain("Path=/");
      expect(header).toContain("HttpOnly");
      expect(header).toContain("Secure");
      expect(header).toContain("SameSite=Lax");
      const conversation = (await first.json()) as Record<string, unknown>;
      expect(conversation).toMatchObject({
        messages: [],
        nextCursor: null,
        activeOperation: null,
        retentionDays: 730,
      });

      const again = await request(CONVERSATION, {
        headers: { cookie: `${chatCookieName}=${cookieOf(first)}` },
      });
      expect(again.headers.get("set-cookie")).toBeNull();
      expect(await again.json()).toMatchObject({ conversationId: conversation["conversationId"] });
    });

    it("gives a forged or unknown cookie a fresh identity, never another visitor's", async () => {
      const known = await visitor();
      await ask(known.cookie);

      const forged = await request(CONVERSATION, {
        headers: { cookie: `${chatCookieName}=${"A".repeat(43)}` },
      });
      expect(forged.status).toBe(200);
      cookieOf(forged);
      const body = (await forged.json()) as { conversationId: string; messages: unknown[] };
      expect(body.conversationId).not.toBe(known.conversationId);
      expect(body.messages).toEqual([]);
    });

    it("omits Secure when the configuration says so", async () => {
      const response = await request(CONVERSATION, {}, chatApi({ cookieSecure: false }));

      expect(response.headers.get("set-cookie")).not.toContain("Secure");
    });
  });

  describe("the relay token", () => {
    it("is required on every visitor route, before any state change", async () => {
      const { cookie, conversationId } = await visitor();
      const asked = (await (await ask(cookie)).json()) as { operationId: string };
      await settleLast();
      const read = async () => (await request(CONVERSATION, { headers: { cookie } })).json();
      const before: unknown = await read();
      const routes: [string, RequestInit][] = [
        [CONVERSATION, { headers: { cookie } }],
        [CONVERSATION, {}],
        [
          MESSAGES,
          {
            method: "POST",
            ...json(
              {
                requestId: randomUUID(),
                question: "Without the relay?",
                challengeToken: "fictional-token",
              },
              { cookie, origin: ORIGIN, [CLIENT_HEADER]: "198.51.100.9" },
            ),
          },
        ],
        [
          COMPACT,
          {
            method: "POST",
            ...json(
              { requestId: randomUUID(), challengeToken: "fictional-token" },
              { cookie, origin: ORIGIN },
            ),
          },
        ],
        [operationPath(asked.operationId), { headers: { cookie } }],
        [eventsPath(asked.operationId), { headers: { cookie } }],
        [USAGE, { headers: { cookie } }],
        [USAGE, {}],
      ];
      verifier.addresses.length = 0;

      for (const relay of [null, "fictional-wrong-relay-token-0123456789abcdef", ""]) {
        for (const [path, init] of routes) {
          const response = await request(path, init, api, CLIENT, relay);
          expect(response.status, path).toBe(403);
          expect(await response.json()).toEqual({ error: { code: "forbidden", message: anyText } });
          expect(response.headers.get("set-cookie"), path).toBeNull();
        }
      }

      expect(verifier.addresses).toEqual([]);
      expect(dispatcher.dispatched).toHaveLength(1);
      expect(dispatcher.compactions).toEqual([]);
      expect(await read()).toEqual(before);
      expect(before).toMatchObject({ conversationId });
    });
  });

  describe("the per-client budget", () => {
    /** The website's server: every relayed request arrives from its one connection. */
    const WEBSITE = "203.0.113.20";
    const limitedApi = (max: number) =>
      backend.api({
        config: testConfig({ chat: chatHttp, rateLimits: { public: { max, windowMs: 60_000 } } }),
        chatDispatcher: dispatcher,
        chatTiming: timing,
        now: () => clock.getTime(),
      });
    const read = (on: Api, client: string | null, relay: string | null = RELAY_TOKEN) =>
      request(
        CONVERSATION,
        client === null ? {} : { headers: { [CLIENT_HEADER]: client } },
        on,
        WEBSITE,
        relay,
      );

    it("counts a relayed request against the visitor the relay names, so one flood refuses no one else", async () => {
      const on = limitedApi(3);
      for (let index = 0; index < 3; index += 1) {
        expect((await read(on, "198.51.100.1")).status).toBe(200);
      }

      const flooded = await read(on, "198.51.100.1");
      expect(flooded.status).toBe(429);
      expect(flooded.headers.get("retry-after")).not.toBeNull();
      expect((await read(on, "198.51.100.2")).status).toBe(200);
      expect((await read(on, null)).status).toBe(200);
      // The website's own public reads from the same connection keep their budget (no person here).
      expect((await on.app.request("/v1/person", {}, connection(WEBSITE))).status).toBe(404);
      // The flooding visitor's question is refused by the same budget, before any state change.
      expect(
        (
          await on.app.request(
            MESSAGES,
            {
              method: "POST",
              ...json(
                { requestId: randomUUID(), question: "Flood?", challengeToken: "fictional-token" },
                { origin: ORIGIN, [RELAY_HEADER]: RELAY_TOKEN, [CLIENT_HEADER]: "198.51.100.1" },
              ),
            },
            connection(WEBSITE),
          )
        ).status,
      ).toBe(429);
    });

    it("believes the named visitor only with the relay token", async () => {
      const on = limitedApi(2);
      for (let index = 0; index < 2; index += 1) {
        expect((await read(on, "198.51.100.3", null)).status).toBe(403);
      }

      // The forged requests spent the connection's budget, not the named visitor's.
      expect((await read(on, "198.51.100.4", null)).status).toBe(429);
      expect((await on.app.request("/v1/person", {}, connection(WEBSITE))).status).toBe(429);
      expect((await read(on, "198.51.100.3")).status).toBe(200);
      expect((await read(on, "198.51.100.3")).status).toBe(200);
      expect((await read(on, "198.51.100.3")).status).toBe(429);
    });
  });

  describe("cross-site protection", () => {
    it("refuses a question without the website's origin or as non-JSON, before any state change", async () => {
      const { cookie } = await visitor();
      const body = JSON.stringify({
        requestId: randomUUID(),
        question: "Hello?",
        challengeToken: "fictional-token",
      });
      const attempts: Record<string, string>[] = [
        { cookie, "content-type": "application/json" },
        { cookie, "content-type": "application/json", origin: "https://evil.example.test" },
        { cookie, "content-type": "application/json", origin: "null" },
        { cookie, "content-type": "text/plain", origin: ORIGIN },
        { cookie, "content-type": "application/x-www-form-urlencoded", origin: ORIGIN },
        { "content-type": "text/plain", origin: "https://evil.example.test" },
      ];

      for (const headers of attempts) {
        const response = await request(MESSAGES, { method: "POST", headers, body });
        expect(response.status, JSON.stringify(headers)).toBe(403);
        expect(await response.json()).toEqual({ error: { code: "forbidden", message: anyText } });
        expect(response.headers.get("set-cookie")).toBeNull();
      }
      expect(verifier.addresses).toEqual([]);
      expect(dispatcher.dispatched).toEqual([]);
    });
  });

  describe("asking", () => {
    it("admits a question, streams progress, and replays the reconciled answer", async () => {
      const { cookie } = await visitor();
      const requestId = randomUUID();

      const asked = await ask(cookie, "What do you build?", requestId);
      expect(asked.status).toBe(202);
      expect(asked.headers.get("cache-control")).toBe("no-store");
      const operation = (await asked.json()) as { operationId: string; status: string };
      expect(operation).toMatchObject({ requestId, status: "accepted" });
      expect(dispatcher.dispatched).toHaveLength(1);
      const dispatch = lastDispatch();
      expect(dispatch).toMatchObject({
        operationId: operation.operationId,
        question: "What do you build?",
        model: "fictional-model",
        pricingVersion: "fictional-pricing-1",
        allowanceUsd: 0.02,
        today: clock.toISOString().slice(0, 10),
      });

      const opened = await request(eventsPath(operation.operationId), { headers: { cookie } });
      expect(opened.status).toBe(200);
      expect(opened.headers.get("content-type")).toContain("text/event-stream");
      expect(opened.headers.get("cache-control")).toContain("no-store");
      const early = await readFrames(opened, (frame) => frame.event === "progress");
      expect(early.frames[0]).toMatchObject({ event: "chat", id: "0", data: { type: "start" } });
      expect(early.frames.at(-1)).toMatchObject({
        event: "progress",
        id: null,
        data: { type: "progress", requestId, stage: "queued" },
      });
      await early.cancel();

      const claimed = await control(CLAIM, {
        operationId: dispatch.operationId,
        grant: dispatch.grant,
      });
      expect(claimed.status).toBe(200);
      expect(await claimed.json()).toMatchObject({ claimed: true, model: "fictional-model" });
      const reconciled = await control(resultPath(dispatch.operationId), answerFor(dispatch.grant));
      expect(reconciled.status).toBe(200);
      expect(await reconciled.json()).toMatchObject({ status: "completed" });

      const replay = await readFrames(
        await request(eventsPath(operation.operationId), { headers: { cookie } }),
      );
      expect(replay.ended).toBe(true);
      const chatFrames = replay.frames.filter((frame) => frame.event === "chat");
      expect(chatFrames.map((frame) => frame.data["type"])).toEqual([
        "start",
        "text_delta",
        "block",
        "sources",
        "complete",
      ]);
      expect(chatFrames.map((frame) => frame.id)).toEqual(["0", "1", "2", "3", "4"]);
      expect(chatFrames.at(-1)?.data).toMatchObject({ outcome: "answered" });

      const conversation = (await (
        await request(CONVERSATION, { headers: { cookie } })
      ).json()) as { messages: { role: string; text: string | null }[] };
      expect(conversation.messages.map((message) => [message.role, message.text])).toEqual([
        ["user", "What do you build?"],
        ["assistant", "A fictional answer."],
      ]);
    });

    it("resumes after a disconnect from Last-Event-ID, with one dispatch and one answer", async () => {
      const { cookie } = await visitor();
      const asked = (await (await ask(cookie)).json()) as { operationId: string };
      const first = await readFrames(
        await request(eventsPath(asked.operationId), { headers: { cookie } }),
        (frame) => frame.event === "chat",
      );
      await first.cancel();
      const dispatch = lastDispatch();
      await control(CLAIM, { operationId: dispatch.operationId, grant: dispatch.grant });
      await control(resultPath(dispatch.operationId), answerFor(dispatch.grant));

      const resumed = await readFrames(
        await request(eventsPath(asked.operationId), {
          headers: { cookie, "last-event-id": "0" },
        }),
      );
      const ids = resumed.frames.filter((frame) => frame.event === "chat").map((frame) => frame.id);
      expect(ids).toEqual(["1", "2", "3", "4"]);
      const again = await readFrames(
        await request(eventsPath(asked.operationId), {
          headers: { cookie, "last-event-id": "2" },
        }),
      );
      expect(again.frames.filter((frame) => frame.event === "chat").map((f) => f.id)).toEqual([
        "3",
        "4",
      ]);
      expect(dispatcher.dispatched).toHaveLength(1);
    });

    it("answers a repeated request with the same operation, and refuses a changed or second question", async () => {
      const { cookie } = await visitor();
      const requestId = randomUUID();
      const first = (await (await ask(cookie, "First?", requestId)).json()) as {
        operationId: string;
      };

      const repeated = await ask(cookie, "First?", requestId);
      expect(repeated.status).toBe(200);
      expect(await repeated.json()).toMatchObject({ operationId: first.operationId });

      const changed = await ask(cookie, "Changed?", requestId);
      expect(changed.status).toBe(409);
      expect(await changed.json()).toEqual({
        error: { code: "chat_request_conflict", message: anyText },
      });

      const second = await ask(cookie, "Second?");
      expect(second.status).toBe(409);
      expect(await second.json()).toEqual({ error: { code: "chat_busy", message: anyText } });
      expect(dispatcher.dispatched).toHaveLength(1);
    });

    it("refuses a failed challenge, a sixth question in a minute and a malformed body", async () => {
      const { cookie } = await visitor();

      verifier.answer = false;
      const failed = await ask(cookie);
      expect(failed.status).toBe(403);
      expect(await failed.json()).toEqual({
        error: { code: "chat_challenge_failed", message: anyText },
      });
      verifier.answer = true;

      for (let question = 0; question < 5; question += 1) {
        expect((await ask(cookie, `Question ${String(question)}?`)).status).toBe(202);
        const dispatch = lastDispatch();
        await backend.services.chat.claim({
          operationId: dispatch.operationId,
          grant: dispatch.grant,
        });
        await backend.services.chat.reconcile(dispatch.operationId, answerFor(dispatch.grant));
        clock = new Date(clock.getTime() + 1_000);
      }
      const sixth = await ask(cookie, "Sixth?");
      expect(sixth.status).toBe(429);
      expect(await sixth.json()).toEqual({
        error: { code: "chat_quota_exceeded", message: anyText },
      });
      expect(sixth.headers.get("retry-after")).toBe("55");

      const malformed = await request(MESSAGES, {
        method: "POST",
        ...json({ question: "No request?" }, { cookie, origin: ORIGIN }),
      });
      expect(malformed.status).toBe(400);
      expect(await malformed.json()).toMatchObject({ error: { code: "validation_failed" } });
    });

    it("hands the challenge the address the relay names, and trusts no forwarded address", async () => {
      const { cookie } = await visitor();
      await ask(cookie, "Relayed?", randomUUID(), { [CLIENT_HEADER]: "198.51.100.7" });
      await settleLast();
      await ask(cookie, "IPv6?", randomUUID(), { [CLIENT_HEADER]: "2001:db8::7" });
      await settleLast();

      const proxied = chatApi({}, [CLIENT]);
      const viaProxy = await visitor(proxied);
      await ask(
        viaProxy.cookie,
        "Via a trusted proxy?",
        randomUUID(),
        { "x-forwarded-for": "198.51.100.8" },
        proxied,
      );

      expect(verifier.addresses).toEqual(["198.51.100.7", "2001:db8::7", null]);
    });

    it("treats an address that is not one IP literal as unknown", async () => {
      for (const address of ["not-an-address", "198.51.100.7, 198.51.100.8", "198.51.100.7:443"]) {
        const { cookie } = await visitor();
        expect((await ask(cookie, "Odd?", randomUUID(), { [CLIENT_HEADER]: address })).status).toBe(
          202,
        );
      }

      expect(verifier.addresses).toEqual([null, null, null]);
    });

    it("counts each relayed address on its own, and every unknown one together", async () => {
      // The fingerprint quota is 20 questions a minute; the identity quota is five.
      const askFrom = async (address: string | null, times: number) => {
        const statuses: number[] = [];
        let { cookie } = await visitor();
        for (let question = 0; question < times; question += 1) {
          if (question > 0 && question % 5 === 0) ({ cookie } = await visitor());
          const headers: Record<string, string> =
            address === null ? {} : { [CLIENT_HEADER]: address };
          const response = await ask(
            cookie,
            `Question ${String(question)}?`,
            randomUUID(),
            headers,
          );
          statuses.push(response.status);
          if (response.status === 202) await settleLast();
        }
        return statuses;
      };

      expect(await askFrom("198.51.100.21", 20)).toEqual(Array<number>(20).fill(202));
      expect(await askFrom("198.51.100.21", 1)).toEqual([429]);
      expect(await askFrom("198.51.100.22", 1)).toEqual([202]);

      expect(await askFrom(null, 10)).toEqual(Array<number>(10).fill(202));
      expect(await askFrom("not-an-address", 10)).toEqual(Array<number>(10).fill(202));
      expect(await askFrom(null, 1)).toEqual([429]);
    });

    it("redeems the challenge once for two concurrent equal submissions", async () => {
      verifier.delayMs = 50;
      const { cookie } = await visitor();
      const body = {
        requestId: randomUUID(),
        question: "Twice at once?",
        challengeToken: `fictional-token-${randomUUID()}`,
      };
      const submit = () =>
        request(MESSAGES, { method: "POST", ...json(body, { cookie, origin: ORIGIN }) });

      const responses = await Promise.all([submit(), submit()]);

      for (const response of responses) expect([200, 202]).toContain(response.status);
      const operations = await Promise.all(
        responses.map(
          async (response) => ((await response.json()) as { operationId: string }).operationId,
        ),
      );
      expect(operations[0]).toBeDefined();
      expect(operations[1]).toBe(operations[0]);
      expect(verifier.tokens).toEqual([body.challengeToken]);
      expect(dispatcher.dispatched).toHaveLength(1);
    });

    it("reads only the caller's operations", async () => {
      const owner = await visitor();
      const asked = (await (await ask(owner.cookie)).json()) as { operationId: string };
      const stranger = await visitor();

      const own = await request(operationPath(asked.operationId), {
        headers: { cookie: owner.cookie },
      });
      expect(own.status).toBe(200);
      expect(await own.json()).toMatchObject({ operationId: asked.operationId });

      for (const path of [operationPath(asked.operationId), eventsPath(asked.operationId)]) {
        const foreign = await request(path, { headers: { cookie: stranger.cookie } });
        expect(foreign.status, path).toBe(404);
        expect(await foreign.json()).toEqual({ error: { code: "not_found", message: anyText } });
      }
      const unknown = await request(operationPath(randomUUID()), {
        headers: { cookie: owner.cookie },
      });
      expect(unknown.status).toBe(404);
      expect(
        (await request(operationPath("not-an-id"), { headers: { cookie: owner.cookie } })).status,
      ).toBe(400);
    });

    it("pages the conversation with a bounded limit", async () => {
      const { cookie } = await visitor();
      await ask(cookie);
      const dispatch = lastDispatch();
      await backend.services.chat.claim({
        operationId: dispatch.operationId,
        grant: dispatch.grant,
      });
      await backend.services.chat.reconcile(dispatch.operationId, answerFor(dispatch.grant));

      const page = (await (
        await request(`${CONVERSATION}?limit=1`, { headers: { cookie } })
      ).json()) as { messages: { id: string; role: string }[]; nextCursor: string | null };
      expect(page.messages.map((message) => message.role)).toEqual(["assistant"]);
      expect(page.nextCursor).toBe(page.messages[0]?.id);
      const older = (await (
        await request(`${CONVERSATION}?limit=1&before=${String(page.nextCursor)}`, {
          headers: { cookie },
        })
      ).json()) as { messages: { role: string }[]; nextCursor: string | null };
      expect(older.messages.map((message) => message.role)).toEqual(["user"]);
      expect(older.nextCursor).toBeNull();

      for (const query of ["limit=21", "limit=0", "before=not-an-id", "other=1"]) {
        const refused = await request(`${CONVERSATION}?${query}`, { headers: { cookie } });
        expect(refused.status, query).toBe(400);
      }
    });
  });

  describe("the control routes", () => {
    it("claim a grant once, and refuse a wrong grant", async () => {
      const { cookie } = await visitor();
      await ask(cookie);
      const dispatch = lastDispatch();

      const wrong = await control(CLAIM, { operationId: dispatch.operationId, grant: "wrong" });
      expect(wrong.status).toBe(403);
      expect(await wrong.json()).toEqual({ error: { code: "forbidden", message: anyText } });
      const claim = { operationId: dispatch.operationId, grant: dispatch.grant };
      expect((await control(CLAIM, claim)).status).toBe(200);
      const replayed = await control(CLAIM, claim);
      expect(replayed.status).toBe(409);
      expect(await replayed.json()).toEqual({ error: { code: "conflict", message: anyText } });
    });

    it("reconcile one result: a repeat changes nothing, an unclaimed or wrong grant is refused", async () => {
      const { cookie } = await visitor();
      await ask(cookie);
      const dispatch = lastDispatch();

      const unclaimed = await control(resultPath(dispatch.operationId), answerFor(dispatch.grant));
      expect(unclaimed.status).toBe(409);
      await control(CLAIM, { operationId: dispatch.operationId, grant: dispatch.grant });
      const wrong = await control(resultPath(dispatch.operationId), answerFor("wrong-grant"));
      expect(wrong.status).toBe(403);
      expect(
        (await control(resultPath(dispatch.operationId), answerFor(dispatch.grant, "First.")))
          .status,
      ).toBe(200);
      const repeat = await control(
        resultPath(dispatch.operationId),
        answerFor(dispatch.grant, "Second."),
      );
      expect(repeat.status).toBe(200);
      const conversation = (await (
        await request(CONVERSATION, { headers: { cookie } })
      ).json()) as { messages: { text: string | null }[] };
      expect(conversation.messages.at(-1)?.text).toBe("First.");

      const noGrant = await control(resultPath(dispatch.operationId), { outcome: "answered" });
      expect(noGrant.status).toBe(400);
      expect(await noGrant.json()).toMatchObject({ error: { code: "validation_failed" } });
    });

    it("store a result that fails the contract as an internal failure, never its draft", async () => {
      const { cookie } = await visitor();
      const asked = (await (await ask(cookie)).json()) as { operationId: string };
      const dispatch = lastDispatch();
      await control(CLAIM, { operationId: dispatch.operationId, grant: dispatch.grant });

      const invalid = await control(resultPath(dispatch.operationId), {
        ...answerFor(dispatch.grant, "A fictional unapproved draft."),
        blocks: "not blocks",
      });
      expect(invalid.status).toBe(200);
      expect(await invalid.json()).toMatchObject({ status: "failed" });

      const replay = await readFrames(
        await request(eventsPath(asked.operationId), { headers: { cookie } }),
      );
      expect(replay.frames.filter((frame) => frame.event === "chat").at(-1)?.data).toMatchObject({
        type: "error",
        code: "internal",
        retryable: false,
      });
      const conversation = await (await request(CONVERSATION, { headers: { cookie } })).text();
      expect(conversation).not.toContain("unapproved draft");
    });

    it("accept only the control token, which no other route accepts", async () => {
      const { cookie } = await visitor();
      await ask(cookie);
      const dispatch = lastDispatch();
      const claim = { operationId: dispatch.operationId, grant: dispatch.grant };

      for (const token of [contentKey, AI_TOKEN, `${CONTROL_TOKEN}x`, CONTROL_TOKEN.slice(1)]) {
        const refused = await control(CLAIM, claim, token);
        expect(refused.status).toBe(401);
        expect(refused.headers.get("www-authenticate")).toBe("Bearer");
      }
      const anonymous = await request(CLAIM, { method: "POST", ...json(claim) });
      expect(anonymous.status).toBe(401);

      const asContentKey = await request("/v1/authentication", {
        headers: bearer(CONTROL_TOKEN),
      });
      expect(asContentKey.status).toBe(401);
      expect((await control(CLAIM, claim)).status).toBe(200);
    });
  });

  describe("the deadline", () => {
    it("ends the stream with a retryable timeout after the deadline and its grace", async () => {
      const { cookie } = await visitor();
      const asked = (await (await ask(cookie)).json()) as {
        operationId: string;
        deadlineAt: string;
      };
      const response = await request(eventsPath(asked.operationId), { headers: { cookie } });
      const started = await readFrames(response, (frame) => frame.event === "chat");
      expect(started.frames.at(-1)?.data).toMatchObject({ type: "start" });

      clock = new Date(Date.parse(asked.deadlineAt) + GRACE_MS + 1);
      const rest = await readFrames(response, terminal);
      expect(rest.frames.at(-1)).toMatchObject({
        event: "chat",
        id: "1",
        data: { type: "error", code: "timeout", retryable: true, eventId: 1 },
      });

      const supervisor = createChatSupervisor({
        chat: backend.services.chat,
        aiService: chatHttp.aiService,
        log: () => undefined,
        graceMs: GRACE_MS,
      });
      await supervisor.close();
      expect(await backend.services.chat.interruptOverdue(GRACE_MS)).toContain(asked.operationId);
      const replay = await readFrames(
        await request(eventsPath(asked.operationId), { headers: { cookie } }),
      );
      expect(replay.frames.filter((frame) => frame.event === "chat").at(-1)).toMatchObject({
        id: "1",
        data: { type: "error", code: "timeout", retryable: true },
      });
    });

    it("recovers from the API's loss at every stage after a restart, never redispatching", async () => {
      const start = clock.getTime();
      // Lost before dispatch: admitted, never handed to the AI service.
      const lostBeforeDispatch = await visitor();
      await ask(lostBeforeDispatch.cookie, "Lost before dispatch?");
      const undispatched = lastDispatch();
      // Lost after the claim, while the provider answers.
      const lostAfterClaim = await visitor();
      await ask(lostAfterClaim.cookie, "Lost after the claim?");
      const claimed = lastDispatch();
      const claim = { operationId: claimed.operationId, grant: claimed.grant };
      expect((await control(CLAIM, claim)).status).toBe(200);
      // Lost before the result was stored: admitted later, so still within its deadline.
      clock = new Date(start + 50_000);
      const lostBeforeResult = await visitor();
      await ask(lostBeforeResult.cookie, "Lost before the result?");
      const answering = lastDispatch();
      const answeringClaim = { operationId: answering.operationId, grant: answering.grant };
      expect((await control(CLAIM, answeringClaim)).status).toBe(200);

      // The restart: a new process sweeps the durable deadlines once at start.
      clock = new Date(start + 60_000 + GRACE_MS + 1);
      api = chatApi();
      const calls: string[] = [];
      const supervisor = createChatSupervisor({
        chat: backend.services.chat,
        aiService: chatHttp.aiService,
        log: () => undefined,
        graceMs: GRACE_MS,
        watchIntervalMs: 60_000,
        fetch: (input) => {
          calls.push(input instanceof Request ? input.url : input.toString());
          return Promise.resolve(new Response(null, { status: 202 }));
        },
      });
      supervisor.start();
      await new Promise((resolve) => setTimeout(resolve, 20));
      await supervisor.close();
      expect(calls).toEqual([]);

      for (const [{ cookie }, operationId] of [
        [lostBeforeDispatch, undispatched.operationId],
        [lostAfterClaim, claimed.operationId],
      ] as const) {
        const operation = await request(operationPath(operationId), { headers: { cookie } });
        expect(await operation.json()).toMatchObject({ status: "interrupted" });
        const conversation = (await (
          await request(CONVERSATION, { headers: { cookie } })
        ).json()) as { activeOperation: unknown; messages: { error?: unknown }[] };
        expect(conversation.activeOperation).toBeNull();
        expect(conversation.messages.at(-1)?.error).toEqual({ code: "timeout", retryable: true });
      }
      // One-use grants stay used after the restart, and an interrupted grant cannot start work.
      const undispatchedClaim = {
        operationId: undispatched.operationId,
        grant: undispatched.grant,
      };
      expect((await control(CLAIM, undispatchedClaim)).status).toBe(409);
      expect((await control(CLAIM, claim)).status).toBe(409);
      expect((await control(CLAIM, answeringClaim)).status).toBe(409);
      // A late result of the interrupted generation changes nothing.
      const late = await control(resultPath(claimed.operationId), answerFor(claimed.grant));
      expect(late.status).toBe(200);
      expect(await late.json()).toMatchObject({ status: "interrupted" });

      // The AI service repeats the result the lost API never stored: stored once, then replayed.
      const stored = await control(resultPath(answering.operationId), answerFor(answering.grant));
      expect(stored.status).toBe(200);
      const storedBody: unknown = await stored.json();
      expect(storedBody).toMatchObject({ status: "completed" });
      const repeated = await control(resultPath(answering.operationId), answerFor(answering.grant));
      expect(await repeated.json()).toEqual(storedBody);
      expect(dispatcher.dispatched.map((dispatch) => dispatch.operationId)).toEqual([
        undispatched.operationId,
        claimed.operationId,
        answering.operationId,
      ]);
    });
  });

  describe("the conversation lifecycle", () => {
    const stop = (cookie: string, operationId: string, headers: Record<string, string> = {}) =>
      request(stopPath(operationId), {
        method: "POST",
        headers: { cookie, origin: ORIGIN, ...headers },
      });
    const retry = (cookie: string, operationId: string, retryId: string = randomUUID()) =>
      request(retryPath(operationId), {
        method: "POST",
        ...json(
          { retryId, challengeToken: `fictional-token-${randomUUID()}` },
          { cookie, origin: ORIGIN },
        ),
      });
    const clear = (cookie: string, conversationId: string, headers: Record<string, string> = {}) =>
      request(CONVERSATION, {
        method: "DELETE",
        ...json({ conversationId }, { cookie, origin: ORIGIN, ...headers }),
      });

    /** Asks, claims and ends the attempt with a retryable timeout, as the AI service reports it. */
    async function timedOut(cookie: string, question = "What do you build?") {
      const asked = (await (await ask(cookie, question)).json()) as { operationId: string };
      const dispatch = lastDispatch();
      await control(CLAIM, { operationId: dispatch.operationId, grant: dispatch.grant });
      await control(resultPath(dispatch.operationId), {
        ...answerFor(dispatch.grant, ""),
        outcome: "limit_reached",
        reason: "deadline",
        blocks: [],
        sources: [],
      });
      clock = new Date(clock.getTime() + 1000);
      return asked.operationId;
    }

    it("shares one conversation and one active operation between two tabs (C02)", async () => {
      verifier.delayMs = 30;
      const { cookie, conversationId } = await visitor();
      const requestId = randomUUID();
      const body = { requestId, question: "Two tabs?", challengeToken: "fictional-token-tabs" };
      const submit = () =>
        request(MESSAGES, { method: "POST", ...json(body, { cookie, origin: ORIGIN }) });

      const [first, second] = await Promise.all([submit(), submit()]);
      const ids = await Promise.all(
        [first, second].map(
          async (response) => ((await response.json()) as { operationId: string }).operationId,
        ),
      );
      expect(ids[1]).toBe(ids[0]);
      expect(dispatcher.dispatched).toHaveLength(1);
      const operationId = ids[0] ?? "";

      const hidden = await ask(cookie, "A second question from the other tab?");
      expect(hidden.status).toBe(409);
      expect(await hidden.json()).toEqual({ error: { code: "chat_busy", message: anyText } });
      expect(dispatcher.dispatched).toHaveLength(1);

      const tabs = await Promise.all(
        [0, 1].map(
          async () =>
            (await (await request(CONVERSATION, { headers: { cookie } })).json()) as {
              conversationId: string;
              activeOperation: { operationId: string } | null;
            },
        ),
      );
      for (const tab of tabs) {
        expect(tab).toMatchObject({ conversationId, activeOperation: { operationId } });
      }

      const streams = await Promise.all(
        [0, 1].map(async () => request(eventsPath(operationId), { headers: { cookie } })),
      );
      await Promise.all(streams.map((stream) => readFrames(stream, (f) => f.event === "chat")));
      const dispatch = lastDispatch();
      await control(CLAIM, { operationId, grant: dispatch.grant });
      await control(resultPath(operationId), answerFor(dispatch.grant));
      const rests = await Promise.all(streams.map((stream) => readFrames(stream, terminal)));
      const [a, b] = rests.map((rest) =>
        rest.frames
          .filter((frame) => frame.event === "chat")
          .map((frame) => [frame.id, frame.data]),
      );
      expect(a).toEqual(b);
      expect(a?.at(-1)?.[1]).toMatchObject({ type: "complete", outcome: "answered" });

      const stranger = await visitor();
      for (const path of [operationPath(operationId), eventsPath(operationId)]) {
        expect((await request(path, { headers: { cookie: stranger.cookie } })).status).toBe(404);
      }
      const foreign = (await (
        await request(CONVERSATION, { headers: { cookie: stranger.cookie } })
      ).json()) as { messages: unknown[] };
      expect(foreign.messages).toEqual([]);
    });

    it("stops the active operation from either tab, without a challenge, and tells the AI service", async () => {
      const { cookie } = await visitor();
      const asked = (await (await ask(cookie)).json()) as { operationId: string };
      const dispatch = lastDispatch();
      await control(CLAIM, { operationId: dispatch.operationId, grant: dispatch.grant });
      const watching = await request(eventsPath(asked.operationId), { headers: { cookie } });
      await readFrames(watching, (frame) => frame.event === "chat");
      const challenged = verifier.tokens.length;

      const stopped = await stop(cookie, asked.operationId);

      expect(stopped.status).toBe(200);
      expect(stopped.headers.get("cache-control")).toBe("no-store");
      expect(await stopped.json()).toMatchObject({
        operationId: asked.operationId,
        status: "cancelled",
      });
      expect(dispatcher.cancelled).toEqual([asked.operationId]);
      expect(verifier.tokens).toHaveLength(challenged);
      const rest = await readFrames(watching, terminal);
      expect(rest.frames.at(-1)?.data).toMatchObject({
        type: "error",
        code: "cancelled",
        retryable: true,
      });

      const late = await control(resultPath(dispatch.operationId), answerFor(dispatch.grant));
      expect(late.status).toBe(200);
      expect(await late.json()).toMatchObject({ status: "cancelled" });
      const conversation = (await (
        await request(CONVERSATION, { headers: { cookie } })
      ).json()) as { messages: { role: string; text: string | null; status: string }[] };
      expect(conversation.messages.at(-1)).toMatchObject({ status: "cancelled", text: null });

      const again = await stop(cookie, asked.operationId);
      expect(again.status).toBe(200);
      expect(await again.json()).toMatchObject({ status: "cancelled" });
      expect(dispatcher.cancelled).toHaveLength(1);
      expect((await ask(cookie, "And now?")).status).toBe(202);
    });

    it("does not tell the AI service to stop a generation that never claimed its grant", async () => {
      const { cookie } = await visitor();
      const asked = (await (await ask(cookie)).json()) as { operationId: string };
      expect((await stop(cookie, asked.operationId)).status).toBe(200);
      expect(dispatcher.cancelled).toEqual([]);
      const dispatch = lastDispatch();
      expect(
        (await control(CLAIM, { operationId: dispatch.operationId, grant: dispatch.grant })).status,
      ).toBe(409);
    });

    it("retries a retryable failure as a new attempt of the same question", async () => {
      const { cookie } = await visitor();
      const failed = await timedOut(cookie, "Retry me?");
      const retryId = randomUUID();

      const retried = await retry(cookie, failed, retryId);

      expect(retried.status).toBe(202);
      const operation = (await retried.json()) as { operationId: string; status: string };
      expect(operation.operationId).not.toBe(failed);
      expect(operation.status).toBe("accepted");
      expect(dispatcher.dispatched).toHaveLength(2);
      expect(lastDispatch()).toMatchObject({
        operationId: operation.operationId,
        question: "Retry me?",
      });
      const repeated = await retry(cookie, failed, retryId);
      expect(repeated.status).toBe(200);
      expect(await repeated.json()).toMatchObject({ operationId: operation.operationId });
      expect(dispatcher.dispatched).toHaveLength(2);

      const conversation = (await (
        await request(CONVERSATION, { headers: { cookie } })
      ).json()) as { messages: { role: string; status?: string }[] };
      // The question stays once; only the failed answer is replaced by the new attempt's.
      expect(conversation.messages.map((message) => [message.role, message.status])).toEqual([
        ["user", undefined],
        ["assistant", "pending"],
      ]);
    });

    it("refuses a retry of another visitor's, an answered or an unknown operation", async () => {
      const owner = await visitor();
      const failed = await timedOut(owner.cookie);
      const stranger = await visitor();
      for (const [cookie, id] of [
        [stranger.cookie, failed],
        [owner.cookie, randomUUID()],
      ] as const) {
        const refused = await retry(cookie, id);
        expect(refused.status).toBe(404);
        expect(await refused.json()).toEqual({ error: { code: "not_found", message: anyText } });
      }

      const answered = await visitor();
      const asked = (await (await ask(answered.cookie)).json()) as { operationId: string };
      await settleLast();
      const recovered = await retry(answered.cookie, asked.operationId);
      expect(recovered.status).toBe(200);
      expect(await recovered.json()).toMatchObject({
        operationId: asked.operationId,
        status: "completed",
      });

      const other = await visitor();
      await ask(other.cookie);
      const dispatch = lastDispatch();
      await control(CLAIM, { operationId: dispatch.operationId, grant: dispatch.grant });
      await control(resultPath(dispatch.operationId), {
        ...answerFor(dispatch.grant),
        blocks: [{}],
      });
      const notRetryable = await retry(other.cookie, dispatch.operationId);
      expect(notRetryable.status).toBe(409);
      expect(await notRetryable.json()).toEqual({
        error: { code: "chat_not_retryable", message: anyText },
      });
      expect((await retry(other.cookie, "not-an-id")).status).toBe(400);
    });

    it("clears the conversation after a confirmation, cancels active work and keeps the quota", async () => {
      const { cookie, conversationId } = await visitor();
      await ask(cookie);
      await settleLast();
      clock = new Date(clock.getTime() + 1000);
      await ask(cookie, "Still running?");
      const active = lastDispatch();
      await control(CLAIM, { operationId: active.operationId, grant: active.grant });
      const challenged = verifier.tokens.length;

      const unconfirmed = await clear(cookie, randomUUID());
      expect(unconfirmed.status).toBe(200);
      expect(await unconfirmed.json()).toMatchObject({
        cleared: false,
        telemetryDeletion: "none",
        conversation: { conversationId, activeOperation: { operationId: active.operationId } },
      });
      expect(dispatcher.cancelled).toEqual([]);

      const cleared = await clear(cookie, conversationId);

      expect(cleared.status).toBe(200);
      expect(cleared.headers.get("cache-control")).toBe("no-store");
      const body = (await cleared.json()) as {
        cleared: boolean;
        telemetryDeletion: string;
        conversation: { conversationId: string; messages: unknown[]; activeOperation: unknown };
      };
      expect(body).toMatchObject({
        cleared: true,
        telemetryDeletion: "none",
        conversation: { messages: [], activeOperation: null },
      });
      expect(body.conversation.conversationId).not.toBe(conversationId);
      expect(dispatcher.cancelled).toEqual([active.operationId]);
      expect(verifier.tokens).toHaveLength(challenged);
      const late = await control(resultPath(active.operationId), answerFor(active.grant));
      expect(late.status).toBe(409);
      expect(
        (await request(operationPath(active.operationId), { headers: { cookie } })).status,
      ).toBe(404);
      const after = (await (await request(CONVERSATION, { headers: { cookie } })).json()) as {
        conversationId: string;
        messages: unknown[];
      };
      expect(after).toMatchObject({
        conversationId: body.conversation.conversationId,
        messages: [],
      });

      for (let index = 0; index < 3; index += 1) {
        clock = new Date(clock.getTime() + 1000);
        expect((await ask(cookie, `Question ${String(index)}?`)).status).toBe(202);
        await settleLast();
      }
      clock = new Date(clock.getTime() + 1000);
      expect((await ask(cookie, "One too many?")).status).toBe(429);
    });

    it("refuses a clear, Stop and retry without the website's origin, before any state change", async () => {
      const { cookie, conversationId } = await visitor();
      const asked = (await (await ask(cookie)).json()) as { operationId: string };
      for (const response of [
        await request(CONVERSATION, {
          method: "DELETE",
          ...json({ conversationId }, { cookie }),
        }),
        await request(CONVERSATION, {
          method: "DELETE",
          ...json({ conversationId }, { cookie, origin: "https://elsewhere.example.test" }),
        }),
        await request(stopPath(asked.operationId), { method: "POST", headers: { cookie } }),
        await request(retryPath(asked.operationId), {
          method: "POST",
          ...json({ retryId: randomUUID(), challengeToken: "fictional-token" }, { cookie }),
        }),
      ]) {
        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({ error: { code: "forbidden", message: anyText } });
      }
      const operation = (await (
        await request(operationPath(asked.operationId), { headers: { cookie } })
      ).json()) as { status: string };
      expect(operation.status).toBe("accepted");
      expect(dispatcher.cancelled).toEqual([]);
    });

    it("never stops or clears another visitor's work, whatever the URL names", async () => {
      const owner = await visitor();
      const asked = (await (await ask(owner.cookie)).json()) as { operationId: string };
      const stranger = await visitor();

      const stopped = await stop(stranger.cookie, asked.operationId);
      expect(stopped.status).toBe(404);
      const cleared = await clear(stranger.cookie, owner.conversationId);
      expect(cleared.status).toBe(200);
      expect(await cleared.json()).toMatchObject({
        cleared: false,
        conversation: { conversationId: stranger.conversationId },
      });
      expect(dispatcher.cancelled).toEqual([]);
      expect(
        await (
          await request(operationPath(asked.operationId), { headers: { cookie: owner.cookie } })
        ).json(),
      ).toMatchObject({ status: "accepted" });
    });

    it("keeps the visitor routes from service tokens and the control routes from the relay", async () => {
      const { cookie, conversationId } = await visitor();
      const asked = (await (await ask(cookie)).json()) as { operationId: string };
      const dispatch = lastDispatch();
      for (const token of [CONTROL_TOKEN, AI_TOKEN, contentKey]) {
        for (const response of [
          await request(
            stopPath(asked.operationId),
            { method: "POST", headers: { cookie, origin: ORIGIN, ...bearer(token) } },
            api,
            CLIENT,
            null,
          ),
          await request(
            CONVERSATION,
            {
              method: "DELETE",
              ...json({ conversationId }, { cookie, origin: ORIGIN, ...bearer(token) }),
            },
            api,
            CLIENT,
            null,
          ),
        ]) {
          expect(response.status).toBe(403);
        }
      }
      for (const [path, body] of [
        [CLAIM, { operationId: dispatch.operationId, grant: dispatch.grant }],
        [resultPath(dispatch.operationId), answerFor(dispatch.grant)],
      ] as const) {
        const relayedOnly = await request(path, { method: "POST", ...json(body, { cookie }) });
        expect(relayedOnly.status).toBe(401);
        expect((await control(path, body, RELAY_TOKEN)).status).toBe(401);
      }
      expect(dispatcher.cancelled).toEqual([]);
      expect(
        await (await request(operationPath(asked.operationId), { headers: { cookie } })).json(),
      ).toMatchObject({ status: "accepted" });
    });

    it("gives the AI service's credentials no private route and no visitor conversation", async () => {
      const { cookie, conversationId } = await visitor();
      const asked = (await (await ask(cookie)).json()) as { operationId: string };
      const control = new Set([
        CLAIM,
        "/v1/internal/chat/operations/:operationId/result",
        "/v1/internal/chat/operations/:operationId/compaction",
      ]);
      const credentials = [CONTROL_TOKEN, AI_TOKEN, RELAY_TOKEN];
      const privateRoutes = api.routes.filter(
        (route) => route.access === "private" && !control.has(route.path),
      );
      // Content writes, keys, the audit, originals and every other private route.
      expect(privateRoutes.length).toBeGreaterThan(60);
      for (const route of privateRoutes) {
        const path = route.path
          .replace(":id", randomUUID())
          .replace(":date", "2001-01-01")
          .replace(/:([A-Za-z]+)(\{[^}]*\})?/g, "missing-record");
        for (const token of credentials) {
          const init =
            route.method === "GET" ? { headers: bearer(token) } : json({}, bearer(token));
          const refused = await request(path, { method: route.method, ...init }, api, CLIENT, null);
          expect(refused.status, `${route.method} ${route.path}`).toBe(401);
        }
      }
      // A service credential without the relay token reads and changes no conversation.
      for (const token of credentials.slice(0, 2)) {
        const headers = { cookie, origin: ORIGIN, ...bearer(token) };
        for (const path of [
          CONVERSATION,
          operationPath(asked.operationId),
          eventsPath(asked.operationId),
        ]) {
          expect((await request(path, { headers }, api, CLIENT, null)).status).toBe(403);
        }
        const asking = await request(
          MESSAGES,
          {
            method: "POST",
            ...json({ requestId: randomUUID(), question: "Hi?", challengeToken: "t" }, headers),
          },
          api,
          CLIENT,
          null,
        );
        expect(asking.status).toBe(403);
        const retrying = await request(
          retryPath(asked.operationId),
          { method: "POST", ...json({ retryId: randomUUID(), challengeToken: "t" }, headers) },
          api,
          CLIENT,
          null,
        );
        expect(retrying.status).toBe(403);
      }
      expect(dispatcher.dispatched).toHaveLength(1);
      const conversation = (await (
        await request(CONVERSATION, { headers: { cookie } })
      ).json()) as { conversationId: string; messages: unknown[] };
      expect(conversation).toMatchObject({ conversationId });
      expect(conversation.messages).toHaveLength(2);
    });
  });

  describe("compaction", () => {
    const compact = (
      cookie: string,
      requestId: string = randomUUID(),
      headers: Record<string, string> = {},
    ) =>
      request(COMPACT, {
        method: "POST",
        ...json(
          { requestId, challengeToken: `fictional-token-${randomUUID()}` },
          { cookie, origin: ORIGIN, ...headers },
        ),
      });

    const lastCompaction = () => {
      const dispatch = dispatcher.compactions.at(-1);
      if (dispatch === undefined) throw new Error("No compaction was dispatched.");
      return dispatch;
    };

    /** A visitor whose conversation holds `count` answered exchanges. */
    async function withExchanges(count: number) {
      const opened = await visitor();
      for (let index = 0; index < count; index += 1) {
        clock = new Date(clock.getTime() + 1000);
        expect((await ask(opened.cookie, `Question ${String(index)}?`)).status).toBe(202);
        await settleLast();
      }
      clock = new Date(clock.getTime() + 1000);
      return opened;
    }

    const conversationOf = async (cookie: string) =>
      (await (await request(CONVERSATION, { headers: { cookie } })).json()) as {
        messages: { role: string; text: string | null }[];
        activeOperation: unknown;
      };

    it("answers a small context locally, with no challenge, quota or dispatch", async () => {
      for (const count of [0, 2]) {
        const { cookie } = await withExchanges(count);
        verifier.tokens.length = 0;

        const response = await compact(cookie);

        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(await response.json()).toEqual({ status: "noop", reason: "nothing_to_compact" });
        expect(verifier.tokens).toEqual([]);
        expect(dispatcher.compactions).toEqual([]);
        const usage = (await (await request(USAGE, { headers: { cookie } })).json()) as {
          utcDay: { used: number };
        };
        expect(usage.utcDay.used).toBe(count);
      }
    });

    it("starts a compaction that is no message, that another tab sees, and that blocks asking", async () => {
      const { cookie } = await withExchanges(3);
      const before = await conversationOf(cookie);
      const requestId = randomUUID();

      const started = await compact(cookie, requestId);

      expect(started.status).toBe(202);
      const body = (await started.json()) as {
        status: string;
        operation: { operationId: string };
      };
      expect(body).toMatchObject({
        status: "started",
        operation: {
          requestId,
          kind: "compaction",
          status: "accepted",
          assistantMessageId: null,
          compaction: null,
        },
      });
      const dispatch = lastCompaction();
      expect(dispatch).toMatchObject({
        operationId: body.operation.operationId,
        summary: null,
        contextRevision: 3,
        model: "fictional-model",
        effort: "medium",
      });
      expect(dispatch.exchanges.map((exchange) => exchange.question)).toEqual([
        "Question 0?",
        "Question 1?",
        "Question 2?",
      ]);
      expect(dispatcher.dispatched).toHaveLength(3);
      // The other tab: the same conversation, unchanged, with the compaction active.
      const seen = await conversationOf(cookie);
      expect(seen.messages).toEqual(before.messages);
      expect(seen.activeOperation).toMatchObject({ operationId: body.operation.operationId });
      expect(
        await (
          await request(operationPath(body.operation.operationId), { headers: { cookie } })
        ).json(),
      ).toMatchObject({ kind: "compaction", status: "accepted" });

      const again = await compact(cookie, requestId);
      expect(again.status).toBe(200);
      expect(await again.json()).toEqual(body);
      const asking = await ask(cookie, "Meanwhile?");
      expect(asking.status).toBe(409);
      expect(await asking.json()).toEqual({ error: { code: "chat_busy", message: anyText } });
      const second = await compact(cookie);
      expect(second.status).toBe(409);
      expect(await second.json()).toEqual({ error: { code: "chat_busy", message: anyText } });
      expect(dispatcher.compactions).toHaveLength(1);
    });

    it("installs a reported summary: later questions carry it with only the newer exchanges", async () => {
      const { cookie } = await withExchanges(3);
      const before = await conversationOf(cookie);
      await compact(cookie);
      const dispatch = lastCompaction();

      const claimed = await control(CLAIM, {
        operationId: dispatch.operationId,
        grant: dispatch.grant,
      });
      expect(claimed.status).toBe(200);
      expect(await claimed.json()).toMatchObject({ claimed: true, kind: "compaction" });
      const asAnswer = await control(resultPath(dispatch.operationId), answerFor(dispatch.grant));
      expect(asAnswer.status).toBe(403);
      const reported = await control(
        compactionPath(dispatch.operationId),
        compactedFor(dispatch.grant),
      );
      expect(reported.status).toBe(200);
      const operation: unknown = await reported.json();
      expect(operation).toMatchObject({
        kind: "compaction",
        status: "completed",
        compaction: { outcome: "compacted", reason: null },
      });
      const repeat = await control(
        compactionPath(dispatch.operationId),
        compactedFor(dispatch.grant, 0),
      );
      expect(repeat.status).toBe(200);
      expect(await repeat.json()).toEqual(operation);

      // The visible history is unchanged; the working context is the summary and the kept exchange.
      expect((await conversationOf(cookie)).messages).toEqual(before.messages);
      const usage = (await (await request(USAGE, { headers: { cookie } })).json()) as Record<
        string,
        unknown
      >;
      expect(usage).toMatchObject({
        utcDay: { used: 4 },
        nextRequest: {
          status: "estimated",
          historyTokens: 900,
          operationId: dispatch.operationId,
          measuredAt: clock.toISOString(),
        },
      });
      expect(JSON.stringify(usage)).not.toContain("fictional service for a small team");
      expect((await ask(cookie, "And the price?")).status).toBe(202);
      expect(lastDispatch()).toMatchObject({ summary, contextRevision: 4 });
      expect(lastDispatch().history.map((exchange) => exchange.question)).toEqual(["Question 2?"]);
    });

    it("keeps the context after a failed or stopped compaction, and tells the AI service to stop", async () => {
      const { cookie } = await withExchanges(3);
      await compact(cookie);
      const failed = lastCompaction();
      await control(CLAIM, { operationId: failed.operationId, grant: failed.grant });
      const invalid = await control(compactionPath(failed.operationId), {
        ...compactedFor(failed.grant),
        summary: "not a summary",
      });
      expect(invalid.status).toBe(200);
      expect(await invalid.json()).toMatchObject({
        status: "failed",
        compaction: { outcome: "failed", reason: "invalid_result" },
      });

      await compact(cookie);
      const stopped = lastCompaction();
      await control(CLAIM, { operationId: stopped.operationId, grant: stopped.grant });
      const stop = await request(stopPath(stopped.operationId), {
        method: "POST",
        headers: { cookie, origin: ORIGIN },
      });
      expect(stop.status).toBe(200);
      expect(await stop.json()).toMatchObject({ kind: "compaction", status: "cancelled" });
      expect(dispatcher.cancelled).toEqual([stopped.operationId]);
      const late = await control(compactionPath(stopped.operationId), compactedFor(stopped.grant));
      expect(late.status).toBe(200);
      expect(await late.json()).toMatchObject({ status: "cancelled", compaction: null });

      expect((await ask(cookie, "Where were we?")).status).toBe(202);
      expect(lastDispatch()).toMatchObject({ summary: null, contextRevision: 3 });
      expect(lastDispatch().history).toHaveLength(3);
    });

    it("cancels an active compaction when the conversation is cleared", async () => {
      const { cookie, conversationId } = await withExchanges(3);
      await compact(cookie);
      const dispatch = lastCompaction();
      await control(CLAIM, { operationId: dispatch.operationId, grant: dispatch.grant });

      const cleared = await request(CONVERSATION, {
        method: "DELETE",
        ...json({ conversationId }, { cookie, origin: ORIGIN }),
      });

      expect(cleared.status).toBe(200);
      expect(dispatcher.cancelled).toEqual([dispatch.operationId]);
      const late = await control(
        compactionPath(dispatch.operationId),
        compactedFor(dispatch.grant),
      );
      expect(late.status).toBe(409);
    });

    it("refuses as a question is refused, before any state change", async () => {
      const { cookie } = await withExchanges(3);
      const body = JSON.stringify({ requestId: randomUUID(), challengeToken: "fictional-token" });
      for (const headers of [
        { cookie, "content-type": "application/json" },
        { cookie, "content-type": "application/json", origin: "https://evil.example.test" },
        { cookie, "content-type": "text/plain", origin: ORIGIN },
      ]) {
        const response = await request(COMPACT, { method: "POST", headers, body });
        expect(response.status, JSON.stringify(headers)).toBe(403);
        expect(await response.json()).toEqual({ error: { code: "forbidden", message: anyText } });
      }
      const malformed = await request(COMPACT, {
        method: "POST",
        ...json({ requestId: "not-a-uuid", challengeToken: "" }, { cookie, origin: ORIGIN }),
      });
      expect(malformed.status).toBe(400);
      expect(dispatcher.compactions).toEqual([]);

      verifier.answer = false;
      const challenged = await compact(cookie);
      expect(challenged.status).toBe(403);
      expect(await challenged.json()).toEqual({
        error: { code: "chat_challenge_failed", message: anyText },
      });
      verifier.answer = true;

      const questionRequest = randomUUID();
      expect((await ask(cookie, "Asked once?", questionRequest)).status).toBe(202);
      await settleLast();
      const reused = await compact(cookie, questionRequest);
      expect(reused.status).toBe(409);
      expect(await reused.json()).toEqual({
        error: { code: "chat_request_conflict", message: anyText },
      });
      expect(dispatcher.compactions).toEqual([]);
    });

    it("accepts a compaction report only with the control token and a claimed grant", async () => {
      const { cookie } = await withExchanges(3);
      await compact(cookie);
      const dispatch = lastCompaction();
      const path = compactionPath(dispatch.operationId);

      for (const token of [contentKey, AI_TOKEN, RELAY_TOKEN]) {
        expect((await control(path, compactedFor(dispatch.grant), token)).status).toBe(401);
      }
      const unclaimed = await control(path, compactedFor(dispatch.grant));
      expect(unclaimed.status).toBe(409);
      expect(await unclaimed.json()).toEqual({ error: { code: "conflict", message: anyText } });
      await control(CLAIM, { operationId: dispatch.operationId, grant: dispatch.grant });
      const wrong = await control(path, compactedFor("fictional-wrong-grant"));
      expect(wrong.status).toBe(403);
      const noGrant = await control(path, { outcome: "compacted" });
      expect(noGrant.status).toBe(400);
      expect(await noGrant.json()).toMatchObject({ error: { code: "validation_failed" } });
      // An answer's operation takes no compaction report.
      await withExchanges(1);
      const answer = lastDispatch();
      expect(
        (await control(compactionPath(answer.operationId), compactedFor(answer.grant))).status,
      ).toBe(403);
    });
  });

  describe("the usage snapshot", () => {
    const usage = (cookie?: string, address = "203.0.113.40") =>
      request(USAGE, {
        headers: { ...(cookie === undefined ? {} : { cookie }), [CLIENT_HEADER]: address },
      });

    it("shows a new visitor's empty meters, the effective model and no measured context", async () => {
      const response = await usage();

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      cookieOf(response);
      expect(await response.json()).toEqual({
        serverTime: clock.toISOString(),
        model: { name: "fictional-model", effort: "medium" },
        rollingTwoHours: { used: 0, limit: 10, percent: 0, nextReleaseAt: null },
        utcDay: {
          used: 0,
          limit: 30,
          percent: 0,
          resetsAt: new Date(Date.UTC(2031, 2, day + 1)).toISOString(),
        },
        activeOperation: null,
        restriction: null,
        context: { status: "unavailable" },
        nextRequest: { status: "unavailable" },
      });
    });

    it("counts only the caller's own operations, and two tabs see the same snapshot", async () => {
      const owner = await visitor();
      const asked = (await (await ask(owner.cookie)).json()) as { operationId: string };
      const other = await visitor();

      const [first, second] = await Promise.all([usage(owner.cookie), usage(owner.cookie)]);
      const one = (await first.json()) as Record<string, unknown>;
      expect(await second.json()).toEqual(one);
      expect(one).toMatchObject({
        rollingTwoHours: { used: 1, limit: 10, percent: 10 },
        utcDay: { used: 1, limit: 30 },
        activeOperation: { operationId: asked.operationId, status: "accepted" },
      });
      expect(first.headers.get("set-cookie")).toBeNull();

      const theirs = (await (await usage(other.cookie)).json()) as Record<string, unknown>;
      expect(theirs).toMatchObject({
        rollingTwoHours: { used: 0 },
        utcDay: { used: 0 },
        activeOperation: null,
      });
      // Reading the snapshot is not an operation.
      expect(await (await usage(owner.cookie)).json()).toMatchObject({
        rollingTwoHours: { used: 1 },
      });
      expect(dispatcher.dispatched).toHaveLength(1);
    });

    it("names the minute restriction and its retry time, without any spend amount", async () => {
      const { cookie } = await visitor();
      for (let asked = 0; asked < 5; asked += 1) {
        expect((await ask(cookie)).status).toBe(202);
        await settleLast();
      }

      const response = await usage(cookie);
      const text = await response.text();
      expect(JSON.parse(text)).toMatchObject({
        rollingTwoHours: { used: 5, percent: 50 },
        restriction: {
          reason: "minute",
          retryAt: new Date(clock.getTime() + 60_000).toISOString(),
        },
      });
      expect(text).not.toMatch(/usd|spend|budget|micro/i);
    });
  });

  describe("without chat settings", () => {
    it("answers unavailable on every visitor route, and refuses the control routes", async () => {
      const off = backend.api();
      for (const [path, init] of [
        [CONVERSATION, {}],
        [MESSAGES, { method: "POST", ...json({}, { origin: ORIGIN }) }],
        [COMPACT, { method: "POST", ...json({}, { origin: ORIGIN }) }],
        [operationPath(randomUUID()), {}],
        [eventsPath(randomUUID()), {}],
        [USAGE, {}],
      ] as const) {
        const response = await off.app.request(path, init, connection());
        expect(response.status, path).toBe(503);
        expect(await response.json()).toEqual({ error: { code: "unavailable", message: anyText } });
      }
      const claim = await off.app.request(
        CLAIM,
        { method: "POST", ...json({}, bearer(CONTROL_TOKEN)) },
        connection(),
      );
      expect(claim.status).toBe(401);
      const report = await off.app.request(
        compactionPath(randomUUID()),
        { method: "POST", ...json({}, bearer(CONTROL_TOKEN)) },
        connection(),
      );
      expect(report.status).toBe(401);
    });
  });
});

describe("the chat budget over HTTP", () => {
  const smallPolicy: ChatPolicy = {
    ...chatPolicy,
    allowanceMicroUsd: 20_000,
    dailySpendLimitMicroUsd: 20_000,
    monthlySpendLimitMicroUsd: 20_000,
    deadlineMs: 60_000,
  };
  let backend: TestBackend;

  beforeAll(async () => {
    backend = await openTestBackend({
      chat: { config: chatSettings, verifier: fakeVerifier(), policy: smallPolicy },
    });
  });

  afterAll(async () => {
    await backend.close();
  });

  it("answers 503 chat_budget_exhausted once the day's spend is reserved", async () => {
    const dispatcher = capturingDispatcher();
    const { app } = backend.api({
      config: testConfig({ chat: chatHttp }),
      chatDispatcher: dispatcher,
    });
    const opened = await app.request(CONVERSATION, { headers: relayed }, connection());
    const cookie = `${chatCookieName}=${cookieOf(opened)}`;
    const ask = () =>
      app.request(
        MESSAGES,
        {
          method: "POST",
          ...json(
            {
              requestId: randomUUID(),
              question: "Budget?",
              challengeToken: `fictional-token-${randomUUID()}`,
            },
            { cookie, origin: ORIGIN, ...relayed },
          ),
        },
        connection(),
      );

    expect((await ask()).status).toBe(202);
    const dispatch = dispatcher.dispatched[0];
    if (dispatch === undefined) throw new Error("Nothing was dispatched.");
    await backend.services.chat.claim({ operationId: dispatch.operationId, grant: dispatch.grant });
    await backend.services.chat.reconcile(dispatch.operationId, answerFor(dispatch.grant));

    const refused = await ask();
    expect(refused.status).toBe(503);
    expect(await refused.json()).toEqual({
      error: { code: "chat_budget_exhausted", message: anyText },
    });
    expect(dispatcher.dispatched).toHaveLength(1);
  });
});

describe("the chat supervisor", () => {
  const dispatch: ChatDispatch = {
    operationId: randomUUID(),
    grant: "fictional-grant-value",
    question: "What do you build?",
    summary: null,
    history: [],
    today: "2031-03-10",
    deadlineAt: "2031-03-10T12:01:00.000Z",
    contextRevision: 0,
    model: "fictional-model",
    effort: "medium",
    pricingVersion: "fictional-pricing-1",
    allowanceUsd: 0.02,
  };

  function fakeChat() {
    const chat = {
      refused: [] as string[],
      overdue: [] as number[],
      dispatchRefused: (operationId: string) => {
        chat.refused.push(operationId);
        return Promise.resolve(true);
      },
      interruptOverdue: (graceMs: number) => {
        chat.overdue.push(graceMs);
        return Promise.resolve([]);
      },
    };
    return chat;
  }

  function fakeFetch(answer: () => Promise<Response>) {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fetch = (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: input instanceof Request ? input.url : input.toString(), init });
      return answer();
    };
    return { calls, fetch };
  }

  it("posts the dispatch to the AI service with its token, and leaves an accepted one alone", async () => {
    const chat = fakeChat();
    const lines: string[] = [];
    const fake = fakeFetch(() =>
      Promise.resolve(Response.json({ accepted: true }, { status: 202 })),
    );
    const supervisor = createChatSupervisor({
      chat,
      aiService: { url: AI_SERVICE, token: AI_TOKEN },
      log: (line) => lines.push(line),
      fetch: fake.fetch,
    });

    supervisor.dispatch(dispatch);
    await supervisor.close();

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.url).toBe(`${AI_SERVICE}/internal/v1/generations`);
    expect(fake.calls[0]?.init?.method).toBe("POST");
    const headers = new Headers(fake.calls[0]?.init?.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${AI_TOKEN}`);
    expect(headers.get("content-type")).toBe("application/json");
    const body = fake.calls[0]?.init?.body;
    expect(typeof body).toBe("string");
    expect(JSON.parse(typeof body === "string" ? body : "null")).toEqual(dispatch);
    expect(chat.refused).toEqual([]);
    expect(lines.join("\n")).not.toContain(dispatch.grant);
  });

  it("posts a compaction to the AI service's compaction route, and fails one it refuses", async () => {
    const compaction: ChatCompactionDispatch = {
      operationId: randomUUID(),
      grant: "fictional-compaction-grant",
      summary,
      exchanges: [
        {
          question: "What do you build?",
          answer: "Fictional services.",
          language: "en",
          sources: [{ kind: "service", recordId: "svc-1", title: "Fictional service" }],
        },
      ],
      deadlineAt: "2031-03-10T12:01:00.000Z",
      contextRevision: 3,
      model: "fictional-model",
      effort: "medium",
      pricingVersion: "fictional-pricing-1",
      allowanceUsd: 0.02,
    };
    for (const [status, refused] of [
      [202, []],
      [503, [compaction.operationId]],
    ] as const) {
      const chat = fakeChat();
      const lines: string[] = [];
      const fake = fakeFetch(() => Promise.resolve(Response.json({}, { status })));
      const supervisor = createChatSupervisor({
        chat,
        aiService: { url: AI_SERVICE, token: AI_TOKEN },
        log: (line) => lines.push(line),
        fetch: fake.fetch,
      });

      supervisor.dispatch(compaction);
      await supervisor.close();

      expect(fake.calls).toHaveLength(1);
      expect(fake.calls[0]?.url).toBe(`${AI_SERVICE}/internal/v1/compactions`);
      expect(new Headers(fake.calls[0]?.init?.headers).get("authorization")).toBe(
        `Bearer ${AI_TOKEN}`,
      );
      const body = fake.calls[0]?.init?.body;
      expect(JSON.parse(typeof body === "string" ? body : "null")).toEqual(compaction);
      expect(chat.refused).toEqual(refused);
      const logged = lines.join("\n");
      expect(logged).not.toContain(compaction.grant);
      expect(logged).not.toContain("Fictional services.");
    }
  });

  it("fails an operation the AI service refuses or cannot be reached for, without logging secrets", async () => {
    for (const answer of [
      () => Promise.resolve(Response.json({ code: "busy" }, { status: 503 })),
      () => Promise.resolve(new Response(null, { status: 401 })),
      () => Promise.reject(new TypeError("fetch failed")),
    ]) {
      const chat = fakeChat();
      const lines: string[] = [];
      const supervisor = createChatSupervisor({
        chat,
        aiService: { url: AI_SERVICE, token: AI_TOKEN },
        log: (line) => lines.push(line),
        fetch: fakeFetch(answer).fetch,
      });

      supervisor.dispatch(dispatch);
      await supervisor.close();

      expect(chat.refused).toEqual([dispatch.operationId]);
      const logged = lines.join("\n");
      expect(logged).toContain(dispatch.operationId);
      expect(logged).not.toContain(dispatch.grant);
      expect(logged).not.toContain(AI_TOKEN);
      expect(logged).not.toContain(dispatch.question);
    }
  });

  it("tells the AI service to stop a generation, and only logs a failure without secrets", async () => {
    const operationId = randomUUID();
    for (const answer of [
      () => Promise.resolve(Response.json({ cancelled: true }, { status: 202 })),
      () => Promise.resolve(new Response(null, { status: 404 })),
      () => Promise.reject(new TypeError("fetch failed")),
    ]) {
      const chat = fakeChat();
      const lines: string[] = [];
      const fake = fakeFetch(answer);
      const supervisor = createChatSupervisor({
        chat,
        aiService: { url: AI_SERVICE, token: AI_TOKEN },
        log: (line) => lines.push(line),
        fetch: fake.fetch,
      });

      supervisor.cancel(operationId);
      await supervisor.close();

      expect(fake.calls).toHaveLength(1);
      expect(fake.calls[0]?.url).toBe(
        `${AI_SERVICE}/internal/v1/generations/${operationId}/cancel`,
      );
      expect(fake.calls[0]?.init?.method).toBe("POST");
      expect(new Headers(fake.calls[0]?.init?.headers).get("authorization")).toBe(
        `Bearer ${AI_TOKEN}`,
      );
      expect(chat.refused).toEqual([]);
      expect(lines.join("\n")).not.toContain(AI_TOKEN);
    }
  });

  it("recovers stale operations from their durable deadlines at once on start, never redispatching", async () => {
    const chat = fakeChat();
    const fake = fakeFetch(() => Promise.resolve(new Response(null, { status: 202 })));
    const supervisor = createChatSupervisor({
      chat,
      aiService: { url: AI_SERVICE, token: AI_TOKEN },
      log: () => undefined,
      graceMs: 2_500,
      watchIntervalMs: 60_000,
      fetch: fake.fetch,
    });

    supervisor.start();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await supervisor.close();

    expect(chat.overdue).toEqual([2_500]);
    expect(fake.calls).toEqual([]);
  });

  it("interrupts overdue operations on its watch until it is closed", async () => {
    const chat = fakeChat();
    const supervisor = createChatSupervisor({
      chat,
      aiService: { url: AI_SERVICE, token: AI_TOKEN },
      log: () => undefined,
      graceMs: 2_500,
      watchIntervalMs: 5,
    });

    supervisor.start();
    await new Promise((resolve) => setTimeout(resolve, 40));
    await supervisor.close();
    const watched = chat.overdue.length;

    expect(watched).toBeGreaterThan(0);
    expect(new Set(chat.overdue)).toEqual(new Set([2_500]));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(chat.overdue).toHaveLength(watched);
  });

  it("works with the real chat service: a refused dispatch leaves the operation failed", async () => {
    const backend = await openTestBackend({
      chat: { config: chatSettings, verifier: fakeVerifier() },
    });
    try {
      const supervisor = createChatSupervisor({
        chat: backend.services.chat,
        aiService: { url: AI_SERVICE, token: AI_TOKEN },
        log: () => undefined,
        fetch: fakeFetch(() => Promise.resolve(new Response(null, { status: 503 }))).fetch,
      });
      const { app } = backend.api({
        config: testConfig({ chat: chatHttp }),
        chatDispatcher: supervisor,
      });
      const opened = await app.request(CONVERSATION, { headers: relayed }, connection());
      const cookie = `${chatCookieName}=${cookieOf(opened)}`;
      const asked = await app.request(
        MESSAGES,
        {
          method: "POST",
          ...json(
            { requestId: randomUUID(), question: "Hello?", challengeToken: "fictional-token" },
            { cookie, origin: ORIGIN, ...relayed },
          ),
        },
        connection(),
      );
      expect(asked.status).toBe(202);
      const { operationId } = (await asked.json()) as { operationId: string };
      await supervisor.close();

      const operation = await app.request(
        operationPath(operationId),
        { headers: { cookie, ...relayed } },
        connection(),
      );
      expect(await operation.json()).toMatchObject({ status: "failed" });
    } finally {
      await backend.close();
    }
  });
});
