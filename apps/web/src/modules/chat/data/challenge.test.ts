import { describe, expect, it, vi } from "vitest";

import {
  createTurnstileChallenge,
  type TurnstileApi,
  type TurnstileRenderOptions,
} from "./challenge";

const container = {} as HTMLElement;

/** A Turnstile stand-in: records the render and lets the test answer each execute. */
function fakeTurnstile() {
  let options: TurnstileRenderOptions | null = null;
  const api = {
    render: vi.fn((_element: HTMLElement, given: TurnstileRenderOptions) => {
      options = given;
      return "widget-1";
    }),
    execute: vi.fn(),
    reset: vi.fn(),
  } satisfies TurnstileApi;
  return {
    api,
    get options(): TurnstileRenderOptions {
      if (options === null) throw new Error("not rendered");
      return options;
    },
  };
}

function challenge(
  turnstile: ReturnType<typeof fakeTurnstile>,
  siteKey: string | null = "1x00000000000000000000AA",
) {
  return createTurnstileChallenge({
    load: () => Promise.resolve(turnstile.api),
    container: () => container,
    siteKey,
  });
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe("createTurnstileChallenge", () => {
  it("renders one Managed widget that shows only when it needs the visitor", async () => {
    const turnstile = fakeTurnstile();
    const check = challenge(turnstile);

    const token = check(new AbortController().signal);
    await settle();
    turnstile.options.callback("token-1");

    await expect(token).resolves.toBe("token-1");
    expect(turnstile.api.render).toHaveBeenCalledWith(
      container,
      expect.objectContaining({
        sitekey: "1x00000000000000000000AA",
        action: "chat",
        appearance: "interaction-only",
        execution: "execute",
      }),
    );
  });

  it("runs the check per question and resets after each token", async () => {
    const turnstile = fakeTurnstile();
    const check = challenge(turnstile);

    const first = check(new AbortController().signal);
    await settle();
    turnstile.options.callback("token-1");
    await first;
    const second = check(new AbortController().signal);
    await settle();
    turnstile.options.callback("token-2");

    await expect(second).resolves.toBe("token-2");
    expect(turnstile.api.render).toHaveBeenCalledTimes(1);
    expect(turnstile.api.execute).toHaveBeenCalledTimes(2);
    expect(turnstile.api.reset).toHaveBeenCalledTimes(2);
    expect(turnstile.api.reset).toHaveBeenCalledWith("widget-1");
  });

  it.each(["error-callback", "expired-callback"] as const)(
    "rejects and resets on %s",
    async (name) => {
      const turnstile = fakeTurnstile();
      const token = challenge(turnstile)(new AbortController().signal);
      await settle();

      turnstile.options[name]();

      await expect(token).rejects.toThrow();
      expect(turnstile.api.reset).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects and resets when the question is abandoned", async () => {
    const turnstile = fakeTurnstile();
    const controller = new AbortController();
    const token = challenge(turnstile)(controller.signal);
    await settle();

    controller.abort();

    await expect(token).rejects.toThrow();
    expect(turnstile.api.reset).toHaveBeenCalledTimes(1);
  });

  it("rejects without a site key, loading nothing", async () => {
    const turnstile = fakeTurnstile();
    const load = vi.fn(() => Promise.resolve(turnstile.api));
    const check = createTurnstileChallenge({ load, container: () => container, siteKey: null });

    await expect(check(new AbortController().signal)).rejects.toThrow();
    expect(load).not.toHaveBeenCalled();
  });

  it("rejects when the script cannot be loaded or the chat is not on the page", async () => {
    const turnstile = fakeTurnstile();
    const failing = createTurnstileChallenge({
      load: () => Promise.reject(new Error("blocked")),
      container: () => container,
      siteKey: "key",
    });
    const detached = createTurnstileChallenge({
      load: () => Promise.resolve(turnstile.api),
      container: () => null,
      siteKey: "key",
    });

    await expect(failing(new AbortController().signal)).rejects.toThrow();
    await expect(detached(new AbortController().signal)).rejects.toThrow();
  });
});
