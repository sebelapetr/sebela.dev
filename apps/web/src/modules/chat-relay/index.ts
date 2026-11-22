// The chat relay module: the website's same-origin chat routes (`/api/chat/*`), relayed to the
// API's visitor chat routes over HTTP. The browser's cookie and origin go through unchanged; the
// relay adds its token (`WEB_CHAT_RELAY_TOKEN`) and the visitor's address as the trusted proxies
// saw it (`WEB_TRUSTED_PROXY_HOPS`), never an API key or the browser's X-Forwarded-For. The API's
// answer, cookies and event streams come back unbuffered and never cached. An operation ID that is
// not a UUID answers 404 and an oversized question 413 without reaching the API; without the token,
// or with an API it cannot reach, it answers 503 `unavailable`. It also
// gives the Ask page the person check's public site key, read per request.
import "server-only";

import { readChatRelayConfig, readTurnstileSiteKey, readWebConfig } from "../../config";
import { createChatRelay, type ChatRelayRoute } from "./data/relay";

export type { ChatRelayRoute } from "./data/relay";

const relay = createChatRelay({
  fetch: (input, init) => globalThis.fetch(input, init),
  apiBaseUrl: () => readWebConfig(process.env).apiBaseUrl,
  settings: () => readChatRelayConfig(process.env),
});

/** Relays one visitor chat request to the API and returns the API's answer. */
export function relayChatRequest(request: Request, route: ChatRelayRoute): Promise<Response> {
  return relay(request, route);
}

/**
 * The public Turnstile site key the chat's person check renders with (`WEB_TURNSTILE_SITE_KEY`),
 * read per request; null when unset, so no new question can be sent. Throws for an invalid key.
 */
export function chatChallengeSiteKey(): string | null {
  return readTurnstileSiteKey(process.env);
}
