// The website's shared-cache rule for its public documents and preview images (apps/web/AGENTS.md,
// Caching and invalidation). Browsers always revalidate; the CDN may keep an answer for a minute,
// serve it for another minute while it fetches a fresh one, and keep serving it for a day while the
// website cannot be reached. Pages get the same rule from the reverse proxy (infra/nginx), never
// from the website, because only the proxy sees the upstream status and the navigation header.

/** The public rule for a successful document or preview image. */
export const PUBLIC_CACHE_CONTROL =
  "public, max-age=0, s-maxage=60, stale-while-revalidate=60, stale-if-error=86400";

/** For answers no cache may keep: a 404, a temporary failure or a fallback image. */
export const NOT_STORED = "no-store";
