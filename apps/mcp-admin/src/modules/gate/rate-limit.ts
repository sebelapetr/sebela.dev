import type { RatePolicy } from "../../config.js";

export type RateDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/** Bounded in-memory fixed-window counters, the same policy as the API's own limits. */
export interface RateLimitStore {
  hit(key: string, policy: RatePolicy): RateDecision;
}

interface Window {
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
    // Insertion order is the order of window starts: the first entry is the oldest.
    for (const key of windows.keys()) {
      if (windows.size < options.maxTracked) return;
      windows.delete(key);
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
        window = { endsAt: now + policy.windowMs, count: 0 };
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
  };
}
