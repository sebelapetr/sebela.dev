// A stand-in for Cloudflare Turnstile's script in the browser tests: the page's request for
// `api.js` is answered with a small `window.turnstile` that hands out tokens at once, so no test
// reaches Cloudflare. Only the browser tests serve it; the website itself reads nothing but the
// real script's `window.turnstile`, so no visitor can switch it on.
import type { Page } from "@playwright/test";

/**
 * The script. Each `execute` takes the next queued token: one starting `fail` is refused by the
 * Siteverify stand-in (`e2e/chat-stack.ts`), `error` fails the check in the browser, and an empty
 * queue gives `pass-<n>`. Every token handed out ends in `.<load>`, unique to the page load, as the
 * API refuses a token it has redeemed before. It counts the executions in
 * `__e2eTurnstile.executions`.
 */
function script(tokens: readonly string[]): string {
  return `(() => {
  const state = { queue: ${JSON.stringify(tokens)}, executions: 0, widgets: new Map(), next: 0 };
  const load = Date.now().toString(36) + Math.random().toString(36).slice(2);
  window.__e2eTurnstile = state;
  window.turnstile = {
    render(container, options) {
      const id = "widget-" + String(state.widgets.size + 1);
      state.widgets.set(id, options);
      container.dataset.turnstileWidget = id;
      return id;
    },
    execute(id) {
      const options = state.widgets.get(id);
      state.executions += 1;
      const token = state.queue.length > 0 ? state.queue.shift() : "pass-" + String(++state.next);
      setTimeout(() => {
        if (token === "error") options["error-callback"]();
        else options.callback(token + "." + load);
      }, 0);
    },
    reset() {},
  };
})();`;
}

/** Serves the stand-in to the page's next loads, with these tokens queued for each load. */
export async function fakeTurnstile(page: Page, tokens: readonly string[] = []): Promise<void> {
  await page.route("**/turnstile/v0/api.js*", (route) =>
    route.fulfill({ contentType: "text/javascript", body: script(tokens) }),
  );
}

/** Queues more tokens on the loaded page. */
export async function queueTokens(page: Page, tokens: readonly string[]): Promise<void> {
  await page.evaluate((more) => {
    const state = (window as unknown as { __e2eTurnstile?: { queue: string[] } }).__e2eTurnstile;
    if (state === undefined) throw new Error("The person check has not loaded yet.");
    state.queue.push(...more);
  }, tokens);
}

/** How many times the page ran the person check since it loaded its script; 0 before that. */
export async function executions(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (window as unknown as { __e2eTurnstile?: { executions: number } }).__e2eTurnstile
        ?.executions ?? 0,
  );
}
