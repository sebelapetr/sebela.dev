// What a page view may tell the analytics service. Only the canonical path of a page is reported:
// never a query (the Ask page's conversation identifier lives there), a fragment, a question or an
// answer. Pure, so the tracker's before-send hook and the page-view hook share one rule.

/** A page view's fields as they leave the browser. */
export type PageViewPayload = Readonly<Record<string, string>>;

/** The tracker's page-view fields that may be sent; everything else is left out. */
const PAGE_VIEW_FIELDS = ["website", "hostname", "screen", "language", "title"] as const;

/** The path of an address or path on the site, without its query and fragment; `/` when unusable. */
export function canonicalPath(url: string, siteOrigin: string): string {
  try {
    return new URL(url, siteOrigin).pathname;
  } catch {
    return "/";
  }
}

/**
 * Another site's origin a visitor came from, or empty: a referrer on the site itself, a relative
 * one, an unusable one and one with another scheme than http(s) report nothing.
 */
export function externalReferrer(referrer: string, siteOrigin: string): string {
  let url: URL;
  try {
    url = new URL(referrer);
  } catch {
    return "";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "";
  return url.origin === new URL(siteOrigin).origin ? "" : url.origin;
}

/**
 * A page view as it may be sent: the tracker's own descriptive fields when they are text, the
 * canonical path as its address and only an external referrer's origin. Custom event names and
 * data are never sent.
 */
export function redactPayload(
  payload: Readonly<Record<string, unknown>>,
  siteOrigin: string,
): PageViewPayload {
  const redacted: Record<string, string> = {};
  for (const field of PAGE_VIEW_FIELDS) {
    const value = payload[field];
    if (typeof value === "string") redacted[field] = value;
  }
  const url = payload["url"];
  const referrer = payload["referrer"];
  redacted["url"] = canonicalPath(typeof url === "string" ? url : "/", siteOrigin);
  redacted["referrer"] = typeof referrer === "string" ? externalReferrer(referrer, siteOrigin) : "";
  return redacted;
}
