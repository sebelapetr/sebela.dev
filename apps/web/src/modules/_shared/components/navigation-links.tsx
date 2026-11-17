import Link from "next/link";

import { buttonVariants } from "@sebela/ui/components/button";
import { cn } from "@sebela/ui/lib/utils";

import { askRoute, navigationItems } from "../navigation";
import { routes } from "../site";

/** `aria-current` for a link to `href` when it is the current entry. */
function currentFor(href: string, current: string | null): "page" | undefined {
  return href === current ? "page" : undefined;
}

/** The name that leads home; "Home" when the profile could not be read. */
export function HomeLink({
  name,
  current,
  onNavigate,
}: {
  readonly name: string | null;
  readonly current: string | null;
  readonly onNavigate?: () => void;
}) {
  return (
    <Link
      href={routes.home}
      prefetch={false}
      aria-current={currentFor(routes.home, current)}
      onClick={() => onNavigate?.()}
      className="inline-flex min-h-11 min-w-11 items-center truncate font-semibold tracking-tight"
    >
      {name ?? "Home"}
    </Link>
  );
}

/** The "Ask AI" button. */
export function AskLink({
  current,
  onNavigate,
}: {
  readonly current: string | null;
  readonly onNavigate?: () => void;
}) {
  return (
    <Link
      href={askRoute}
      prefetch={false}
      aria-current={currentFor(askRoute, current)}
      onClick={() => onNavigate?.()}
      className={cn(buttonVariants())}
    >
      Ask AI
    </Link>
  );
}

/**
 * The navigation's items as a list. The current page's item is foreground and underlined, the
 * others muted until hovered. `stacked` lays them out for the mobile menu.
 */
export function NavigationList({
  current,
  stacked = false,
  onNavigate,
}: {
  readonly current: string | null;
  readonly stacked?: boolean;
  readonly onNavigate?: () => void;
}) {
  return (
    <ul className={stacked ? "flex flex-col" : "flex items-center gap-1"}>
      {navigationItems.map((item) => (
        <li key={item.href}>
          <Link
            href={item.href}
            prefetch={false}
            aria-current={currentFor(item.href, current)}
            onClick={() => onNavigate?.()}
            className={cn(
              "inline-flex min-h-11 items-center text-muted-foreground underline-offset-8 decoration-2 hover:text-foreground aria-[current=page]:text-foreground aria-[current=page]:underline",
              // Stacked, the items line up with the name above them.
              stacked ? "w-full text-2xl font-semibold tracking-tight" : "px-3 text-sm font-medium",
            )}
          >
            {item.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}
