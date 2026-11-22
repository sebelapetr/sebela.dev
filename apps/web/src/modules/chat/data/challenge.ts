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
export const createTurnstileChallenge: (
  options: TurnstileChallengeOptions,
) => (signal: AbortSignal) => Promise<string> = () => {
  throw new Error("not implemented");
};
