import type { RatePolicy } from "../config.js";

export type RateDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/**
 * Bounded in-memory fixed-window counters for one API instance. A caller key is opaque, for
 * example a policy name and a client address.
 */
export interface RateLimitStore {
  hit(key: string, policy: RatePolicy): RateDecision;
  /** Callers currently tracked. */
  size(): number;
}

export function createRateLimitStore(options: {
  maxTracked: number;
  now: () => number;
}): RateLimitStore {
  return {
    hit(key, policy) {
      throw new Error(`Not implemented yet (${key}, ${String(policy.max)}).`);
    },
    size() {
      return options.maxTracked - options.now();
    },
  };
}
