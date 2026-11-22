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

/** The request headers the API's visitor routes read; everything else stays on the website. */
const forwardedRequestHeaders = [
  "accept",
  "content-type",
  "cookie",
  "last-event-id",
  "origin",
  "x-forwarded-for",
] as const;

/** The response headers the browser needs; everything else the API sent stays behind. */
const forwardedResponseHeaders = ["content-type", "retry-after"] as const;

const operationIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: { "cache-control": "no-store" } },
  );
}

/** The body's bytes, or null when it is longer than `limit`; stops reading as soon as it is. */
async function readBounded(
  request: Request,
  limit: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > limit) return null;
  if (request.body === null) return new Uint8Array();
  const reader = request.body.getReader();
  const pieces: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    pieces.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const piece of pieces) {
    body.set(piece, offset);
    offset += piece.byteLength;
  }
  return body;
}

function upstreamPath(request: Request, route: ChatRelayRoute): string | null {
  switch (route.kind) {
    case "conversation": {
      const incoming = new URL(request.url).searchParams;
      const query = new URLSearchParams();
      for (const name of ["before", "limit"]) {
        const value = incoming.get(name);
        if (value !== null) query.set(name, value);
      }
      const search = query.toString();
      return `/v1/chat/conversation${search === "" ? "" : `?${search}`}`;
    }
    case "messages":
      return "/v1/chat/conversation/messages";
    case "operation":
    case "events": {
      if (!operationIdPattern.test(route.operationId)) return null;
      const base = `/v1/chat/operations/${route.operationId}`;
      return route.kind === "events" ? `${base}/events` : base;
    }
  }
}

/**
 * Builds the relay. It forwards only the headers the visitor routes read (cookie, origin, content
 * type, accept, last event ID, client address) and never an API key or authorisation; a question
 * body over `chatRelayMaxBodyBytes` is refused with 413, an operation ID that is not a UUID with
 * 404, both without reaching the API. The answer keeps the API's status and body stream with its
 * content type, every cookie and Retry-After, is never cached, and an event stream is marked
 * unbuffered. An API it cannot reach answers 503 `unavailable`.
 */
export function createChatRelay(
  options: ChatRelayOptions,
): (request: Request, route: ChatRelayRoute) => Promise<Response> {
  return async (request, route) => {
    const path = upstreamPath(request, route);
    if (path === null) return errorResponse(404, "not_found", "There is no such operation.");

    const headers = new Headers();
    for (const name of forwardedRequestHeaders) {
      const value = request.headers.get(name);
      if (value !== null) headers.set(name, value);
    }

    let body: Uint8Array<ArrayBuffer> | undefined;
    if (route.kind === "messages") {
      const read = await readBounded(request, chatRelayMaxBodyBytes);
      if (read === null)
        return errorResponse(413, "payload_too_large", "The question is too long to send.");
      body = read;
    }

    let upstream: Response;
    try {
      upstream = await options.fetch(`${options.apiBaseUrl()}${path}`, {
        method: route.kind === "messages" ? "POST" : "GET",
        headers,
        ...(body === undefined ? {} : { body }),
        signal: request.signal,
        cache: "no-store",
        redirect: "manual",
      });
    } catch {
      return errorResponse(503, "unavailable", "The chat is not available right now.");
    }

    const answer = new Headers({ "cache-control": "no-store" });
    for (const name of forwardedResponseHeaders) {
      const value = upstream.headers.get(name);
      if (value !== null) answer.set(name, value);
    }
    for (const cookie of upstream.headers.getSetCookie()) answer.append("set-cookie", cookie);
    if (upstream.headers.get("content-type")?.startsWith("text/event-stream") === true) {
      answer.set("x-accel-buffering", "no");
    }
    return new Response(upstream.body, { status: upstream.status, headers: answer });
  };
}
