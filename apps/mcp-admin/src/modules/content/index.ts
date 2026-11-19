/**
 * The content API as MCP Admin uses it: one fixed base address, the caller's own key, and
 * outcomes instead of HTTP details.
 *
 * Every request goes to the configured base address only; nothing a caller sends can choose
 * another one. Redirects are never followed, so a key cannot be carried to a third host. A
 * failure of any kind, including a redirect, a malformed answer, a network error and an abort, is
 * reported as `unavailable` without its cause, so no upstream text reaches a caller.
 */
import { createApiClient, type ApiClient, type Person } from "@sebela/api-client";

export type KeyCheck = "valid" | "invalid" | "unavailable";

export type ReadOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: "not_found" | "unavailable" };

/** The content API on behalf of one verified caller, for one MCP request. */
export interface CallerContent {
  /** The stored person, read through its public route without a key. */
  getPerson(): Promise<ReadOutcome<Person>>;
}

export interface ContentApi {
  /**
   * Asks the API whether `key` is a valid, unrevoked API key. `valid` only for exactly the
   * documented success answer; `invalid` for a refusal; `unavailable` for everything else.
   */
  checkKey(key: string, signal: AbortSignal): Promise<KeyCheck>;
  /** Content operations that carry `key` where the API requires one and abort with `signal`. */
  forCaller(key: string, signal: AbortSignal): CallerContent;
}

export interface ContentApiOptions {
  /** The API's base address, without a trailing slash. */
  readonly baseUrl: string;
  /** The transport; the platform `fetch` when omitted. Tests pass a fake API. */
  readonly fetch?: (request: Request) => Promise<Response>;
}

export function createContentApi(options: ContentApiOptions): ContentApi {
  const upstream = options.fetch ?? ((request: Request) => fetch(request));
  // Whatever the generated client builds, the request goes out with redirects left unfollowed.
  const send = (request: Request) => upstream(new Request(request, { redirect: "manual" }));
  const client = (apiKey?: string): ApiClient =>
    createApiClient({
      baseUrl: options.baseUrl,
      fetch: send,
      ...(apiKey === undefined ? {} : { apiKey }),
    });

  return {
    async checkKey(key, signal) {
      try {
        const { data, response } = await client(key).GET("/v1/authentication", { signal });
        if (response.status === 401) return "invalid";
        const exact =
          response.status === 200 &&
          typeof data === "object" &&
          Object.keys(data).length === 1 &&
          (data as { status?: unknown }).status === "authenticated";
        return exact ? "valid" : "unavailable";
      } catch {
        return "unavailable";
      }
    },

    forCaller(key, signal) {
      const caller = client(key);
      return {
        async getPerson() {
          try {
            const { data, response } = await caller.GET("/v1/person", { signal });
            if (response.status === 200 && data !== undefined) return { ok: true, value: data };
            if (response.status === 404) return { ok: false, reason: "not_found" };
            return { ok: false, reason: "unavailable" };
          } catch {
            return { ok: false, reason: "unavailable" };
          }
        },
      };
    },
  };
}
