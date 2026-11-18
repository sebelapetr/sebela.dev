// The website invalidation notification: what the API sends the website after a committed content
// write, and how both sides sign and verify it. It knows no transport beyond two header names and
// no cache: the receiver maps the validated changes to its own dependency map.
import { z } from "zod";

import { SlugParamsSchema } from "../profile/index.js";

/**
 * The records named by slug; a case study is named by its project's slug, and the roadmap's areas,
 * modules and resources by their own slugs.
 */
const sluggedDomains = [
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
] as const;

/** The content domains a write can change, one per kind of profile or roadmap record. */
export const contentDomains = ["person", ...sluggedDomains, "media"] as const;

/** What the write did to the record. */
export const contentChangeActions = ["created", "updated", "deleted"] as const;

/** Most changes in one notification. */
export const invalidationMaxChanges = 16;

/** Largest notification body in bytes; a receiver refuses a larger one before anything else. */
export const invalidationMaxBodyBytes = 4096;

/** How far, in seconds, a signed timestamp may lie before or after the receiver's clock. */
export const invalidationToleranceSeconds = 60;

/** Shortest accepted signing secret, in characters. */
export const invalidationSecretMinLength = 32;

/** The request headers that carry the signature, lower-case. */
export const invalidationHeaders = {
  /** Whole seconds since the epoch when the request was signed. */
  timestamp: "sebela-invalidation-timestamp",
  /** `v1=` and the lower-case hex HMAC-SHA256 of `<timestamp>.<body bytes>`. */
  signature: "sebela-invalidation-signature",
} as const;

const action = z.enum(contentChangeActions);

/**
 * One changed record. The person is the only one of its kind and names no record; media are named
 * by identifier; every other record by its slug (a case study by its project's slug). It names the
 * written record only, not the records it was or is related to.
 */
export const ContentChangeSchema = z
  .union([
    z.strictObject({ domain: z.literal("person"), record: z.null(), action }),
    z.strictObject({ domain: z.literal("media"), record: z.uuid(), action }),
    z.strictObject({
      domain: z.enum(sluggedDomains),
      record: SlugParamsSchema.shape.slug,
      action,
    }),
  ])
  .meta({ id: "ContentChange" });

/**
 * A notification of one committed content write. `eventId` identifies the write, also across
 * retried deliveries; `occurredAt` is when the API saw it committed. It carries no content: a
 * receiver refetches current data, so duplicates and out-of-order deliveries are harmless.
 */
export const InvalidationNotificationSchema = z
  .strictObject({
    eventId: z.uuid(),
    occurredAt: z.iso.datetime(),
    changes: z.array(ContentChangeSchema).min(1).max(invalidationMaxChanges),
  })
  .meta({ id: "InvalidationNotification" });

export type ContentDomain = (typeof contentDomains)[number];
export type ContentChangeAction = (typeof contentChangeActions)[number];
export type ContentChange = z.infer<typeof ContentChangeSchema>;
export type InvalidationNotification = z.infer<typeof InvalidationNotificationSchema>;

/** Why a notification was refused; nothing may be invalidated for any of them. */
export type InvalidationRefusal =
  "payload_too_large" | "missing_signature" | "stale" | "invalid_signature" | "malformed";

export type InvalidationVerification =
  | { readonly ok: true; readonly notification: InvalidationNotification }
  | { readonly ok: false; readonly reason: InvalidationRefusal };

const encoder = new TextEncoder();
const SIGNATURE = /^v1=([0-9a-f]{64})$/;
const TIMESTAMP = /^\d{1,12}$/;

/** Validates the notification and returns its UTF-8 JSON body; throws for an invalid one. */
export function encodeInvalidationNotification(notification: InvalidationNotification): Uint8Array {
  return encoder.encode(JSON.stringify(InvalidationNotificationSchema.parse(notification)));
}

function checkSecret(secret: string): void {
  if (secret.length < invalidationSecretMinLength) {
    throw new Error(
      `The invalidation signing secret must be at least ${String(invalidationSecretMinLength)} characters.`,
    );
  }
}

async function hmac(secret: string, timestamp: string, body: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const prefix = encoder.encode(`${timestamp}.`);
  const message = new Uint8Array(prefix.byteLength + body.byteLength);
  message.set(prefix);
  message.set(body, prefix.byteLength);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, message));
}

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

/** Compares two equally long digests in time independent of where they differ. */
function sameDigest(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

/**
 * The header values that sign `body` exactly as it will be sent, at `now` (milliseconds since the
 * epoch, rounded down to seconds). Throws for a secret shorter than the minimum.
 */
export async function signInvalidationNotification(request: {
  readonly secret: string;
  readonly body: Uint8Array;
  readonly now: number;
}): Promise<{ timestamp: string; signature: string }> {
  checkSecret(request.secret);
  const timestamp = String(Math.floor(request.now / 1000));
  return {
    timestamp,
    signature: `v1=${toHex(await hmac(request.secret, timestamp, request.body))}`,
  };
}

/**
 * Verifies a received notification from its exact body bytes and its two header values (`null`
 * when absent), at `now` (milliseconds since the epoch). In this order it refuses a body larger
 * than `invalidationMaxBodyBytes`, a missing header, a timestamp that is not whole seconds within
 * `invalidationToleranceSeconds` of `now`, a signature that is not one `v1=` lower-case HMAC of
 * this timestamp and body (compared in constant time), and finally a body that is not a valid
 * notification. Only an accepted notification may invalidate anything. Throws for a secret shorter
 * than the minimum: that is a configuration error, not a refusal.
 */
export async function verifyInvalidationNotification(request: {
  readonly secret: string;
  readonly body: Uint8Array;
  readonly timestamp: string | null;
  readonly signature: string | null;
  readonly now: number;
}): Promise<InvalidationVerification> {
  checkSecret(request.secret);
  const { body, timestamp, signature } = request;
  if (body.byteLength > invalidationMaxBodyBytes) return { ok: false, reason: "payload_too_large" };
  if (!timestamp || !signature) return { ok: false, reason: "missing_signature" };
  if (
    !TIMESTAMP.test(timestamp) ||
    Math.abs(request.now / 1000 - Number(timestamp)) > invalidationToleranceSeconds
  ) {
    return { ok: false, reason: "stale" };
  }
  const hex = SIGNATURE.exec(signature)?.[1];
  if (hex === undefined) return { ok: false, reason: "invalid_signature" };
  const received = Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
  if (!sameDigest(received, await hmac(request.secret, timestamp, body))) {
    return { ok: false, reason: "invalid_signature" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const notification = InvalidationNotificationSchema.safeParse(parsed);
  return notification.success
    ? { ok: true, notification: notification.data }
    : { ok: false, reason: "malformed" };
}
