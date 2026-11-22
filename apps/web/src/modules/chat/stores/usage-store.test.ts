import { describe, expect, it, vi } from "vitest";

import type { ChatUsage } from "@sebela/contracts";

import { createUsageStore } from "./usage-store";

const SERVER = "2026-11-22T14:00:00.000Z";
const LOCAL = Date.parse(SERVER) - 5_000;

function usage(used: number): ChatUsage {
  return {
    serverTime: SERVER,
    model: { name: "fictional-model", effort: "medium" },
    rollingTwoHours: { used, limit: 10, percent: used * 10, nextReleaseAt: null },
    utcDay: { used, limit: 30, percent: (used * 100) / 30, resetsAt: "2026-11-23T00:00:00.000Z" },
    activeOperation: null,
    restriction: null,
    context: { status: "unavailable" },
    nextRequest: { status: "unavailable" },
  };
}

/** A read the test answers by hand, in any order. */
function reads() {
  const pending: {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    signal: AbortSignal;
  }[] = [];
  const read = vi.fn(
    (signal: AbortSignal) =>
      new Promise<unknown>((resolve, reject) => {
        pending.push({ resolve, reject, signal });
      }),
  );
  return { read, pending };
}

describe("createUsageStore", () => {
  it("is loading until the first read, then ready with the server's clock offset", async () => {
    const { read, pending } = reads();
    const store = createUsageStore({ read, now: () => LOCAL });
    expect(store.getSnapshot()).toEqual({ status: "loading" });

    const done = store.refresh();
    pending[0]?.resolve(usage(1));
    await done;

    expect(store.getSnapshot()).toEqual({
      status: "ready",
      usage: usage(1),
      offsetMs: 5_000,
      readAt: LOCAL,
      stale: false,
    });
  });

  it("is unavailable, never zero, when the first read fails or is not a snapshot", async () => {
    const failing = createUsageStore({
      read: () => Promise.reject(new Error("offline")),
      now: () => LOCAL,
    });
    await failing.refresh();
    expect(failing.getSnapshot()).toEqual({ status: "unavailable" });

    const malformed = createUsageStore({
      read: () => Promise.resolve({ rollingTwoHours: { used: 0 } }),
      now: () => LOCAL,
    });
    await malformed.refresh();
    expect(malformed.getSnapshot()).toEqual({ status: "unavailable" });
  });

  it("keeps the last snapshot, marked stale, when a later read fails, until one succeeds", async () => {
    const { read, pending } = reads();
    const store = createUsageStore({ read, now: () => LOCAL });
    const first = store.refresh();
    pending[0]?.resolve(usage(2));
    await first;

    const second = store.refresh();
    pending[1]?.reject(new Error("offline"));
    await second;
    expect(store.getSnapshot()).toMatchObject({ status: "ready", usage: usage(2), stale: true });

    const third = store.refresh();
    pending[2]?.resolve(usage(3));
    await third;
    expect(store.getSnapshot()).toMatchObject({ status: "ready", usage: usage(3), stale: false });
  });

  it("lets the latest read win: an earlier one is aborted and its late answer ignored", async () => {
    const { read, pending } = reads();
    const store = createUsageStore({ read, now: () => LOCAL });
    const first = store.refresh();
    const second = store.refresh();

    expect(pending[0]?.signal.aborted).toBe(true);
    pending[1]?.resolve(usage(4));
    pending[0]?.resolve(usage(1));
    await Promise.all([first, second]);

    expect(store.getSnapshot()).toMatchObject({ usage: usage(4), stale: false });
  });

  it("tells its subscribers of each change until they unsubscribe", async () => {
    const { read, pending } = reads();
    const store = createUsageStore({ read, now: () => LOCAL });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    const first = store.refresh();
    pending[0]?.resolve(usage(1));
    await first;
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    const second = store.refresh();
    pending[1]?.resolve(usage(2));
    await second;
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
