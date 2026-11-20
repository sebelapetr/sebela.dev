"use client";

// Following a link to an item of the experience page: open every disclosure that encloses it, then
// bring it into view and move focus to it, so the next Tab continues from there.
import { useEffect, useEffectEvent, useState } from "react";

import {
  deepLinkScrollBehavior,
  inPageHash,
  resolveDeepLink,
  type DeepLinkIndex,
  type DeepLinkTrigger,
} from "../stores/deep-link";

/**
 * Resolves the address's hash against `index` when the page loads (after hydration, so hydration
 * cannot undo it), on every hash change, on the browser's back and forward and on a click on a
 * link to an item of this page. `open` opens the disclosures; once they are rendered open, the
 * target scrolls into view, honouring its `scroll-margin-top` below the sticky header, and takes
 * focus without scrolling again. A load (also after a page change) jumps at once; a step within
 * the page scrolls smoothly, unless reduced motion is requested. A click on such a link is taken
 * over from the browser, which would otherwise jump before the hash changes: the hash goes into
 * the address as a new history entry, as the browser would add it. A hash that names nothing on
 * the page does nothing: the page stays as it is and no unrelated detail opens, and the browser
 * handles links to it (the skip link among them) as usual.
 */
export function useDeepLinkTarget(
  index: DeepLinkIndex,
  open: (anchors: readonly string[]) => void,
): void {
  // Bumped for every followed link, so the same anchor twice still scrolls twice.
  const [target, setTarget] = useState<{
    readonly anchor: string;
    readonly behavior: "instant" | "smooth";
  } | null>(null);

  // An effect event reads the latest `index` and `open` without being a dependency: a new index
  // (for example after the server re-renders the page) must not follow the current hash again and
  // pull the reader back to it; only a load, a hash change, back and forward or a click do.
  const follow = useEffectEvent((trigger: DeepLinkTrigger) => {
    const link = resolveDeepLink(window.location.hash, index);
    if (link === null) return;
    open(link.open);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setTarget({ anchor: link.anchor, behavior: deepLinkScrollBehavior(trigger, reducedMotion) });
  });

  // A plain click (no modifier, no new tab or download) on a link to an item of this page.
  const takeOver = useEffectEvent((event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!(event.target instanceof Element)) return;
    const anchor = event.target.closest("a[href]");
    if (!(anchor instanceof HTMLAnchorElement)) return;
    if (anchor.hasAttribute("download") || (anchor.target !== "" && anchor.target !== "_self")) {
      return;
    }
    const hash = inPageHash(anchor.href, window.location.href);
    if (hash === null || resolveDeepLink(hash, index) === null) return;
    event.preventDefault();
    if (hash !== window.location.hash) window.history.pushState(null, "", hash);
    follow("navigation");
  });

  useEffect(() => {
    const onLoad = () => {
      onLoad();
    };
    const onNavigate = () => {
      follow("navigation");
    };
    const onClick = (event: MouseEvent) => {
      takeOver(event);
    };
    onLoad();
    window.addEventListener("hashchange", onNavigate);
    window.addEventListener("popstate", onNavigate);
    // The capture phase runs before the site's own link handlers, which leave a taken-over click alone.
    document.addEventListener("click", onClick, { capture: true });
    return () => {
      window.removeEventListener("hashchange", onNavigate);
      window.removeEventListener("popstate", onNavigate);
      document.removeEventListener("click", onClick, { capture: true });
    };
  }, []);

  useEffect(() => {
    if (target === null) return;
    // The disclosures opened in the same render; wait a frame so their panels are laid out.
    const frame = requestAnimationFrame(() => {
      const element = document.getElementById(target.anchor);
      if (element === null) return;
      element.scrollIntoView({ block: "start", behavior: target.behavior });
      element.focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [target]);
}
