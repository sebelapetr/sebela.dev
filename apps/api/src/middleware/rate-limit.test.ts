import { describe, expect, it } from "vitest";

import { createRateLimitStore } from "./rate-limit.js";

const policy = { max: 2, windowMs: 10_000 };

function clock(start = 1_000_000) {
  let now = start;
  return {
    now: () => now,
    advance(ms: number) {
      now += ms;
    },
  };
}

describe("rate-limit store", () => {
  it("allows the budget, then refuses with the seconds left in the window", () => {
    const time = clock();
    const store = createRateLimitStore({ maxTracked: 10, now: time.now });

    expect(store.hit("a", policy)).toEqual({ allowed: true });
    time.advance(2_500);
    expect(store.hit("a", policy)).toEqual({ allowed: true });
    expect(store.hit("a", policy)).toEqual({ allowed: false, retryAfterSeconds: 8 });
  });

  it("recovers when the window has passed", () => {
    const time = clock();
    const store = createRateLimitStore({ maxTracked: 10, now: time.now });
    store.hit("a", policy);
    store.hit("a", policy);

    time.advance(10_000);

    expect(store.hit("a", policy)).toEqual({ allowed: true });
  });

  it("counts every caller on its own", () => {
    const store = createRateLimitStore({ maxTracked: 10, now: clock().now });
    store.hit("a", policy);
    store.hit("a", policy);

    expect(store.hit("a", policy).allowed).toBe(false);
    expect(store.hit("b", policy)).toEqual({ allowed: true });
  });

  it("forgets callers whose window has passed", () => {
    const time = clock();
    const store = createRateLimitStore({ maxTracked: 3, now: time.now });
    store.hit("a", policy);
    store.hit("b", policy);
    store.hit("c", policy);

    time.advance(10_000);
    store.hit("d", policy);

    expect(store.size()).toBe(1);
  });

  it("never tracks more callers than its bound, evicting the oldest window", () => {
    const time = clock();
    const store = createRateLimitStore({ maxTracked: 3, now: time.now });
    for (const caller of ["a", "b", "c", "d", "e"]) {
      store.hit(caller, policy);
      time.advance(1);
    }

    expect(store.size()).toBe(3);
    store.hit("e", policy);
    expect(store.hit("e", policy).allowed).toBe(false);
  });
});
