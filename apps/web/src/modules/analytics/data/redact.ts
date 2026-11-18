// What a page view may tell the analytics service: the canonical path, never a query or fragment.

/** A page view's fields as the tracker sends them. */
export type PageViewPayload = Readonly<Record<string, string>>;

const notImplemented = (...values: unknown[]) =>
  new Error(`Not implemented (${String(values.length)} arguments)`);

export function canonicalPath(url: string, siteOrigin: string): string {
  throw notImplemented(url, siteOrigin);
}

export function externalReferrer(referrer: string, siteOrigin: string): string {
  throw notImplemented(referrer, siteOrigin);
}

export function redactPayload(
  payload: Readonly<Record<string, unknown>>,
  siteOrigin: string,
): PageViewPayload {
  throw notImplemented(payload, siteOrigin);
}
