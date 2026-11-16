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

interface Window {
  readonly startedAt: number;
  readonly endsAt: number;
  count: number;
}

/**
 * Each caller's window starts with its first request and lasts the policy's `windowMs`. When a new
 * caller would exceed `maxTracked`, expired windows are swept first, then the oldest is evicted, so
 * memory stays bounded however many addresses call.
 */
export function createRateLimitStore(options: {
  maxTracked: number;
  now: () => number;
}): RateLimitStore {
  const windows = new Map<string, Window>();

  function makeRoom(now: number) {
    for (const [key, window] of windows) if (window.endsAt <= now) windows.delete(key);
    while (windows.size >= options.maxTracked) {
      let oldest: [string, Window] | undefined;
      for (const entry of windows)
        if (!oldest || entry[1].startedAt < oldest[1].startedAt) oldest = entry;
      if (!oldest) return;
      windows.delete(oldest[0]);
    }
  }

  return {
    hit(key, policy) {
      const now = options.now();
      let window = windows.get(key);
      if (window && window.endsAt <= now) {
        windows.delete(key);
        window = undefined;
      }
      if (!window) {
        if (windows.size >= options.maxTracked) makeRoom(now);
        window = { startedAt: now, endsAt: now + policy.windowMs, count: 0 };
        windows.set(key, window);
      }
      if (window.count >= policy.max) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((window.endsAt - now) / 1000)),
        };
      }
      window.count += 1;
      return { allowed: true };
    },
    size: () => windows.size,
  };
}
