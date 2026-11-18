"use client";

import { usePathname } from "next/navigation";
import Script from "next/script";
import { useEffect, useRef, useState } from "react";

import { canonicalPath, externalReferrer, redactPayload } from "../data/redact";

/** The global function the tracker hands every payload to before sending it (`data-before-send`). */
const BEFORE_SEND = "sebelaAnalyticsBeforeSend";

type Payload = Readonly<Record<string, unknown>>;

interface Tracker {
  track(build: (payload: Payload) => Payload): unknown;
}

function tracker(): Tracker | undefined {
  const candidate = (window as unknown as { umami?: unknown }).umami;
  if (typeof candidate !== "object" || candidate === null || !("track" in candidate)) {
    return undefined;
  }
  return typeof candidate.track === "function" ? (candidate as Tracker) : undefined;
}

// Installed when the module loads in the browser, before the tracker script is added: whatever
// the tracker sends, it sends only the canonical path and an external referrer's origin. A payload
// that is not an object is not sent.
if (typeof window !== "undefined") {
  Object.assign(window, {
    [BEFORE_SEND]: (_type: unknown, payload: unknown) =>
      typeof payload === "object" && payload !== null
        ? redactPayload(payload as Payload, window.location.origin)
        : false,
  });
}

/** Reports one page view; a tracker that is missing, throws or fails to send changes nothing. */
function reportPageView(path: string, referrer: string): void {
  try {
    const result = tracker()?.track((payload) => ({ ...payload, url: path, referrer }));
    if (result instanceof Promise) result.catch(() => undefined);
  } catch {
    // Analytics never interferes with the page.
  }
}

/**
 * Loads the tracker after the page is interactive, with its automatic tracking off, and reports
 * one page view per canonical path the visitor reaches: on the first load and on every client-side
 * navigation, never for a query or fragment change.
 */
export function PageViews({
  scriptUrl,
  websiteId,
}: {
  readonly scriptUrl: string;
  readonly websiteId: string;
}) {
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    const origin = window.location.origin;
    const path = canonicalPath(pathname, origin);
    if (path === lastPath.current) return;
    // Only the first page view can come from another site; later ones come from this one.
    const referrer = lastPath.current === null ? externalReferrer(document.referrer, origin) : "";
    lastPath.current = path;
    reportPageView(path, referrer);
  }, [pathname, ready]);

  return (
    <Script
      src={scriptUrl}
      strategy="afterInteractive"
      data-website-id={websiteId}
      data-auto-track="false"
      data-exclude-search="true"
      data-exclude-hash="true"
      data-before-send={BEFORE_SEND}
      onReady={() => {
        setReady(true);
      }}
    />
  );
}
