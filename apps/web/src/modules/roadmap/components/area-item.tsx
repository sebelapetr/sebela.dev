import { Timeline } from "@sebela/ui/components/timeline";
import { cn } from "@sebela/ui/lib/utils";

import { ProseMarkdown } from "../../_shared";
import type { AreaRow } from "../data/overview";
import { CurrentBadge, ProgressBadge, WeightIndicator } from "./badges";
import { ModuleItem } from "./module-item";
import { RoadmapBranch, ROADMAP_TIMELINE } from "./roadmap-branch";
import { triggerMarker } from "./status";

/** An area's description longer than this is cut to two lines while the area is closed. */
const DESCRIPTION_LIMIT = 160;

/**
 * One area of the roadmap: its number and name, "Current" while it is in progress, its weight and
 * its progress, its description, and its modules when it is opened.
 */
export function AreaItem({ area }: { readonly area: AreaRow }) {
  const dimmed = area.status === "planned" && "opacity-60";
  return (
    <RoadmapBranch
      slug={area.slug}
      level={2}
      name={area.name}
      markerClassName={triggerMarker(area.status)}
      longDescription={(area.description?.length ?? 0) > DESCRIPTION_LIMIT}
      description={
        area.description === null ? null : <ProseMarkdown>{area.description}</ProseMarkdown>
      }
      heading={
        <>
          <span className={cn("flex min-w-0 flex-wrap items-center gap-2", dimmed)}>
            <span className="min-w-0 text-lg leading-snug font-medium wrap-anywhere sm:text-xl">
              <span aria-hidden="true" className="mr-2 text-muted-foreground">
                {area.order}
              </span>
              {area.name}
            </span>
            {area.current ? <CurrentBadge /> : null}
            <WeightIndicator
              weight={area.weight}
              level={area.weightLevel}
              label={area.weightLabel}
            />
          </span>
          <span
            className={cn(
              "flex flex-wrap items-center gap-2 self-start sm:flex-nowrap sm:self-auto",
              dimmed,
            )}
          >
            <ProgressBadge completed={area.completed} total={area.total} />
          </span>
        </>
      }
    >
      {area.modules.length === 0 ? (
        <p className="ml-2 text-sm text-muted-foreground sm:ml-3">No modules yet.</p>
      ) : (
        <Timeline aria-label={`Modules of ${area.name}`} className={ROADMAP_TIMELINE}>
          {area.modules.map((module) => (
            <ModuleItem key={module.slug} module={module} />
          ))}
        </Timeline>
      )}
    </RoadmapBranch>
  );
}
