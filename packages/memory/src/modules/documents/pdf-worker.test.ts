import { afterEach, describe, expect, it } from "vitest";

import { capAllocations } from "./pdf-worker.js";

let release: (() => void) | undefined;

afterEach(() => {
  release?.();
  release = undefined;
});

/** Caps allocations at `maxBytes` for one test and counts the refusals. */
const capped = (maxBytes: number) => {
  const refusals = { count: 0 };
  release = capAllocations(maxBytes, () => {
    refusals.count += 1;
  });
  return refusals;
};

describe("capAllocations", () => {
  it("refuses a typed array or buffer larger than the cap before it is allocated", () => {
    const refusals = capped(1024);

    expect(() => new Uint8Array(1025)).toThrow(RangeError);
    expect(() => new Float64Array(129)).toThrow(RangeError);
    expect(() => new ArrayBuffer(2048)).toThrow(RangeError);
    expect(() => Uint8Array.from({ length: 4096 })).toThrow(RangeError);
    expect(refusals.count).toBe(4);
  });

  it("leaves smaller allocations, views and the constructors' behaviour as they were", () => {
    const refusals = capped(1024);

    const bytes = new Uint8Array(1024);
    const view = new Uint8Array(new ArrayBuffer(512), 0, 256);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(view.length).toBe(256);
    expect(Uint8Array.from([1, 2, 3])).toEqual(new Uint8Array([1, 2, 3]));
    expect(Object.prototype.toString.call(new Int32Array(4))).toBe("[object Int32Array]");
    expect(refusals.count).toBe(0);
  });

  it("restores the original constructors when released", () => {
    const original = Uint8Array;
    capped(16);
    release?.();
    release = undefined;

    expect(Uint8Array).toBe(original);
    expect(new Uint8Array(32).length).toBe(32);
  });
});
