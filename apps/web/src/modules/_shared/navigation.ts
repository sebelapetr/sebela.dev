// The site's navigation: the header's items and which of them the current page is.

import { routes } from "./site";

/** One link of the navigation. */
export interface NavigationItem {
  readonly label: string;
  readonly href: string;
}

/** The navigation's links in their order, after the name that leads home. */
export const navigationItems: readonly NavigationItem[] = [];

/** Where the header's "Ask AI" button leads. */
export const askRoute: string = routes.home;

/**
 * The address of the navigation entry the page at `pathname` belongs to — an item, the name
 * (`/`) or Ask AI — or null for a page outside the navigation. Contact is never current: it is a
 * block of the homepage, not a page.
 */
export const currentNavigationHref: (pathname: string | null) => string | null = () => {
  throw new Error("not implemented");
};
