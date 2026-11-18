import { Check } from "lucide-react";

import { TimelineMarker } from "@sebela/ui/components/timeline";
import { cn } from "@sebela/ui/lib/utils";

import { ProseMarkdown } from "../../_shared";
import type { ResourceRow } from "../data/overview";
import { EstimateBadge, TypeBadge } from "./badges";
import { ROADMAP_ITEM, ROADMAP_MARKER } from "./layout";
import { ResourceIcon } from "./resource-icon";
import { resourceMarker, resourceStatusWords } from "./status";

/**
 * One resource on a module's timeline: its type icon in a marker coloured by its status, its name
 * (a link that opens in a new tab when it has a safe address), its status for screen readers, its
 * type and its estimate, then its description. On its module's own page it carries its anchor, so
 * a source link lands on it (and highlights it), and its heading is one level higher.
 */
export function ResourceItem({
  resource,
  anchor,
  level = 4,
}: {
  readonly resource: ResourceRow;
  /** The id a source link lands on; only the module's own page has it. */
  readonly anchor?: string;
  readonly level?: 3 | 4;
}) {
  const Heading = level === 3 ? "h3" : "h4";
  return (
    <li
      id={anchor}
      tabIndex={anchor === undefined ? undefined : -1}
      className={cn(
        "relative",
        ROADMAP_ITEM,
        anchor !== undefined &&
          "anchor-target rounded-lg focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none target:bg-muted/60",
      )}
      data-roadmap-slug={resource.slug}
    >
      <TimelineMarker className={cn(ROADMAP_MARKER, resourceMarker(resource.status))}>
        <ResourceIcon type={resource.type} />
      </TimelineMarker>
      <div className="flex w-full flex-col items-stretch gap-2 rounded-lg px-2 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-3">
        <Heading className="flex min-w-0 flex-wrap items-center gap-x-2 text-base leading-snug font-medium wrap-anywhere">
          {resource.href === null ? (
            <span>{resource.name}</span>
          ) : (
            <a
              href={resource.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center rounded-sm hover:underline focus-visible:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <span>
                {resource.name}
                <span className="sr-only"> (opens in a new tab)</span>
              </span>
            </a>
          )}
          {resource.status === "completed" ? (
            <Check aria-hidden="true" strokeWidth={3} className="size-3 shrink-0" />
          ) : null}
          <span className="sr-only">, {resourceStatusWords(resource.status)}</span>
        </Heading>
        <div className="flex flex-wrap items-center gap-2 self-start sm:flex-nowrap sm:self-auto">
          <TypeBadge label={resource.typeLabel} />
          {resource.estimate === null ? null : <EstimateBadge estimate={resource.estimate} />}
        </div>
      </div>
      {resource.description === null ? null : (
        <div className="mt-1 ml-2 text-sm wrap-anywhere text-muted-foreground sm:ml-8 [&>*+*]:mt-2">
          <ProseMarkdown>{resource.description}</ProseMarkdown>
        </div>
      )}
    </li>
  );
}
