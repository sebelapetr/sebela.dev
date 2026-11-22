// The website's same-origin chat routes, relayed to the API's visitor chat routes: the browser's
// cookie, origin and client address go through unchanged, nothing is added (no API key, no
// invented origin), and the API's answer comes back as it is, event streams unbuffered.

/** Which visitor chat route a request is for; the operation as the website's route named it. */
export type ChatRelayRoute =
  | { readonly kind: "conversation" }
  | { readonly kind: "messages" }
  | { readonly kind: "operation"; readonly operationId: string }
  | { readonly kind: "events"; readonly operationId: string };

export interface ChatRelayOptions {
  /** The server's `fetch`. */
  readonly fetch: typeof globalThis.fetch;
  /** The API's base address (`WEB_API_BASE_URL`); read per request. */
  readonly apiBaseUrl: () => string;
}

/** The largest question body the relay reads, well above the contract's longest submission. */
export const chatRelayMaxBodyBytes = 16 * 1024;

export const createChatRelay: (
  options: ChatRelayOptions,
) => (request: Request, route: ChatRelayRoute) => Promise<Response> = () => {
  throw new Error("not implemented");
};
