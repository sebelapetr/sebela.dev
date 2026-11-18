import { Timeline } from "@sebela/ui/components/timeline";

import type { RoadmapAreaContent } from "../../profile";
import { WeightIndicator } from "../components/badges";
import { DetailFooter } from "../components/detail-footer";
import { DetailHeader } from "../components/detail-header";
import { ROADMAP_TIMELINE } from "../components/layout";
import { ModuleItem } from "../components/module-item";
import { RoadmapFrame } from "../components/roadmap-frame";
import { toRoadmapAreaPage } from "../data/detail";

/**
 * An area's own page under the roadmap's sub-navigation: the way from the overview, the area's
 * name, status, planned estimate, progress and weight, its description and last change, then its
 * modules in the API's order on the timeline as the overview shows them (each opens to its
 * resources and leads to the module's own page), then the areas before and after it and the way
 * back to the full roadmap. Without modules the page says so.
 */
export function RoadmapAreaTemplate({ content }: { readonly content: RoadmapAreaContent }) {
  const page = toRoadmapAreaPage(content.area, content.areas);
  return (
    <RoadmapFrame name={content.name} section="roadmap">
      <div className="flex max-w-3xl flex-col gap-12">
        <DetailHeader
          kind="Area"
          name={page.name}
          breadcrumbs={page.breadcrumbs}
          status={page.status}
          current={page.current}
          estimate={page.estimate}
          completed={page.completed}
          total={page.total}
          extra={
            <WeightIndicator
              weight={page.weight}
              level={page.weightLevel}
              label={page.weightLabel}
            />
          }
          description={page.description}
          updated={page.updated}
        />
        <section aria-labelledby="area-modules-heading" className="flex flex-col gap-6">
          <h2 id="area-modules-heading" className="type-heading">
            Modules
          </h2>
          {page.modules.length === 0 ? (
            <p className="text-base text-muted-foreground">No modules yet.</p>
          ) : (
            <Timeline aria-label={`Modules of ${page.name}`} className={ROADMAP_TIMELINE}>
              {page.modules.map((module) => (
                <ModuleItem key={module.slug} module={module} />
              ))}
            </Timeline>
          )}
        </section>
        <DetailFooter previous={page.previous} next={page.next} />
      </div>
    </RoadmapFrame>
  );
}
