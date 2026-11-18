import Link from "next/link";
import { ChevronRight } from "lucide-react";

import type { RoadmapCrumb } from "../data/detail";

/**
 * The way from the roadmap's overview to the page, as a "Breadcrumb" navigation: every step but the
 * last a 44 px text link, the last the current page, named so for assistive technology.
 */
export function Breadcrumbs({ crumbs }: { readonly crumbs: readonly RoadmapCrumb[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-x-1 text-sm text-muted-foreground">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <li key={crumb.href} className="flex min-w-0 items-center gap-1">
              {last ? (
                <span
                  aria-current="page"
                  className="py-3 font-medium wrap-anywhere text-foreground"
                >
                  {crumb.name}
                </span>
              ) : (
                <>
                  <Link
                    href={crumb.href}
                    prefetch={false}
                    className="inline-flex min-h-11 items-center rounded-sm wrap-anywhere underline-offset-4 hover:text-foreground hover:underline focus-visible:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    {crumb.name}
                  </Link>
                  <ChevronRight aria-hidden="true" className="size-3.5 shrink-0" />
                </>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
