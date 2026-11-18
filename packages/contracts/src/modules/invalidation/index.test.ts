import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  ContentChangeSchema,
  InvalidationNotificationSchema,
  contentChangeActions,
  contentDomains,
  encodeInvalidationNotification,
  invalidationHeaders,
  invalidationMaxBodyBytes,
  invalidationMaxChanges,
  invalidationSecretMinLength,
  invalidationToleranceSeconds,
  signInvalidationNotification,
  verifyInvalidationNotification,
  type InvalidationNotification,
} from "./index.js";

// Disposable fixture secrets and fictional records only.
const SECRET = "fixture-signing-secret-0123456789abcdef";
const OTHER_SECRET = "another-fixture-secret-0123456789abcdef";
const NOW = Date.parse("2026-05-04T10:00:00.000Z");
const EVENT = "0b9f2c1e-4a77-4c3d-9a51-6f1e2d3c4b5a";
const MEDIA = "6f0c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f";

const notification: InvalidationNotification = {
  eventId: EVENT,
  occurredAt: "2026-05-04T10:00:00.000Z",
  changes: [{ domain: "experience", record: "northwind-lead", action: "updated" }],
};

const encoder = new TextEncoder();

async function signed(body: Uint8Array, at = NOW, secret = SECRET) {
  const headers = await signInvalidationNotification({ secret, body, now: at });
  return { body, ...headers };
}

describe("the content change", () => {
  it("names every profile and roadmap domain and the three actions", () => {
    expect(contentDomains).toEqual([
      "person",
      "technology",
      "topic",
      "organization",
      "experience",
      "project",
      "case-study",
      "testimonial",
      "exploration",
      "service",
      "education",
      "current-focus",
      "roadmap-area",
      "roadmap-module",
      "roadmap-resource",
      "media",
    ]);
    expect(contentChangeActions).toEqual(["created", "updated", "deleted"]);
  });

  it("accepts the person without a record, slugs for records and a UUID for media", () => {
    for (const change of [
      { domain: "person", record: null, action: "updated" },
      { domain: "technology", record: "type-script", action: "created" },
      { domain: "case-study", record: "routing-engine", action: "deleted" },
      { domain: "current-focus", record: "agent-evals", action: "updated" },
      { domain: "roadmap-resource", record: "prompting-notes", action: "deleted" },
      { domain: "media", record: MEDIA, action: "deleted" },
    ]) {
      expect(ContentChangeSchema.parse(change)).toEqual(change);
    }
  });

  it("refuses unknown domains and actions, malformed records and extra fields", () => {
    for (const change of [
      { domain: "page", record: "home", action: "updated" },
      { domain: "experience", record: "northwind-lead", action: "replaced" },
      { domain: "person", record: "alex", action: "updated" },
      { domain: "experience", record: null, action: "updated" },
      { domain: "experience", record: "Northwind Lead", action: "updated" },
      { domain: "experience", record: "../person", action: "updated" },
      { domain: "experience", record: "https://example.test/", action: "updated" },
      { domain: "media", record: "not-a-uuid", action: "updated" },
      { domain: "media", record: "northwind-logo", action: "updated" },
      { domain: "media", record: null, action: "deleted" },
      { domain: "experience", record: "northwind-lead", action: "updated", url: "/experience" },
      { domain: "experience", record: "northwind-lead", action: "updated", cacheKey: "all" },
      { domain: "experience", record: "x".repeat(101), action: "updated" },
    ]) {
      expect(ContentChangeSchema.safeParse(change).success, JSON.stringify(change)).toBe(false);
    }
  });
});

describe("the notification", () => {
  it("carries an event identifier, the commit time and one or more changes", () => {
    expect(InvalidationNotificationSchema.parse(notification)).toEqual(notification);
  });

  it("refuses a missing or malformed event identifier or time, extra fields and bad change lists", () => {
    const change = notification.changes[0];
    for (const candidate of [
      { ...notification, eventId: "event-1" },
      { ...notification, occurredAt: "yesterday" },
      { ...notification, urls: ["/"] },
      { ...notification, changes: [] },
      {
        ...notification,
        changes: Array.from({ length: invalidationMaxChanges + 1 }, () => change),
      },
      { eventId: EVENT, changes: [change] },
    ]) {
      expect(InvalidationNotificationSchema.safeParse(candidate).success).toBe(false);
    }
    expect(invalidationMaxChanges).toBe(16);
  });

  it("encodes a valid notification as UTF-8 JSON within the body limit, and refuses an invalid one", () => {
    const body = encodeInvalidationNotification(notification);

    expect(JSON.parse(new TextDecoder().decode(body))).toEqual(notification);
    expect(body.byteLength).toBeLessThanOrEqual(invalidationMaxBodyBytes);
    expect(() => encodeInvalidationNotification({ ...notification, eventId: "event-1" })).toThrow();
  });

  it("fits the largest valid notification within the body limit", () => {
    const largest: InvalidationNotification = {
      ...notification,
      changes: Array.from({ length: invalidationMaxChanges }, () => ({
        domain: "current-focus" as const,
        record: "a".repeat(100),
        action: "updated" as const,
      })),
    };

    expect(encodeInvalidationNotification(largest).byteLength).toBeLessThanOrEqual(
      invalidationMaxBodyBytes,
    );
  });
});

describe("signing", () => {
  it("signs the timestamp and the exact body bytes with HMAC-SHA256", async () => {
    const body = encodeInvalidationNotification(notification);

    const headers = await signInvalidationNotification({ secret: SECRET, body, now: NOW });

    const seconds = String(NOW / 1000);
    const expected = createHmac("sha256", SECRET).update(`${seconds}.`).update(body).digest("hex");
    expect(headers).toEqual({ timestamp: seconds, signature: `v1=${expected}` });
    expect(invalidationHeaders).toEqual({
      timestamp: "sebela-invalidation-timestamp",
      signature: "sebela-invalidation-signature",
    });
  });

  it("refuses a secret shorter than the minimum", async () => {
    expect(invalidationSecretMinLength).toBe(32);
    const body = encodeInvalidationNotification(notification);

    await expect(signInvalidationNotification({ secret: "short", body, now: NOW })).rejects.toThrow(
      /secret/,
    );
    await expect(
      verifyInvalidationNotification({
        secret: "short",
        body,
        timestamp: "1",
        signature: "v1=00",
        now: NOW,
      }),
    ).rejects.toThrow(/secret/);
  });
});

describe("verifying", () => {
  const verify = (
    request: { body: Uint8Array; timestamp: string | null; signature: string | null },
    options: { now?: number; secret?: string } = {},
  ) =>
    verifyInvalidationNotification({
      secret: options.secret ?? SECRET,
      now: options.now ?? NOW,
      ...request,
    });

  it("accepts a fresh, correctly signed notification and returns it validated", async () => {
    const request = await signed(encodeInvalidationNotification(notification));

    expect(await verify(request)).toEqual({ ok: true, notification });
  });

  it("accepts the edges of the tolerance window in both directions", async () => {
    const request = await signed(encodeInvalidationNotification(notification));
    const tolerance = invalidationToleranceSeconds * 1000;

    expect(invalidationToleranceSeconds).toBe(60);
    expect((await verify(request, { now: NOW + tolerance })).ok).toBe(true);
    expect((await verify(request, { now: NOW - tolerance })).ok).toBe(true);
  });

  it("rejects a missing timestamp or signature", async () => {
    const request = await signed(encodeInvalidationNotification(notification));

    expect(await verify({ ...request, timestamp: null })).toEqual({
      ok: false,
      reason: "missing_signature",
    });
    expect(await verify({ ...request, signature: null })).toEqual({
      ok: false,
      reason: "missing_signature",
    });
    expect(await verify({ ...request, signature: "" })).toEqual({
      ok: false,
      reason: "missing_signature",
    });
  });

  it("rejects a stale, future or malformed timestamp", async () => {
    const request = await signed(encodeInvalidationNotification(notification));
    const beyond = (invalidationToleranceSeconds + 1) * 1000;

    for (const attempt of [
      await verify(request, { now: NOW + beyond }),
      await verify(request, { now: NOW - beyond }),
      await verify({ ...request, timestamp: "soon" }),
      await verify({ ...request, timestamp: `${request.timestamp}.5` }),
      await verify({ ...request, timestamp: `-${request.timestamp}` }),
    ]) {
      expect(attempt).toEqual({ ok: false, reason: "stale" });
    }
  });

  it("rejects a signature from another secret, for another body or for another timestamp", async () => {
    const body = encodeInvalidationNotification(notification);
    const request = await signed(body);
    const foreign = await signed(body, NOW, OTHER_SECRET);
    const altered = Uint8Array.from(body);
    altered[altered.length - 2] = (altered[altered.length - 2] ?? 0) ^ 1;
    const earlier = await signed(body, NOW - 1000);

    for (const attempt of [
      await verify(foreign),
      await verify({ ...request, body: altered }),
      await verify({ ...request, timestamp: earlier.timestamp }),
      await verify(request, { secret: OTHER_SECRET }),
    ]) {
      expect(attempt).toEqual({ ok: false, reason: "invalid_signature" });
    }
  });

  it("rejects signatures in another scheme, length or alphabet", async () => {
    const request = await signed(encodeInvalidationNotification(notification));
    const hex = request.signature.slice(3);

    for (const signature of [
      hex,
      `v0=${hex}`,
      `v1=${hex.slice(2)}`,
      `v1=${hex}00`,
      `v1=${hex.toUpperCase()}`,
      `v1=${"z".repeat(64)}`,
      `v1=${hex},v1=${hex}`,
    ]) {
      expect(await verify({ ...request, signature })).toEqual({
        ok: false,
        reason: "invalid_signature",
      });
    }
  });

  it("rejects an oversized body before checking anything else", async () => {
    const body = encoder.encode(" ".repeat(invalidationMaxBodyBytes + 1));
    const request = await signed(body);

    expect(await verify(request)).toEqual({ ok: false, reason: "payload_too_large" });
    expect(await verify({ ...request, signature: null })).toEqual({
      ok: false,
      reason: "payload_too_large",
    });
  });

  it("rejects correctly signed bodies that are not valid notifications", async () => {
    for (const text of [
      "not json",
      "[]",
      JSON.stringify({ ...notification, changes: [] }),
      JSON.stringify({
        ...notification,
        changes: [{ domain: "experience", record: "../../etc", action: "updated" }],
      }),
      JSON.stringify({ ...notification, paths: ["/"] }),
    ]) {
      expect(await verify(await signed(encoder.encode(text)))).toEqual({
        ok: false,
        reason: "malformed",
      });
    }
  });
});
