import {
  invalidationHeaders,
  invalidationMaxBodyBytes,
  verifyInvalidationNotification,
  type InvalidationRefusal,
} from "@sebela/contracts";

import { scopesFor, type CacheScope } from "./dependencies";

export interface InvalidationReceiverOptions {
  /** The signing secret; throws when it is not configured (a configuration error, answered 500). */
  readonly secret: () => string;
  /** Invalidates the scopes; called only for an accepted notification, before it is answered. */
  readonly invalidate: (scopes: readonly CacheScope[]) => void;
  /** The clock, in milliseconds since the epoch; `Date.now` by default. */
  readonly now?: () => number;
  /** Where refusals and configuration errors are reported, never with the secret or the body. */
  readonly log?: (line: string) => void;
}

const REFUSAL_STATUS: Readonly<Record<InvalidationRefusal, number>> = {
  payload_too_large: 413,
  missing_signature: 401,
  stale: 401,
  invalid_signature: 401,
  malformed: 400,
};

const answer = (status: number) =>
  new Response(null, {
    status,
    headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });

/**
 * Reads at most `limit` bytes of the body: `null` when it announces or turns out to be longer, in
 * which case it stops reading at once.
 */
async function readBounded(request: Request, limit: number): Promise<Uint8Array | null> {
  const announced = request.headers.get("Content-Length");
  if (announced !== null && !(Number(announced) <= limit)) {
    await request.body?.cancel().catch(() => undefined);
    return null;
  }
  if (request.body === null) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/**
 * The receiver of the API's signed invalidation notifications. It reads the body bounded by
 * `invalidationMaxBodyBytes` without parsing it, verifies the exact bytes with the two signature
 * headers (absent ones as `null`) and only for an accepted notification invalidates the scopes the
 * dependency map gives its changes, then answers 204. A refusal invalidates nothing: 413 for an
 * oversized body, 401 for a missing, stale or wrong signature, 400 for a signed body that is no
 * valid notification. A missing or too short secret answers 500. 4xx answers are final for the
 * sender; a 5xx makes it retry. Answers are never cached or indexed; log lines name the refusal
 * only, never the secret, the body or the event.
 */
export function createInvalidationReceiver(
  options: InvalidationReceiverOptions,
): (request: Request) => Promise<Response> {
  const now = options.now ?? Date.now;
  const log = options.log ?? (() => undefined);

  return async (request) => {
    let secret: string;
    try {
      secret = options.secret();
    } catch (error) {
      await request.body?.cancel().catch(() => undefined);
      log(
        `Website invalidation is not configured: ${error instanceof Error ? error.message : "unknown error"}`,
      );
      return answer(500);
    }

    const body = await readBounded(request, invalidationMaxBodyBytes);
    if (body === null) {
      log("Website invalidation refused: payload_too_large");
      return answer(REFUSAL_STATUS.payload_too_large);
    }

    let verification;
    try {
      verification = await verifyInvalidationNotification({
        secret,
        body,
        timestamp: request.headers.get(invalidationHeaders.timestamp),
        signature: request.headers.get(invalidationHeaders.signature),
        now: now(),
      });
    } catch {
      // Only a secret shorter than the minimum makes verification throw.
      log("Website invalidation is not configured: the signing secret is too short");
      return answer(500);
    }
    if (!verification.ok) {
      log(`Website invalidation refused: ${verification.reason}`);
      return answer(REFUSAL_STATUS[verification.reason]);
    }

    options.invalidate(scopesFor(verification.notification.changes));
    return answer(204);
  };
}
