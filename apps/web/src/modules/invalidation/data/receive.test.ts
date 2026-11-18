import { describe, expect, it } from "vitest";

import {
  encodeInvalidationNotification,
  invalidationHeaders,
  invalidationMaxBodyBytes,
  signInvalidationNotification,
  type InvalidationNotification,
} from "@sebela/contracts";

import type { CacheScope } from "./dependencies";
import { createInvalidationReceiver } from "./receive";

// A disposable fixture secret, used by nothing but these tests.
const SECRET = "fixture-secret-for-tests-only-0123456789";
const OTHER_SECRET = "another-fixture-secret-for-tests-9876543210";
const NOW = Date.UTC(2026, 10, 18, 12, 0, 0);
const ADDRESS = "https://site.example.test/internal/invalidation";

const notification: InvalidationNotification = {
  eventId: "6c2f6f5e-2b0c-4d7a-9b1f-3c9a0e7d4b21",
  occurredAt: "2026-11-18T12:00:00.000Z",
  changes: [
    { domain: "person", record: null, action: "updated" },
    { domain: "experience", record: "fictional-role", action: "deleted" },
  ],
};

/** The receiver with a recorder of what it invalidated. */
function receiver({ secret = (): string => SECRET } = {}) {
  const invalidated: (readonly CacheScope[])[] = [];
  const logged: string[] = [];
  const receive = createInvalidationReceiver({
    secret,
    invalidate: (scopes) => invalidated.push(scopes),
    now: () => NOW,
    log: (line) => logged.push(line),
  });
  return { receive, invalidated, logged };
}

/** A request signed like the API's sender signs it, unless headers are overridden. */
async function signed(
  body: Uint8Array,
  {
    secret = SECRET,
    now = NOW,
    headers = {},
  }: { secret?: string; now?: number; headers?: Record<string, string | null> } = {},
): Promise<Request> {
  const { timestamp, signature } = await signInvalidationNotification({ secret, body, now });
  const all: Record<string, string | null> = {
    "Content-Type": "application/json",
    [invalidationHeaders.timestamp]: timestamp,
    [invalidationHeaders.signature]: signature,
    ...headers,
  };
  const present = Object.entries(all).filter(
    (entry): entry is [string, string] => entry[1] !== null,
  );
  return new Request(ADDRESS, {
    method: "POST",
    headers: Object.fromEntries(present),
    body: new Uint8Array(body),
  });
}

const valid = () => encodeInvalidationNotification(notification);
const text = (value: string) => new TextEncoder().encode(value);

/** A body that is never content-length announced and counts how much of it was read. */
function streamed(size: number, chunk = 1024) {
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= size) {
        controller.close();
        return;
      }
      const length = Math.min(chunk, size - sent);
      sent += length;
      controller.enqueue(new Uint8Array(length).fill(0x20));
    },
  });
  return { stream, sent: () => sent };
}

describe("createInvalidationReceiver", () => {
  it("invalidates the mapped scopes for a correctly signed notification and answers 204", async () => {
    const { receive, invalidated } = receiver();

    const response = await receive(await signed(valid()));

    expect(response.status).toBe(204);
    expect(invalidated).toEqual([["profile"]]);
  });

  it("treats a repeated delivery of the same event as another harmless invalidation", async () => {
    const { receive, invalidated } = receiver();
    const body = valid();

    expect((await receive(await signed(body))).status).toBe(204);
    expect((await receive(await signed(body))).status).toBe(204);
    expect(invalidated).toEqual([["profile"], ["profile"]]);
  });

  it("accepts an older event after a newer one: it only makes the website read current data", async () => {
    const { receive, invalidated } = receiver();
    const newer = encodeInvalidationNotification({
      ...notification,
      eventId: "0d8a5b5c-7f43-4c4b-8a8e-5b2f0f1c9e01",
      occurredAt: "2026-11-18T12:00:30.000Z",
    });

    expect((await receive(await signed(newer))).status).toBe(204);
    expect((await receive(await signed(valid()))).status).toBe(204);
    expect(invalidated).toEqual([["profile"], ["profile"]]);
  });

  it.each([
    ["timestamp", { [invalidationHeaders.timestamp]: null }],
    ["signature", { [invalidationHeaders.signature]: null }],
    [
      "timestamp and signature",
      { [invalidationHeaders.timestamp]: null, [invalidationHeaders.signature]: null },
    ],
  ])("refuses a notification without its %s with 401", async (_label, headers) => {
    const { receive, invalidated } = receiver();

    const response = await receive(await signed(valid(), { headers }));

    expect(response.status).toBe(401);
    expect(invalidated).toEqual([]);
  });

  it.each([
    ["too old", NOW - 61_000],
    ["from the future", NOW + 61_000],
  ])("refuses a signature that is %s with 401", async (_label, now) => {
    const { receive, invalidated } = receiver();

    const response = await receive(await signed(valid(), { now }));

    expect(response.status).toBe(401);
    expect(invalidated).toEqual([]);
  });

  it("refuses a notification signed with another secret with 401", async () => {
    const { receive, invalidated } = receiver();

    const response = await receive(await signed(valid(), { secret: OTHER_SECRET }));

    expect(response.status).toBe(401);
    expect(invalidated).toEqual([]);
  });

  it("refuses a body changed after signing with 401", async () => {
    const { receive, invalidated } = receiver();
    const request = await signed(valid());
    const tampered = new Request(request, {
      body: text(
        JSON.stringify({ ...notification, eventId: "1b9f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d" }),
      ),
    });

    const response = await receive(tampered);

    expect(response.status).toBe(401);
    expect(invalidated).toEqual([]);
  });

  it.each([
    ["not JSON", text("not json")],
    ["no notification", text(JSON.stringify({ hello: "world" }))],
    [
      "an unknown content domain",
      text(
        JSON.stringify({
          ...notification,
          changes: [{ domain: "homepage", record: null, action: "updated" }],
        }),
      ),
    ],
    [
      "a record that is no slug",
      text(
        JSON.stringify({
          ...notification,
          changes: [{ domain: "experience", record: "../../sitemap.xml", action: "updated" }],
        }),
      ),
    ],
    [
      "an address instead of a reference",
      text(JSON.stringify({ ...notification, changes: [], urls: ["https://site.example.test/"] })),
    ],
  ])("refuses a correctly signed body with %s with 400", async (_label, body) => {
    const { receive, invalidated } = receiver();

    const response = await receive(await signed(body));

    expect(response.status).toBe(400);
    expect(invalidated).toEqual([]);
  });

  it("refuses an announced oversized body with 413 before reading it", async () => {
    const { receive, invalidated } = receiver();
    const body = streamed(1_000_000);
    const request = new Request(ADDRESS, {
      method: "POST",
      headers: { "Content-Length": String(invalidationMaxBodyBytes + 1) },
      body: body.stream,
      duplex: "half",
    } as RequestInit);

    const response = await receive(request);

    expect(response.status).toBe(413);
    expect(body.sent()).toBeLessThanOrEqual(1024);
    expect(invalidated).toEqual([]);
  });

  it("stops reading an unannounced body past the limit and refuses it with 413", async () => {
    const { receive, invalidated } = receiver();
    const body = streamed(1_000_000);
    const request = new Request(ADDRESS, {
      method: "POST",
      body: body.stream,
      duplex: "half",
    } as RequestInit);

    const response = await receive(request);

    expect(response.status).toBe(413);
    expect(body.sent()).toBeLessThan(invalidationMaxBodyBytes + 4 * 1024);
    expect(invalidated).toEqual([]);
  });

  it("refuses a signed body one byte over the limit with 413", async () => {
    const { receive, invalidated } = receiver();
    const body = new Uint8Array(invalidationMaxBodyBytes + 1).fill(0x20);

    const response = await receive(await signed(body));

    expect(response.status).toBe(413);
    expect(invalidated).toEqual([]);
  });

  it("answers neither cacheable nor indexable", async () => {
    const { receive } = receiver();

    for (const response of [
      await receive(await signed(valid())),
      await receive(await signed(valid(), { secret: OTHER_SECRET })),
    ]) {
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
    }
  });

  it("answers 500 without invalidating when the secret is not configured", async () => {
    const { receive, invalidated, logged } = receiver({
      secret: () => {
        throw new Error("WEB_INVALIDATION_SECRET is required");
      },
    });

    const response = await receive(await signed(valid()));

    expect(response.status).toBe(500);
    expect(invalidated).toEqual([]);
    expect(logged.join("\n")).toContain("WEB_INVALIDATION_SECRET");
  });

  it("answers 500 without invalidating or logging the value when the secret is too short", async () => {
    const short = "short-fixture-secret";
    const { receive, invalidated, logged } = receiver({ secret: () => short });

    const response = await receive(await signed(valid()));

    expect(response.status).toBe(500);
    expect(invalidated).toEqual([]);
    expect(logged.join("\n")).not.toContain(short);
  });

  it("never writes the secret or the body into a refusal's log line", async () => {
    const { receive, logged } = receiver();

    await receive(await signed(valid(), { secret: OTHER_SECRET }));
    await receive(await signed(text("not json")));

    const all = logged.join("\n");
    expect(all).not.toContain(SECRET);
    expect(all).not.toContain(OTHER_SECRET);
    expect(all).not.toContain("not json");
    expect(all).not.toContain(notification.eventId);
  });
});
