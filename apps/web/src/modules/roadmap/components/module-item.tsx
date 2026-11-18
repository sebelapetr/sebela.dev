import { Timeline } from "@sebela/ui/components/timeline";

import { ProseMarkdown } from "../../_shared";
import type { ModuleRow } from "../data/overview";
import { EstimateBadge, ProgressBadge } from "./badges";
import { ROADMAP_TIMELINE } from "./layout";
import { RoadmapBranch } from "./roadmap-branch";
import { ResourceItem } from "./resource-item";
import { triggerMarker } from "./status";

/** A module's description longer than this is cut to two lines while the module is closed. */
const DESCRIPTION_LIMIT = 100;

/**
 * One module in an area: its Roman number and name, its planned effort and its progress, its
 * description, and its resources when it is opened.
 */
export function ModuleItem({ module }: { readonly module: ModuleRow }) {
  return (
    <RoadmapBranch
      slug={module.slug}
      level={3}
      name={module.name}
      markerClassName={triggerMarker(module.status)}
      longDescription={(module.description?.length ?? 0) > DESCRIPTION_LIMIT}
      description={
        module.description === null ? null : <ProseMarkdown>{module.description}</ProseMarkdown>
      }
      heading={
        <>
          <span className="flex min-w-0 items-center gap-2 text-base leading-snug font-medium wrap-anywhere sm:text-xl">
            <span>
              <span aria-hidden="true" className="mr-2 text-muted-foreground">
                {module.order}
              </span>
              {module.name}
            </span>
          </span>
          <span className="flex flex-wrap items-center gap-2 self-start sm:flex-nowrap sm:self-auto">
            {module.estimate === null ? null : <EstimateBadge estimate={module.estimate} />}
            <ProgressBadge completed={module.completed} total={module.total} />
          </span>
        </>
      }
    >
      {module.resources.length === 0 ? (
        <p className="ml-2 text-sm text-muted-foreground sm:ml-3">No resources yet.</p>
      ) : (
        <Timeline aria-label={`Resources of ${module.name}`} className={ROADMAP_TIMELINE}>
          {module.resources.map((resource) => (
            <ResourceItem key={resource.slug} resource={resource} />
          ))}
        </Timeline>
      )}
    </RoadmapBranch>
  );
}
