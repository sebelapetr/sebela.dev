/**
 * The authentication gate in front of every MCP Admin route except health.
 *
 * For each request, in this order: counts it against its client address's pre-authentication
 * budget, refuses credentials in the URL, takes the caller's key from `Authorization: Bearer`,
 * asks the content API whether that key is valid, counts the request against the key's own budget,
 * takes a concurrency slot and bounds the request by the configured time. Only then does the route
 * run, with the verified caller in `c.var.caller`. The key is checked again on every request, so a
 * revoked key stops working on an open connection at its next operation.
 *
 * Refusals are uniform and reveal nothing: a missing, malformed, unknown or revoked key gets the
 * same 401; an unavailable check fails closed with 503. The gate keeps no key: budgets are keyed by
 * a SHA-256 digest, and the key itself lives only for the request.
 */
import { createHash } from "node:crypto";

import type { MiddlewareHandler } from "hono";

import type { McpAdminConfig } from "../../config.js";
import type { ContentApi } from "../content/index.js";

import { clientAddress, type NodeBindings } from "./client-address.js";
import { createRateLimitStore } from "./rate-limit.js";

export type { NodeBindings } from "./client-address.js";

/** The verified caller of one request: its own key and the signal that ends the request's work. */
export interface Caller {
  readonly key: string;
  readonly signal: AbortSignal;
}

export interface GateEnv {
  Bindings: NodeBindings;
  Variables: { caller: Caller };
}

export interface GateOptions {
  readonly config: McpAdminConfig;
  readonly content: ContentApi;
  readonly now: () => number;
}

const CREDENTIAL_NAMES = new Set([
  "api_key",
  "apikey",
  "api-key",
  "key",
  "token",
  "access_token",
  "auth",
  "authorization",
  "bearer",
]);
const KEY_LIKE = /sebela_[0-9a-f]{16}_/;
const BEARER = /^Bearer +(\S+)$/i;

const errorBody = (code: string, message: string) => ({ error: { code, message } });

const UNAUTHORIZED = errorBody("unauthorized", "A valid API key is required.");
const UNAVAILABLE = errorBody("unavailable", "The content API is unavailable; retry later.");
const BUSY = errorBody("busy", "Too many requests in progress; retry later.");
const RATE_LIMITED = errorBody("rate_limited", "Too many requests; retry later.");
const CREDENTIALS_IN_URL = errorBody(
  "credentials_in_url",
  "Send the API key in the Authorization header, never in the URL.",
);

function hasCredentialsInUrl(url: string): boolean {
  for (const [name, value] of new URL(url).searchParams) {
    if (CREDENTIAL_NAMES.has(name.toLowerCase()) || KEY_LIKE.test(value)) return true;
  }
  return false;
}

export function createGate(options: GateOptions): MiddlewareHandler<GateEnv> {
  const { config, content } = options;
  const limits = createRateLimitStore({
    maxTracked: config.rateLimits.maxTracked,
    now: options.now,
  });
  let inProgress = 0;

  return async (c, next) => {
    const address = clientAddress(c.env, c.req.header("x-forwarded-for"), config.trustedProxies);
    const anonymous = limits.hit(`address:${address}`, config.rateLimits.preAuth);
    if (!anonymous.allowed) {
      return c.json(RATE_LIMITED, 429, { "Retry-After": String(anonymous.retryAfterSeconds) });
    }

    if (hasCredentialsInUrl(c.req.url)) return c.json(CREDENTIALS_IN_URL, 400);

    const key = BEARER.exec(c.req.header("authorization") ?? "")?.[1];
    if (key === undefined) return c.json(UNAUTHORIZED, 401, { "WWW-Authenticate": "Bearer" });

    const signal = AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(config.timeoutMs)]);
    const check = await content.checkKey(key, signal);
    if (check === "invalid") return c.json(UNAUTHORIZED, 401, { "WWW-Authenticate": "Bearer" });
    if (check === "unavailable") return c.json(UNAVAILABLE, 503);

    const digest = createHash("sha256").update(key).digest("hex");
    const keyed = limits.hit(`key:${digest}`, config.rateLimits.key);
    if (!keyed.allowed) {
      return c.json(RATE_LIMITED, 429, { "Retry-After": String(keyed.retryAfterSeconds) });
    }

    if (inProgress >= config.maxConcurrent) return c.json(BUSY, 503);
    inProgress += 1;
    // The slot is held until the response is fully sent: a streamed MCP answer outlives `next()`.
    let held = true;
    const release = () => {
      if (!held) return;
      held = false;
      inProgress -= 1;
    };
    signal.addEventListener("abort", release, { once: true });
    try {
      c.set("caller", { key, signal });
      await next();
    } catch (error) {
      release();
      throw error;
    }
    const body = c.res.body;
    if (body === null) {
      release();
      return undefined;
    }
    const reader = body.getReader();
    const tracked = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const chunk = await reader.read();
          if (chunk.done) {
            release();
            controller.close();
          } else {
            controller.enqueue(chunk.value as Uint8Array);
          }
        } catch (error) {
          release();
          controller.error(error);
        }
      },
      async cancel(reason) {
        release();
        await reader.cancel(reason);
      },
    });
    c.res = new Response(tracked, c.res);
    return undefined;
  };
}
