import { randomBytes, randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  ChallengeVerifier,
  ChatTraceDeleter,
  ChatTraceDeletionResult,
} from "@sebela/services";

import { openTestBackend, type TestBackend } from "../test-support.js";
import { runChatMaintenanceCommand } from "./chat-maintenance.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const verifier: ChallengeVerifier = { verify: () => Promise.resolve(true) };

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    output: { out: (text: string) => out.push(text), err: (text: string) => err.push(text) },
    out: () => out.join(""),
    err: () => err.join(""),
  };
}

describe("chat-maintenance command", () => {
  let backend: TestBackend;
  let clock: Date;

  beforeEach(async () => {
    clock = new Date("2031-03-10T12:00:00.000Z");
    backend = await openTestBackend({
      chat: {
        config: {
          fingerprintKey: "fictional-fingerprint-key-of-at-least-32-chars",
          retentionDays: 730,
          model: "fictional-model",
          effort: "medium",
          pricingVersion: "fictional-pricing-1",
        },
        verifier,
        now: () => clock,
      },
    });
  });

  afterEach(async () => {
    await backend.close();
  });

  const run = async (args: readonly string[], deleter: ChatTraceDeleter | null = null) => {
    const io = capture();
    const code = await runChatMaintenanceCommand(args, backend.services.chat, io.output, deleter);
    return { code, out: io.out(), err: io.err() };
  };

  /** A deleter that answers as scripted (then `accepted`) and records every request. */
  function fakeDeleter(script: ChatTraceDeletionResult[] = []) {
    const requests: string[][] = [];
    const deleter: ChatTraceDeleter = {
      deleteTraces(traceIds) {
        requests.push([...traceIds]);
        return Promise.resolve(script.shift() ?? { status: "accepted" });
      },
    };
    return { deleter, requests };
  }

  /** `count` traces owed a remote deletion, registered a minute apart from the clock on. */
  async function owed(count: number) {
    const traces: string[] = [];
    const from = clock.getTime();
    for (let index = 0; index < count; index += 1) {
      clock = new Date(from + index * MINUTE_MS);
      const traceId = randomBytes(16).toString("hex");
      const outcome = await backend.services.chat.registerTelemetry(randomUUID(), {
        grant: "fictional-grant",
        traceId,
      });
      expect(outcome).toMatchObject({ registered: { export: "refused" } });
      traces.push(traceId);
    }
    return traces;
  }

  /** Opens `count` conversations and returns their cookies. */
  async function open(count: number) {
    const cookies: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const opened = await backend.services.chat.open(null);
      if (opened.cookie === null) throw new Error("No cookie was issued.");
      cookies.push(opened.cookie);
    }
    return cookies;
  }

  it("keeps the conversations within the retention period", async () => {
    const [cookie = ""] = await open(1);
    clock = new Date(clock.getTime() + 729 * DAY_MS);

    const result = await run(["delete-expired"]);

    expect(result).toMatchObject({ code: 0, err: "" });
    expect(result.out).toMatch(/0 expired conversations deleted/);
    expect((await backend.services.chat.open(cookie)).cookie).toBeNull();
  });

  it("deletes the conversations past the retention period in bounded batches", async () => {
    const cookies = await open(5);
    clock = new Date(clock.getTime() + 731 * DAY_MS);

    const bounded = await run(["delete-expired", "--batch-size", "2", "--max-batches", "2"]);
    expect(bounded.code).toBe(0);
    expect(bounded.out).toMatch(/4 expired conversations deleted/);
    expect(bounded.out).toMatch(/more may remain/);

    const rest = await run(["delete-expired"]);
    expect(rest.out).toMatch(/1 expired conversations deleted/);
    expect(rest.out).not.toMatch(/more may remain/);
    for (const cookie of cookies) {
      expect((await backend.services.chat.open(cookie)).cookie).not.toBeNull();
    }
  });

  for (const args of [
    [],
    ["delete"],
    ["delete-expired", "--batch-size"],
    ["delete-expired", "--batch-size", "0"],
    ["delete-expired", "--batch-size", "10001"],
    ["delete-expired", "--max-batches", "x"],
    ["delete-expired", "--other", "1"],
  ]) {
    it(`prints the usage and deletes nothing for ${JSON.stringify(args)}`, async () => {
      const [cookie = ""] = await open(1);
      clock = new Date(clock.getTime() + 731 * DAY_MS);

      const result = await run(args);

      expect(result.code).toBe(2);
      expect(result.err).toMatch(/Usage: chat-maintenance delete-expired/);
      expect((await backend.services.chat.open(cookie)).cookie).toBeNull();
    });
  }

  describe("delete-telemetry", () => {
    it("deletes the due traces in bounded requests and reports the run", async () => {
      const traces = await owed(5);
      clock = new Date(clock.getTime() + DAY_MS);
      const { deleter, requests } = fakeDeleter();

      const result = await run(
        ["delete-telemetry", "--batch-size", "2", "--max-requests", "2"],
        deleter,
      );

      expect(result).toMatchObject({ code: 0, err: "" });
      expect(result.out).toBe(
        "telemetry deletion: 0 swept, 4 sent in 2 requests, 4 completed, 0 failed, 1 pending\n",
      );
      expect(requests).toEqual([traces.slice(0, 2), traces.slice(2, 4)]);

      const rest = await run(["delete-telemetry"], deleter);
      expect(rest.out).toBe(
        "telemetry deletion: 0 swept, 1 sent in 1 requests, 1 completed, 0 failed, 0 pending\n",
      );
    });

    it("sends nothing before the export horizon has passed", async () => {
      await owed(1);
      clock = new Date(clock.getTime() + 10 * MINUTE_MS - 1);
      const { deleter, requests } = fakeDeleter();

      const result = await run(["delete-telemetry"], deleter);

      expect(result.out).toMatch(/0 sent in 0 requests, 0 completed, 0 failed, 1 pending/);
      expect(requests).toEqual([]);
    });

    it("stops on a rate limit and reports it", async () => {
      const traces = await owed(2);
      clock = new Date(clock.getTime() + DAY_MS);
      const { deleter, requests } = fakeDeleter([
        { status: "rate_limited", retryAfterMs: 3_600_000 },
      ]);

      const result = await run(["delete-telemetry", "--batch-size", "1"], deleter);

      expect(result.code).toBe(0);
      expect(result.out).toBe(
        "telemetry deletion: 0 swept, 1 sent in 1 requests, 0 completed, 1 failed, 2 pending; " +
          "rate limited, stopped\n",
      );
      expect(requests).toEqual([traces.slice(0, 1)]);
    });

    it("still sweeps expiry when remote deletion is not configured", async () => {
      await owed(2);
      clock = new Date(clock.getTime() + DAY_MS);

      const result = await run(["delete-telemetry"], null);

      expect(result).toMatchObject({ code: 0, err: "" });
      expect(result.out).toBe(
        "0 expired telemetry references swept; telemetry deletion not configured; 2 pending\n",
      );
    });

    for (const args of [
      ["delete-telemetry", "--batch-size"],
      ["delete-telemetry", "--batch-size", "0"],
      ["delete-telemetry", "--batch-size", "1001"],
      ["delete-telemetry", "--max-requests", "0"],
      ["delete-telemetry", "--max-requests", "x"],
      ["delete-telemetry", "--max-batches", "1"],
    ]) {
      it(`prints the usage and sends nothing for ${JSON.stringify(args)}`, async () => {
        await owed(1);
        clock = new Date(clock.getTime() + DAY_MS);
        const { deleter, requests } = fakeDeleter();

        const result = await run(args, deleter);

        expect(result.code).toBe(2);
        expect(result.err).toMatch(/chat-maintenance delete-telemetry/);
        expect(requests).toEqual([]);
      });
    }
  });
});
