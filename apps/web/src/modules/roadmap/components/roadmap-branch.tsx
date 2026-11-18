"use client";

import { useState, type ReactNode } from "react";

import { TimelineContent, TimelineItem, TimelineTrigger } from "@sebela/ui/components/timeline";
import { cn } from "@sebela/ui/lib/utils";

import { ROADMAP_ITEM, ROADMAP_MARKER } from "./layout";

/**
 * An area or a module on the roadmap's timeline: its heading row opens and closes it, its
 * description stays below the row (cut to two lines while a long one is closed, with "Show more"
 * to open the item), and its content holds the next level. Open state is kept here, so "Show more"
 * and the row open the same item.
 */
export function RoadmapBranch({
  slug,
  level,
  name,
  markerClassName,
  heading,
  description,
  longDescription,
  children,
}: {
  readonly slug: string;
  readonly level: 2 | 3;
  /** The item's name, so "Show more" says what it shows more of. */
  readonly name: string;
  readonly markerClassName: string;
  /** The heading row's phrasing content. */
  readonly heading: ReactNode;
  readonly description: ReactNode;
  readonly longDescription: boolean;
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const Heading = level === 2 ? "h2" : "h3";
  const clamped = longDescription && !open;
  return (
    <TimelineItem open={open} onOpenChange={setOpen} className={ROADMAP_ITEM}>
      <div data-roadmap-slug={slug}>
        <Heading>
          <TimelineTrigger
            className="mx-0 w-full gap-2 px-2 py-2 hover:bg-muted/50 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-3"
            markerClassName={cn(ROADMAP_MARKER, markerClassName)}
          >
            {heading}
          </TimelineTrigger>
        </Heading>
        {description === null ? null : (
          <div className="mt-1 ml-2 text-sm text-muted-foreground sm:ml-7">
            <div className={cn("wrap-anywhere [&>*+*]:mt-2", clamped && "line-clamp-2")}>
              {description}
            </div>
            {clamped ? (
              <button
                type="button"
                onClick={() => {
                  setOpen(true);
                }}
                className="inline-flex min-h-11 items-center font-medium text-foreground/70 underline underline-offset-2 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                Show more<span className="sr-only"> about {name}</span>
              </button>
            ) : null}
          </div>
        )}
      </div>
      <TimelineContent>{children}</TimelineContent>
    </TimelineItem>
  );
}
