// The site's navigation: the header's items and which of them the current page is.

import { routes } from "./site";

/** One link of the navigation. */
export interface NavigationItem {
  readonly label: string;
  readonly href: string;
}

/** The navigation's links in their order, after the name that leads home. */
export const navigationItems: readonly NavigationItem[] = [
  { label: "Experience", href: routes.experience },
  { label: "Services", href: routes.services },
  { label: "AI Roadmap", href: routes.aiRoadmap },
  { label: "Contact", href: routes.contact },
];

/** The id of every page's `<main>`: the target of the header's "Skip to content" link. */
export const mainContentId = "main-content";

/** Where the header's "Ask AI" button leads. */
export const askRoute: string = routes.ask;

/** The pages a navigation entry marks as current: its own and every page below it. */
const pageEntries: readonly string[] = [
  routes.experience,
  routes.services,
  routes.aiRoadmap,
  routes.ask,
];

/**
 * The address of the navigation entry the page at `pathname` belongs to — an item, the name
 * (`/`) or Ask AI — or null for a page outside the navigation. Contact is never current: it is a
 * block of the homepage, not a page.
 */
export function currentNavigationHref(pathname: string | null): string | null {
  if (pathname === null) return null;
  const path = pathname.replace(/\/+$/, "");
  if (path === "") return routes.home;
  return pageEntries.find((entry) => path === entry || path.startsWith(`${entry}/`)) ?? null;
}
