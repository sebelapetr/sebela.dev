// The HTTP answers of the profile's text documents (the sitemap and llms.txt): the document while
// the profile can be read, 404 while it is not published and 503 while the API cannot be read — a
// temporary failure never becomes a successful, empty document a crawler would keep.
import type { HomepageProfile, HomepageResult } from "../../profile";

/** How long a crawler should wait before it asks again after a failed read, in seconds. */
const RETRY_AFTER_SECONDS = 60;

/** A successful text document. */
export function textResponse(body: string, contentType: string): Response {
  return new Response(body, { status: 200, headers: { "Content-Type": contentType } });
}

/** A document or image that does not exist, kept out of search results. */
export function notFoundResponse(): Response {
  return new Response("Not found.\n", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": "noindex" },
  });
}

/** The document the ready profile renders to, or 404 or 503 without content. */
export function profileTextResponse(
  result: HomepageResult,
  contentType: string,
  render: (profile: HomepageProfile) => string,
): Response {
  switch (result.status) {
    case "ready":
      return textResponse(render(result.profile), contentType);
    case "missing":
      return notFoundResponse();
    case "unavailable":
      return new Response("The profile cannot be read right now. Please try again later.\n", {
        status: 503,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
          "Retry-After": String(RETRY_AFTER_SECONDS),
          "X-Robots-Tag": "noindex",
        },
      });
  }
}
