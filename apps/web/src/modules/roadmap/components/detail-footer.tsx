import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";

import { buttonVariants } from "@sebela/ui/components/button";
import { cn } from "@sebela/ui/lib/utils";

import type { RoadmapCrumb } from "../data/detail";
import { ROADMAP_PATH } from "../data/overview";

/**
 * The end of an area's or a module's own page: on an area's page the areas before and after it in
 * the roadmap's order (a navigation named "Adjacent learning areas", each a 44 px link with its
 * direction in `type-label` above the name), then "Go to full roadmap" as the primary button.
 */
export function DetailFooter({
  previous,
  next,
}: {
  readonly previous?: RoadmapCrumb | null;
  readonly next?: RoadmapCrumb | null;
}) {
  return (
    <div className="flex flex-col gap-8">
      {previous || next ? (
        <nav
          aria-label="Adjacent learning areas"
          className="grid gap-4 border-t border-border pt-6 sm:grid-cols-2"
        >
          {previous ? <AdjacentLink crumb={previous} direction="previous" /> : null}
          {next ? <AdjacentLink crumb={next} direction="next" /> : null}
        </nav>
      ) : null}
      <div>
        <Link href={ROADMAP_PATH} prefetch={false} className={buttonVariants()}>
          Go to full roadmap
          <ArrowRight aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

function AdjacentLink({
  crumb,
  direction,
}: {
  readonly crumb: RoadmapCrumb;
  readonly direction: "previous" | "next";
}) {
  const next = direction === "next";
  return (
    <Link
      href={crumb.href}
      prefetch={false}
      className={cn(
        "group flex min-h-11 flex-col gap-1 rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        next && "sm:col-start-2 sm:items-end sm:text-right",
      )}
    >
      <span className="type-label">{next ? "Next area" : "Previous area"}</span>{" "}
      <span className="inline-flex items-center gap-1 font-medium wrap-anywhere underline-offset-4 group-hover:underline group-focus-visible:underline">
        {next ? null : <ArrowLeft aria-hidden="true" className="size-4 shrink-0" />}
        {crumb.name}
        {next ? <ArrowRight aria-hidden="true" className="size-4 shrink-0" /> : null}
      </span>
    </Link>
  );
}
