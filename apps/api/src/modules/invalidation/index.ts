/**
 * Tells the website which content changed, after the API has committed a write.
 *
 * Each change becomes one signed notification (`@sebela/contracts`, website invalidation): a new
 * event identifier, the time of the notification and the change, encoded once and signed over
 * those exact bytes and a fresh timestamp at every attempt. Delivery runs in the background, one at
 * a time, so a write is never delayed or failed by the website. Everything is bounded: a fixed
 * queue (what does not fit is dropped and logged), a timeout per attempt, a fixed number of
 * attempts, no redirects followed and no response body read. Logs name the event, the attempt and
 * the status or error; never the destination, the secret or the body.
 */
import {
  encodeInvalidationNotification,
  invalidationHeaders,
  invalidationSecretMinLength,
  signInvalidationNotification,
  type ContentChange,
} from "@sebela/contracts";

import type { Logger } from "../../middleware/logging.js";

export interface WebsiteInvalidationOptions {
  /** The website's receiver; a plain http or https address, validated by the configuration. */
  readonly url: string;
  /** The server-only signing secret, at least `invalidationSecretMinLength` characters. */
  readonly secret: string;
  readonly log: Logger;
  readonly fetch?: typeof globalThis.fetch;
  /** Milliseconds since the epoch, for `occurredAt` and the signed timestamp. */
  readonly now?: () => number;
  /** A UUID for each notification. */
  readonly randomId?: () => string;
  /** How long one attempt may take, headers included; default 2000. */
  readonly timeoutMs?: number;
  /** The pause before each retry; its length is the number of retries. Default `[250, 1000]`. */
  readonly retryDelaysMs?: readonly number[];
  /** Most notifications waiting behind the one being delivered; default 32. */
  readonly queueLimit?: number;
}

export interface WebsiteInvalidation {
  /** Queues the change and returns at once; never rejects. Usable as the app's `onWrite`. */
  readonly notify: (event: { readonly change: ContentChange }) => Promise<void>;
  /** Resolves once nothing is queued or being delivered. */
  readonly idle: () => Promise<void>;
  /** Aborts the delivery in flight, drops what is queued and ignores later changes. */
  readonly close: () => Promise<void>;
}

interface Pending {
  readonly eventId: string;
  readonly body: Uint8Array<ArrayBuffer>;
}

export function createWebsiteInvalidation(
  options: WebsiteInvalidationOptions,
): WebsiteInvalidation {
  const { url, secret, log } = options;
  if (secret.length < invalidationSecretMinLength) {
    throw new Error(
      `The website invalidation secret must have at least ${String(invalidationSecretMinLength)} characters.`,
    );
  }
  const send = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const randomId = options.randomId ?? (() => crypto.randomUUID());
  const timeoutMs = options.timeoutMs ?? 2000;
  const retryDelaysMs = options.retryDelaysMs ?? [250, 1000];
  const queueLimit = options.queueLimit ?? 32;
  const attempts = retryDelaysMs.length + 1;

  const queue: Pending[] = [];
  const closing = new AbortController();
  let draining: Promise<void> | undefined;
  // A function, not a property read: the sender may close while an attempt awaits.
  const closed = () => closing.signal.aborted;

  const report = (eventId: string, outcome: string) => {
    log(`website invalidation ${eventId} ${outcome}`);
  };

  /** Waits, or stops waiting when the sender closes. */
  const pause = (ms: number) =>
    new Promise<void>((resolve) => {
      const stop = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        closing.signal.removeEventListener("abort", stop);
        resolve();
      }, ms);
      closing.signal.addEventListener("abort", stop, { once: true });
    });

  /** One attempt: `"delivered"`, `"retry"` with what went wrong, or `"refused"` with the status. */
  const attempt = async ({ body }: Pending): Promise<[string, string]> => {
    const signed = await signInvalidationNotification({ secret, body, now: now() });
    if (closed()) return ["retry", "closed"];
    try {
      const response = await send(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [invalidationHeaders.timestamp]: signed.timestamp,
          [invalidationHeaders.signature]: signed.signature,
        },
        body,
        redirect: "manual",
        signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), closing.signal]),
      });
      await response.body?.cancel().catch(() => undefined);
      const status = `status ${String(response.status)}`;
      if (response.status >= 200 && response.status < 300) return ["delivered", status];
      if (response.status >= 500 || response.status === 429) return ["retry", status];
      return ["refused", status];
    } catch (error) {
      return ["retry", error instanceof Error ? error.name : "error"];
    }
  };

  const deliver = async (pending: Pending) => {
    for (let number = 1; number <= attempts; number += 1) {
      if (closed()) return;
      const [result, detail] = await attempt(pending);
      if (closed()) return;
      if (result === "delivered") return;
      if (result === "refused") {
        report(pending.eventId, `refused at attempt ${String(number)}: ${detail}`);
        return;
      }
      report(pending.eventId, `attempt ${String(number)} failed: ${detail}`);
      const delay = retryDelaysMs[number - 1];
      if (delay !== undefined) await pause(delay);
    }
    report(pending.eventId, `gave up after ${String(attempts)} attempts`);
  };

  const drain = async () => {
    try {
      for (let pending = queue.shift(); pending; pending = queue.shift()) {
        await deliver(pending).catch((error: unknown) => {
          report(pending.eventId, `failed: ${error instanceof Error ? error.name : "error"}`);
        });
      }
    } finally {
      draining = undefined;
    }
  };

  const notify = ({ change }: { readonly change: ContentChange }): Promise<void> => {
    if (closed()) return Promise.resolve();
    const eventId = randomId();
    let body: Uint8Array<ArrayBuffer>;
    try {
      body = new Uint8Array(
        encodeInvalidationNotification({
          eventId,
          occurredAt: new Date(now()).toISOString(),
          changes: [change],
        }),
      );
    } catch {
      report(eventId, "skipped: invalid change");
      return Promise.resolve();
    }
    if (queue.length >= queueLimit) {
      report(eventId, "dropped: the queue is full");
      return Promise.resolve();
    }
    queue.push({ eventId, body });
    draining ??= drain();
    return Promise.resolve();
  };

  const idle = async () => {
    while (draining) await draining;
  };

  const close = async () => {
    closing.abort();
    queue.length = 0;
    await idle();
  };

  return { notify, idle, close };
}
