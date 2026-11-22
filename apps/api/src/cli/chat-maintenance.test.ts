import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ChallengeVerifier } from "@sebela/services";

import { openTestBackend, type TestBackend } from "../test-support.js";
import { runChatMaintenanceCommand } from "./chat-maintenance.js";

const DAY_MS = 24 * 60 * 60 * 1000;
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

  const run = async (args: readonly string[]) => {
    const io = capture();
    const code = await runChatMaintenanceCommand(args, backend.services.chat, io.output);
    return { code, out: io.out(), err: io.err() };
  };

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
});
