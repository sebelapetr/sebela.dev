import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createPersistence, readDatabaseConfig, type Persistence } from "@sebela/db";
import { createTemporaryDatabase, type TemporaryDatabase } from "@sebela/db/testing";

import {
  createChatService,
  createLangfuseTraceDeleter,
  readTelemetryDeletionOptions,
  type ChallengeVerifier,
  type ChatCaller,
  type ChatDispatch,
  type ChatService,
  type ChatTraceDeleter,
  type ChatTraceDeletionResult,
} from "./index.js";

// Fictional values only.
const config = {
  fingerprintKey: "fictional-fingerprint-key-of-at-least-32-chars",
  retentionDays: 730,
  model: "fictional-model",
  effort: "medium",
  pricingVersion: "fictional-pricing-1",
};

const verifier: ChallengeVerifier = { verify: () => Promise.resolve(true) };

const minute = 60 * 1000;
const day = 24 * 60 * minute;
const start = new Date("2031-03-10T12:00:00.000Z");

const newTraceId = () => randomBytes(16).toString("hex");

/** A deleter that answers as scripted (then `accepted`) and records every request. */
function fakeDeleter(
  script: (ChatTraceDeletionResult | Error)[] = [],
): ChatTraceDeleter & { requests: string[][] } {
  const requests: string[][] = [];
  return {
    requests,
    deleteTraces(traceIds) {
      requests.push([...traceIds]);
      const next = script.shift() ?? { status: "accepted" };
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
  };
}

describe("visitor chat telemetry", () => {
  let database: TemporaryDatabase;
  let persistence: Persistence;
  let chat: ChatService;
  let now: Date;
  let address = 0;

  beforeAll(async () => {
    database = await createTemporaryDatabase(readDatabaseConfig(process.env));
    persistence = createPersistence(database.config);
  });

  afterAll(async () => {
    await persistence.close();
    await database.drop();
  });

  beforeEach(async () => {
    // Every test starts with nothing owed: far in the future everything has expired and is due.
    const future = new Date(start.getTime() + 1000 * day);
    const drain = createChatService(persistence.chat, { config, verifier, now: () => future });
    await drain.deleteTelemetry({ deleter: fakeDeleter(), batchSize: 1000, maxRequests: 1000 });
    now = new Date(start);
    chat = createChatService(persistence.chat, { config, verifier, now: () => now });
  });

  const at = (offsetMs: number) => {
    now = new Date(start.getTime() + offsetMs);
  };

  const claimed = async (): Promise<{ caller: ChatCaller; dispatch: ChatDispatch }> => {
    const { caller } = await chat.open(null);
    address += 1;
    const result = await chat.submit(
      caller,
      {
        requestId: randomUUID(),
        question: "What do you build?",
        challengeToken: `fictional-token-${randomUUID()}`,
      },
      { clientAddress: `198.51.100.${String((address % 250) + 1)}` },
    );
    if (result.status !== "admitted") throw new Error(`Expected admission, got ${result.status}.`);
    const claim = await chat.claim({
      operationId: result.dispatch.operationId,
      grant: result.dispatch.grant,
    });
    expect(claim.status).toBe("claimed");
    return { caller, dispatch: result.dispatch };
  };

  const register = (dispatch: ChatDispatch, traceId: string) =>
    chat.registerTelemetry(dispatch.operationId, { grant: dispatch.grant, traceId });

  /** A trace owed a remote deletion: refused for an operation the API does not know. */
  const owed = async (traceId = newTraceId()) => {
    const outcome = await chat.registerTelemetry(randomUUID(), {
      grant: "fictional-grant",
      traceId,
    });
    expect(outcome).toMatchObject({ status: "registered", registered: { export: "refused" } });
    return traceId;
  };

  const run = (deleter: ChatTraceDeleter | null, batchSize = 1000, maxRequests = 10) =>
    chat.deleteTelemetry({ deleter, batchSize, maxRequests });

  describe("registration", () => {
    it("allows a claimed operation's trace and answers alike when repeated", async () => {
      const { dispatch } = await claimed();
      const traceId = newTraceId();

      const first = await register(dispatch, traceId);
      at(5 * minute);
      const again = await register(dispatch, traceId);

      const expected = {
        status: "registered",
        registered: {
          traceId,
          export: "allowed",
          expiresAt: new Date(start.getTime() + 30 * day).toISOString(),
        },
      };
      expect(first).toEqual(expected);
      expect(again).toEqual(expected);
    });

    it("refuses a wrong grant, an unclaimed operation and a trace of another operation", async () => {
      const { dispatch } = await claimed();
      const traceId = newTraceId();
      await register(dispatch, traceId);

      expect(
        await chat.registerTelemetry(dispatch.operationId, {
          grant: "not-the-grant",
          traceId: newTraceId(),
        }),
      ).toEqual({ status: "wrong_grant" });
      expect(
        await chat.registerTelemetry("not-a-uuid", { grant: dispatch.grant, traceId }),
      ).toEqual({ status: "wrong_grant" });

      const other = await claimed();
      expect(await register(other.dispatch, traceId)).toEqual({ status: "trace_conflict" });

      const { caller } = await chat.open(null);
      const unclaimed = await chat.submit(
        caller,
        {
          requestId: randomUUID(),
          question: "What do you build?",
          challengeToken: `fictional-token-${randomUUID()}`,
        },
        { clientAddress: "203.0.113.7" },
      );
      if (unclaimed.status !== "admitted") throw new Error("Expected admission.");
      expect(await register(unclaimed.dispatch, newTraceId())).toEqual({ status: "not_claimed" });
    });

    it("refuses a late registration after a clear and deletes it only after the horizon", async () => {
      const { caller, dispatch } = await claimed();
      const exported = newTraceId();
      await register(dispatch, exported);

      at(minute);
      const cleared = await chat.clear(caller, { conversationId: caller.conversationId });
      expect(cleared.cleared.telemetryDeletion).toBe("pending");

      at(2 * minute);
      const late = newTraceId();
      expect(await register(dispatch, late)).toEqual({
        status: "registered",
        registered: {
          traceId: late,
          export: "refused",
          expiresAt: new Date(start.getTime() + 12 * minute).toISOString(),
        },
      });

      // The exported trace may still be exported until 10 minutes after its registration.
      at(9 * minute);
      const early = fakeDeleter();
      expect(await run(early)).toMatchObject({ sent: 0, pending: 2 });
      expect(early.requests).toEqual([]);

      at(10 * minute);
      const due = fakeDeleter();
      expect(await run(due)).toMatchObject({ sent: 1, completed: 1, pending: 1 });
      expect(due.requests).toEqual([[exported]]);

      at(12 * minute);
      const last = fakeDeleter();
      expect(await run(last)).toMatchObject({ sent: 1, completed: 1, pending: 0 });
      expect(last.requests).toEqual([[late]]);

      // Once deleted, the trace is never registered again, so it cannot be exported again.
      expect(await register(dispatch, late)).toMatchObject({
        registered: { export: "refused" },
      });
      expect(await run(fakeDeleter())).toMatchObject({ sent: 0, pending: 0 });
    });
  });

  describe("deletion", () => {
    it("deletes a trace 30 days after its registration", async () => {
      const { dispatch } = await claimed();
      const traceId = newTraceId();
      await register(dispatch, traceId);

      at(30 * day - 1);
      const before = fakeDeleter();
      expect(await run(before)).toEqual({
        configured: true,
        swept: 0,
        requests: 0,
        sent: 0,
        completed: 0,
        failed: 0,
        pending: 0,
        rateLimited: false,
      });

      at(30 * day);
      const deleter = fakeDeleter();
      expect(await run(deleter)).toEqual({
        configured: true,
        swept: 1,
        requests: 1,
        sent: 1,
        completed: 1,
        failed: 0,
        pending: 0,
        rateLimited: false,
      });
      expect(deleter.requests).toEqual([[traceId]]);
      // Expired, it is no longer exported.
      expect(await register(dispatch, traceId)).toMatchObject({
        registered: { export: "refused" },
      });
    });

    it("works through a backlog oldest first in bounded requests", async () => {
      const traces: string[] = [];
      for (let index = 0; index < 5; index += 1) {
        at(index * minute);
        traces.push(await owed());
      }

      at(day);
      const deleter = fakeDeleter();
      expect(await run(deleter, 2, 2)).toMatchObject({
        requests: 2,
        sent: 4,
        completed: 4,
        pending: 1,
        rateLimited: false,
      });
      expect(deleter.requests).toEqual([traces.slice(0, 2), traces.slice(2, 4)]);

      const rest = fakeDeleter();
      expect(await run(rest, 2, 2)).toMatchObject({ requests: 1, sent: 1, pending: 0 });
      expect(rest.requests).toEqual([traces.slice(4)]);
    });

    it("backs a failed request off and continues with the next one", async () => {
      at(0);
      const first = await owed();
      at(minute);
      const second = await owed();

      at(day);
      const deleter = fakeDeleter([{ status: "failed" }]);
      expect(await run(deleter, 1, 10)).toMatchObject({
        requests: 2,
        sent: 2,
        completed: 1,
        failed: 1,
        pending: 1,
      });
      expect(deleter.requests).toEqual([[first], [second]]);

      at(day + 15 * minute - 1);
      expect(await run(fakeDeleter())).toMatchObject({ sent: 0, pending: 1 });

      at(day + 15 * minute);
      const retry = fakeDeleter([{ status: "failed" }]);
      expect(await run(retry)).toMatchObject({ sent: 1, failed: 1, pending: 1 });

      // The second failure waits twice as long.
      at(day + 15 * minute + 30 * minute - 1);
      expect(await run(fakeDeleter())).toMatchObject({ sent: 0 });
      at(day + 15 * minute + 30 * minute);
      const third = fakeDeleter();
      expect(await run(third)).toMatchObject({ sent: 1, completed: 1, pending: 0 });
      expect(third.requests).toEqual([[first]]);
    });

    it("counts a transport error as a failure and continues", async () => {
      at(0);
      const first = await owed();
      at(minute);
      const second = await owed();

      at(day);
      const deleter = fakeDeleter([new Error("connection reset")]);
      expect(await run(deleter, 1, 10)).toMatchObject({
        requests: 2,
        completed: 1,
        failed: 1,
        pending: 1,
      });
      expect(deleter.requests).toEqual([[first], [second]]);
    });

    it("stops the run on a rate limit and waits as told", async () => {
      at(0);
      const first = await owed();
      at(minute);
      await owed();

      at(day);
      const deleter = fakeDeleter([{ status: "rate_limited", retryAfterMs: 60 * minute }]);
      expect(await run(deleter, 1, 10)).toMatchObject({
        requests: 1,
        sent: 1,
        completed: 0,
        failed: 1,
        pending: 2,
        rateLimited: true,
      });
      expect(deleter.requests).toEqual([[first]]);

      // The other trace was never sent, so it is due; the limited one waits an hour.
      at(day + minute);
      const next = fakeDeleter();
      expect(await run(next)).toMatchObject({ sent: 1, pending: 1 });
      at(day + 60 * minute - 1);
      expect(await run(fakeDeleter())).toMatchObject({ sent: 0, pending: 1 });
      at(day + 60 * minute);
      const later = fakeDeleter();
      expect(await run(later)).toMatchObject({ sent: 1, pending: 0 });
      expect(later.requests).toEqual([[first]]);
    });

    it("backs a rate limit without a usable Retry-After off like a failure", async () => {
      at(0);
      await owed();

      at(day);
      expect(
        await run(fakeDeleter([{ status: "rate_limited", retryAfterMs: null }])),
      ).toMatchObject({ rateLimited: true, pending: 1 });
      at(day + 15 * minute - 1);
      expect(await run(fakeDeleter())).toMatchObject({ sent: 0 });
      at(day + 15 * minute);
      expect(await run(fakeDeleter())).toMatchObject({ sent: 1, pending: 0 });
    });

    it("still sweeps expiry without remote deletion and reports what is owed", async () => {
      const { dispatch } = await claimed();
      await register(dispatch, newTraceId());
      await owed();

      at(30 * day);
      expect(await run(null)).toEqual({
        configured: false,
        swept: 1,
        requests: 0,
        sent: 0,
        completed: 0,
        failed: 0,
        pending: 2,
        rateLimited: false,
      });
    });
  });
});

describe("readTelemetryDeletionOptions", () => {
  const settings = {
    API_LANGFUSE_BASE_URL: "https://langfuse.example.test",
    API_LANGFUSE_PUBLIC_KEY: "pk-lf-fictional",
    API_LANGFUSE_SECRET_KEY: "sk-lf-fictional",
  };

  it("reads the base address and keys", () => {
    expect(readTelemetryDeletionOptions(settings)).toEqual({
      baseUrl: "https://langfuse.example.test",
      publicKey: "pk-lf-fictional",
      secretKey: "sk-lf-fictional",
    });
  });

  it("is off when any setting is missing or empty", () => {
    expect(readTelemetryDeletionOptions({})).toBeNull();
    for (const name of Object.keys(settings)) {
      expect(readTelemetryDeletionOptions({ ...settings, [name]: " " })).toBeNull();
      expect(readTelemetryDeletionOptions({ ...settings, [name]: undefined })).toBeNull();
    }
  });

  it("refuses an invalid base address without echoing the keys", () => {
    for (const url of ["not a url", "ftp://langfuse.example.test"]) {
      expect(() =>
        readTelemetryDeletionOptions({ ...settings, API_LANGFUSE_BASE_URL: url }),
      ).toThrow(/API_LANGFUSE_BASE_URL/);
      try {
        readTelemetryDeletionOptions({ ...settings, API_LANGFUSE_BASE_URL: url });
      } catch (error) {
        expect(String(error)).not.toContain("sk-lf-fictional");
      }
    }
  });
});

describe("createLangfuseTraceDeleter", () => {
  const traceIds = ["4bf92f3577b34da6a3ce929d0e0e4736", "00f067aa0ba902b7a3ce929d0e0e4736"];
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  let answer: () => Promise<Response>;

  const fakeFetch: typeof fetch = (input, init) => {
    requests.push({
      url: typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      init,
    });
    return answer();
  };

  const deleter = () =>
    createLangfuseTraceDeleter({
      baseUrl: "https://langfuse.example.test/",
      publicKey: "pk-lf-fictional",
      secretKey: "sk-lf-fictional",
      fetch: fakeFetch,
      now: () => new Date("2031-03-10T12:00:00.000Z"),
    });

  beforeEach(() => {
    requests.length = 0;
    answer = () => Promise.resolve(Response.json({ message: "Traces deleted" }));
  });

  it("deletes the traces with one authenticated request", async () => {
    expect(await deleter().deleteTraces(traceIds)).toEqual({ status: "accepted" });

    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request?.url).toBe("https://langfuse.example.test/api/public/traces");
    expect(request?.init?.method).toBe("DELETE");
    const headers = new Headers(request?.init?.headers);
    expect(headers.get("authorization")).toBe(
      `Basic ${Buffer.from("pk-lf-fictional:sk-lf-fictional").toString("base64")}`,
    );
    expect(headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(typeof request?.init?.body === "string" ? request.init.body : "")).toEqual({
      traceIds,
    });
    expect(request?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ["seconds", "120", 120_000],
    ["an HTTP date", "Mon, 10 Mar 2031 12:05:00 GMT", 300_000],
    ["a date already past", "Mon, 10 Mar 2031 11:00:00 GMT", 0],
    ["nothing usable", "soon", null],
  ])("reads a rate limit's Retry-After as %s", async (_name, retryAfter, retryAfterMs) => {
    answer = () =>
      Promise.resolve(new Response("{}", { status: 429, headers: { "retry-after": retryAfter } }));

    expect(await deleter().deleteTraces(traceIds)).toEqual({
      status: "rate_limited",
      retryAfterMs,
    });
  });

  it("reads a rate limit without Retry-After as unknown", async () => {
    answer = () => Promise.resolve(new Response("{}", { status: 429 }));

    expect(await deleter().deleteTraces(traceIds)).toEqual({
      status: "rate_limited",
      retryAfterMs: null,
    });
  });

  it.each([
    ["a server error", () => Promise.resolve(new Response("{}", { status: 500 }))],
    ["an answer without a message", () => Promise.resolve(Response.json({ deleted: true }))],
    ["an answer that is not JSON", () => Promise.resolve(new Response("ok", { status: 200 }))],
    ["a network error", () => Promise.reject(new TypeError("fetch failed"))],
  ])("reports %s as failed", async (_name, failing) => {
    answer = failing;

    expect(await deleter().deleteTraces(traceIds)).toEqual({ status: "failed" });
  });

  it("refuses more than 1000 traces in one request", async () => {
    const many = Array.from({ length: 1001 }, () => newTraceId());

    await expect(deleter().deleteTraces(many)).rejects.toThrow(/1000/);
    expect(requests).toEqual([]);
  });
});
