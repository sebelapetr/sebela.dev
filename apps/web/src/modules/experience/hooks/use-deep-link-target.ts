"use client";

// Following a link to an item of the experience page: open every disclosure that encloses it, then
// bring it into view and move focus to it, so the next Tab continues from there.
import { useEffect, useState } from "react";

import { resolveDeepLink, type DeepLinkIndex } from "../stores/deep-link";

/**
 * Resolves the address's hash against `index` when the page loads (after hydration, so hydration
 * cannot undo it), on every hash change and on the browser's back and forward. `open` opens the
 * disclosures; once they are rendered open, the target scrolls into view at once (no smooth
 * scrolling, so reduced motion needs nothing else), honouring its `scroll-margin-top` below the
 * sticky header, and takes focus without scrolling again. A hash that names nothing on the page
 * does nothing: the page stays as it is and no unrelated detail opens.
 */
export function useDeepLinkTarget(
  index: DeepLinkIndex,
  open: (anchors: readonly string[]) => void,
): void {
  // Bumped for every followed link, so the same anchor twice still scrolls twice.
  const [target, setTarget] = useState<{ readonly anchor: string } | null>(null);

  useEffect(() => {
    const follow = () => {
      const link = resolveDeepLink(window.location.hash, index);
      if (link === null) return;
      open(link.open);
      setTarget({ anchor: link.anchor });
    };
    follow();
    window.addEventListener("hashchange", follow);
    window.addEventListener("popstate", follow);
    return () => {
      window.removeEventListener("hashchange", follow);
      window.removeEventListener("popstate", follow);
    };
  }, [index, open]);

  useEffect(() => {
    if (target === null) return;
    // The disclosures opened in the same render; wait a frame so their panels are laid out.
    const frame = requestAnimationFrame(() => {
      const element = document.getElementById(target.anchor);
      if (element === null) return;
      element.scrollIntoView({ block: "start", behavior: "instant" });
      element.focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [target]);
}
