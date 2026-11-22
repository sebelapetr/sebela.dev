import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { ChatGenerationResult } from "@sebela/contracts";
import { chatPolicy } from "@sebela/services";
import type { ChallengeVerifier, ChatDispatch, ChatPolicy } from "@sebela/services";

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
const CLAIM = "/v1/internal/chat/grants/claim";
const operationPath = (id: string) => `/v1/chat/operations/${id}`;
const eventsPath = (id: string) => `/v1/chat/operations/${id}/events`;
const resultPath = (id: string) => `/v1/internal/chat/operations/${id}/result`;

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

/** A dispatcher that only records what it was handed. */
function capturingDispatcher(): ChatDispatcher & { dispatched: ChatDispatch[] } {
  const dispatcher = {
    dispatched: [] as ChatDispatch[],
    dispatch: (dispatch: ChatDispatch) => {
      dispatcher.dispatched.push(dispatch);
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
        [operationPath(asked.operationId), { headers: { cookie } }],
        [eventsPath(asked.operationId), { headers: { cookie } }],
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
      // The website's own public reads from the same connection keep their budget.
      expect((await on.app.request("/v1/person", {}, connection(WEBSITE))).status).toBe(200);
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
  });

  describe("without chat settings", () => {
    it("answers unavailable on every visitor route, and refuses the control routes", async () => {
      const off = backend.api();
      for (const [path, init] of [
        [CONVERSATION, {}],
        [MESSAGES, { method: "POST", ...json({}, { origin: ORIGIN }) }],
        [operationPath(randomUUID()), {}],
        [eventsPath(randomUUID()), {}],
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
    history: [],
    today: "2031-03-10",
    deadlineAt: "2031-03-10T12:01:00.000Z",
    contextRevision: 0,
    model: "fictional-model",
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
