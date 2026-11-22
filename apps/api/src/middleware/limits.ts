import type { Context, MiddlewareHandler } from "hono";

import type { ApiConfig, RatePolicy } from "../config.js";
import type { RateBudget } from "../routing.js";
import { clientAddress, type ApiEnv } from "./context.js";
import { ApiError } from "./errors.js";
import { createRateLimitStore } from "./rate-limit.js";

export interface RateLimits {
  /**
   * Counts the request against the client's budget; runs before any key is looked at. The client is
   * the connection's address (`clientAddress`), unless `identify` names another caller for this
   * request, such as the visitor a verified relay speaks for; such a name never collides with an
   * address.
   */
  perClient(
    budget: RateBudget,
    identify?: (c: Context<ApiEnv>) => string | null,
  ): MiddlewareHandler<ApiEnv>;
  /** Counts the request against its verified key's budget; runs after authentication. */
  perKey(): MiddlewareHandler<ApiEnv>;
}

/** The rate limits of one app instance, over one bounded in-memory store. */
export function createRateLimits(config: ApiConfig, now: () => number): RateLimits {
  const store = createRateLimitStore({ maxTracked: config.rateLimits.maxTrackedCallers, now });

  const count = (key: string, policy: RatePolicy) => {
    const decision = store.hit(key, policy);
    if (!decision.allowed) {
      throw new ApiError(429, "rate_limited", "Too many requests; retry later.", undefined, {
        "Retry-After": String(decision.retryAfterSeconds),
      });
    }
  };

  return {
    perClient: (budget, identify) => async (c, next) => {
      const named = identify?.(c) ?? null;
      const client =
        named === null
          ? clientAddress(c.env, c.req.header("x-forwarded-for"), config.trustedProxies)
          : `named:${named}`;
      count(`${budget}:${client}`, config.rateLimits[budget]);
      await next();
    },
    perKey: () => async (c, next) => {
      count(`key:${c.get("keyId")}`, config.rateLimits.key);
      await next();
    },
  };
}
