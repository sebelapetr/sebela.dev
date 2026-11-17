"use client";

import { usePathname } from "next/navigation";

import { currentNavigationHref, mainContentId } from "../navigation";
import { MobileMenu } from "./mobile-menu";
import { AskLink, HomeLink, NavigationList } from "./navigation-links";
import { ThemeToggle } from "./theme-toggle";

/**
 * The site header of every page, sticky at the top: the name that leads home (or "Home" when the
 * profile could not be read), the navigation, "Ask AI" and the theme toggle; below the desktop
 * width, the name, "Ask AI" and a menu. A "Skip to content" link comes first. Not printed.
 */
export function SiteHeader({ name }: { readonly name: string | null }) {
  const current = currentNavigationHref(usePathname());
  return (
    <>
      <a
        href={`#${mainContentId}`}
        className="sr-only rounded-lg border bg-background text-sm font-medium focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:inline-flex focus:min-h-11 focus:items-center focus:px-4"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 h-(--header-height) border-b bg-background print:hidden">
        <div className="layout-page flex h-full items-center justify-between gap-4">
          <HomeLink name={name} current={current} />
          <nav aria-label="Main" className="hidden md:block">
            <NavigationList current={current} />
          </nav>
          <div className="flex shrink-0 items-center gap-2">
            <AskLink current={current} />
            <ThemeToggle className="hidden md:inline-flex" />
            <MobileMenu name={name} current={current} />
          </div>
        </div>
      </header>
    </>
  );
}
