"use client";

// Which disclosures of the experience page are open: the experiences, the case studies and the
// secondary technologies, by their anchors. One state for the page, so a link to an item can open everything that encloses it before
// the page scrolls to it. The disclosures themselves stay where they are rendered and read it here.
import { createContext, use, useCallback, useMemo, useState, type ReactNode } from "react";

import { useDeepLinkTarget } from "../hooks/use-deep-link-target";
import type { DeepLinkIndex } from "./deep-link";

interface Disclosures {
  readonly isOpen: (anchor: string) => boolean;
  readonly setOpen: (anchor: string, open: boolean) => void;
}

const DisclosuresContext = createContext<Disclosures | null>(null);

/**
 * Holds the open disclosures, `initiallyOpen` at first (the current experiences, as the server
 * renders them), and opens what the address's hash names: on load, on a hash change and on the
 * browser's back and forward.
 */
export function DisclosuresProvider({
  index,
  initiallyOpen,
  children,
}: {
  readonly index: DeepLinkIndex;
  readonly initiallyOpen: readonly string[];
  readonly children: ReactNode;
}) {
  const [open, setOpenSet] = useState<ReadonlySet<string>>(() => new Set(initiallyOpen));

  const setOpen = useCallback((anchor: string, next: boolean) => {
    setOpenSet((current) => {
      if (current.has(anchor) === next) return current;
      const updated = new Set(current);
      if (next) updated.add(anchor);
      else updated.delete(anchor);
      return updated;
    });
  }, []);

  const openAll = useCallback((anchors: readonly string[]) => {
    setOpenSet((current) =>
      anchors.every((anchor) => current.has(anchor)) ? current : new Set([...current, ...anchors]),
    );
  }, []);

  useDeepLinkTarget(index, openAll);

  const value = useMemo<Disclosures>(
    () => ({ isOpen: (anchor) => open.has(anchor), setOpen }),
    [open, setOpen],
  );
  return <DisclosuresContext value={value}>{children}</DisclosuresContext>;
}

/** Whether the disclosure with this anchor is open, and how to open or close it. */
export function useDisclosure(anchor: string): readonly [boolean, (open: boolean) => void] {
  const disclosures = use(DisclosuresContext);
  if (disclosures === null) throw new Error("useDisclosure needs a DisclosuresProvider.");
  const { isOpen, setOpen } = disclosures;
  const onOpenChange = useCallback(
    (next: boolean) => {
      setOpen(anchor, next);
    },
    [anchor, setOpen],
  );
  return [isOpen(anchor), onOpenChange];
}
