"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Menu, X } from "lucide-react";

import { buttonVariants } from "@sebela/ui/components/button";
import { cn } from "@sebela/ui/lib/utils";

import { AskLink, HomeLink, NavigationList } from "./navigation-links";
import { SourceCodeLink } from "./source-code-link";
import { ThemeToggle } from "./theme-toggle";

/** The width from which the header shows the navigation itself (Tailwind's `md`). */
const desktopQuery = "(min-width: 48rem)";

const focusableSelector = "a[href], button:not([disabled])";

/**
 * The navigation below the desktop width: a "Menu" button that opens the navigation full screen
 * as a modal dialog. Escape and "Close menu" close it and return focus to the button; following a
 * link closes it. While open, Tab stays inside it and the page behind does not scroll.
 */
export function MobileMenu({
  name,
  current,
}: {
  readonly name: string | null;
  readonly current: string | null;
}) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogId = useId();

  const openMenu = useCallback(() => {
    const dialog = dialogRef.current;
    if (dialog === null || dialog.open) return;
    dialog.showModal();
    document.documentElement.style.overflow = "hidden";
    setOpen(true);
  }, []);

  /** Closes the menu; `restoreFocus` returns focus to the "Menu" button. */
  const closeMenu = useCallback((restoreFocus: boolean) => {
    const dialog = dialogRef.current;
    if (dialog?.open === true) dialog.close();
    document.documentElement.style.overflow = "";
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  // Escape closes the dialog natively; keep the state, the scroll lock and focus in step.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    const onCancel = (event: Event) => {
      event.preventDefault();
      closeMenu(true);
    };
    dialog.addEventListener("cancel", onCancel);
    return () => {
      dialog.removeEventListener("cancel", onCancel);
    };
  }, [closeMenu]);

  // Reaching the desktop width shows the navigation in the header: close the menu.
  useEffect(() => {
    const desktop = window.matchMedia(desktopQuery);
    const onChange = () => {
      if (desktop.matches) closeMenu(false);
    };
    desktop.addEventListener("change", onChange);
    return () => {
      desktop.removeEventListener("change", onChange);
    };
  }, [closeMenu]);

  // Leaving the page while open (unmount) must not leave the page unscrollable.
  useEffect(
    () => () => {
      document.documentElement.style.overflow = "";
    },
    [],
  );

  /** Keeps Tab and Shift+Tab inside the open menu. */
  const containFocus = (event: React.KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(focusableSelector),
    );
    const first = focusable.at(0);
    const last = focusable.at(-1);
    if (first === undefined || last === undefined) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const navigate = () => {
    closeMenu(false);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={dialogId}
        onClick={openMenu}
        className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "md:hidden")}
      >
        <Menu aria-hidden="true" />
        <span className="sr-only">Menu</span>
      </button>
      <dialog
        ref={dialogRef}
        id={dialogId}
        aria-label="Menu"
        onKeyDown={containFocus}
        className="m-0 h-dvh max-h-none w-full max-w-none bg-background p-0 text-foreground backdrop:bg-background open:flex open:flex-col md:hidden"
      >
        <div className="layout-page flex h-(--header-height) shrink-0 items-center justify-between gap-2 border-b">
          <HomeLink name={name} current={current} onNavigate={navigate} />
          <div className="flex items-center gap-2">
            <AskLink current={current} onNavigate={navigate} />
            <button
              type="button"
              onClick={() => {
                closeMenu(true);
              }}
              className={cn(buttonVariants({ variant: "ghost", size: "icon" }))}
            >
              <X aria-hidden="true" />
              <span className="sr-only">Close menu</span>
            </button>
          </div>
        </div>
        <div className="layout-page flex flex-1 flex-col gap-8 overflow-y-auto py-8">
          <nav aria-label="Main">
            <NavigationList current={current} stacked onNavigate={navigate} />
          </nav>
          {/* The icons line up with the items above; the padding stays for the hover state. */}
          <div className="-ms-3 flex flex-wrap items-center gap-2">
            <ThemeToggle withLabel />
            <SourceCodeLink withLabel onNavigate={navigate} />
          </div>
        </div>
      </dialog>
    </>
  );
}
