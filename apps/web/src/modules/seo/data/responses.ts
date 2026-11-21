// The HTTP answers of the profile's text documents (the sitemap and llms.txt): the document while
// the profile can be read, 404 while it is not published and 503 while the API cannot be read — a
// temporary failure never becomes a successful, empty document a crawler would keep.
import { NOT_STORED, PUBLIC_CACHE_CONTROL } from "./cache-control";

/** How long a crawler should wait before it asks again after a failed read, in seconds. */
const RETRY_AFTER_SECONDS = 60;

/** A successful text document, which the CDN keeps briefly under the public cache rule. */
export function textResponse(body: string, contentType: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": contentType, "Cache-Control": PUBLIC_CACHE_CONTROL },
  });
}

/** A document or image that does not exist, kept out of search results and out of every cache. */
export function notFoundResponse(): Response {
  return new Response("Not found.\n", {
    status: 404,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": NOT_STORED,
      "X-Robots-Tag": "noindex",
    },
  });
}

/** A read of the content a document renders: ready with it, not published, or not readable. */
export type DocumentRead<Ready extends { readonly status: "ready" }> =
  Ready | { readonly status: "missing" } | { readonly status: "unavailable" };

/** The document the ready read renders to, or 404 or 503 without content. */
export function profileTextResponse<Ready extends { readonly status: "ready" }>(
  result: DocumentRead<Ready>,
  contentType: string,
  render: (ready: Ready) => string,
): Response {
  switch (result.status) {
    case "ready":
      return textResponse(render(result), contentType);
    case "missing":
      return notFoundResponse();
    case "unavailable":
      return new Response("The profile cannot be read right now. Please try again later.\n", {
        status: 503,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": NOT_STORED,
          "Retry-After": String(RETRY_AFTER_SECONDS),
          "X-Robots-Tag": "noindex",
        },
      });
  }
}
