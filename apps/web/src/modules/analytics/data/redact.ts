// What a page view may tell the analytics service. Only the canonical path of a page is reported:
// never a query (the Ask page's conversation identifier lives there), a fragment, a question or an
// answer. An address that is no page of the site (the not-found page shows whatever was typed) is
// reported under one fixed path. Pure, so the tracker's before-send hook and the page-view hook share one rule.

import { cvPdfRoutes, routes } from "../../_shared";

/** A page view's fields as they leave the browser. */
export type PageViewPayload = Readonly<Record<string, string>>;

/** The tracker's page-view fields that may be sent; everything else is left out. */
const PAGE_VIEW_FIELDS = ["website", "hostname", "screen", "language", "title"] as const;

/** The path every address that is no page of the site is reported under. */
export const NOT_FOUND_PATH = "/404";

/** The site's pages, by their paths (the contact anchor is the homepage): the only paths reported as they are. */
const PAGE_PATHS: ReadonlySet<string> = new Set(
  [...Object.values(routes), cvPdfRoutes.unavailable].map((path) => path.split("#")[0] ?? path),
);

/**
 * The page an address or path on the site shows, without its query and fragment: one of the site's
 * pages, `NOT_FOUND_PATH` for any other path, and `/` for something that is not an address.
 */
export function canonicalPath(url: string, siteOrigin: string): string {
  let path: string;
  try {
    path = new URL(url, siteOrigin).pathname;
  } catch {
    return "/";
  }
  return PAGE_PATHS.has(path) ? path : NOT_FOUND_PATH;
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
