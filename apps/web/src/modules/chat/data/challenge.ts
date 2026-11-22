// The person check of a new question: Cloudflare Turnstile, Managed, shown only when it needs the
// visitor, run once per question and reset after each token so no token is used twice.

/** Where the Turnstile script is loaded from, rendered explicitly by the chat. */
export const turnstileScriptUrl =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** The render options this chat passes; the rest of Turnstile's options are left at defaults. */
export interface TurnstileRenderOptions {
  readonly sitekey: string;
  readonly action: string;
  readonly appearance: "interaction-only";
  readonly execution: "execute";
  readonly callback: (token: string) => void;
  readonly "error-callback": () => void;
  readonly "expired-callback": () => void;
}

/** The part of the `window.turnstile` API the chat uses. */
export interface TurnstileApi {
  render(container: HTMLElement, options: TurnstileRenderOptions): string | undefined;
  execute(widgetId: string): void;
  reset(widgetId: string): void;
}

export interface TurnstileChallengeOptions {
  /** Loads the Turnstile script once and gives its API. */
  readonly load: () => Promise<TurnstileApi>;
  /** The element the widget is shown in, when the chat is on the page. */
  readonly container: () => HTMLElement | null;
  /** The public site key; null when the website has none, so no question can be checked. */
  readonly siteKey: string | null;
}

/** Gives one fresh token per call; rejects when the check fails, is aborted or cannot run. */
export function createTurnstileChallenge(
  options: TurnstileChallengeOptions,
): (signal: AbortSignal) => Promise<string> {
  let widget: { readonly id: string; readonly container: HTMLElement } | null = null;
  let waiting: { resolve: (token: string) => void; reject: (error: Error) => void } | null = null;

  function settle(outcome: string | Error): void {
    const current = waiting;
    waiting = null;
    if (current === null) return;
    if (typeof outcome === "string") current.resolve(outcome);
    else current.reject(outcome);
  }

  return async (signal) => {
    if (options.siteKey === null) throw new Error("The website has no person check configured.");
    const siteKey = options.siteKey;
    const api = await options.load();
    signal.throwIfAborted();
    const container = options.container();
    if (container === null) throw new Error("The chat is not on the page.");
    if (widget?.container !== container) {
      const id = api.render(container, {
        sitekey: siteKey,
        action: "chat",
        appearance: "interaction-only",
        execution: "execute",
        callback: (token) => {
          settle(token);
        },
        "error-callback": () => {
          settle(new Error("The person check failed."));
        },
        "expired-callback": () => {
          settle(new Error("The person check expired."));
        },
      });
      if (id === undefined) throw new Error("The person check could not be shown.");
      widget = { id, container };
    }
    const id = widget.id;
    // A check still waiting belongs to an abandoned question; it never gives this one its token.
    settle(new Error("The person check was replaced."));

    try {
      return await new Promise<string>((resolve, reject) => {
        waiting = { resolve, reject };
        const abort = () => {
          settle(new Error("The question was abandoned."));
        };
        signal.addEventListener("abort", abort, { once: true });
        api.execute(id);
      });
    } finally {
      api.reset(id);
    }
  };
}
