import { Timeline } from "@sebela/ui/components/timeline";

import type { RoadmapModuleContent } from "../../profile";
import { DetailFooter } from "../components/detail-footer";
import { DetailHeader } from "../components/detail-header";
import { ROADMAP_TIMELINE } from "../components/layout";
import { ResourceItem } from "../components/resource-item";
import { RoadmapFrame } from "../components/roadmap-frame";
import { toRoadmapModulePage } from "../data/detail";

/**
 * A module's own page under the roadmap's sub-navigation: the way from the overview through its
 * area, the module's name, status, planned estimate and progress, its description and last change,
 * then its resources in the API's order on the timeline, each with the anchor a source link lands
 * on, and the way back to the full roadmap. Without resources the page says so.
 */
export function RoadmapModuleTemplate({ content }: { readonly content: RoadmapModuleContent }) {
  const page = toRoadmapModulePage(content.area, content.module);
  return (
    <RoadmapFrame name={content.name} section="roadmap">
      <div className="flex max-w-3xl flex-col gap-12">
        <DetailHeader
          kind={`Module of ${page.area.name}`}
          name={page.name}
          breadcrumbs={page.breadcrumbs}
          status={page.status}
          current={page.current}
          estimate={page.estimate}
          completed={page.completed}
          total={page.total}
          description={page.description}
          updated={page.updated}
        />
        <section aria-labelledby="module-resources-heading" className="flex flex-col gap-6">
          <h2 id="module-resources-heading" className="type-heading">
            Resources
          </h2>
          {page.resources.length === 0 ? (
            <p className="text-base text-muted-foreground">No resources yet.</p>
          ) : (
            <Timeline aria-label={`Resources of ${page.name}`} className={ROADMAP_TIMELINE}>
              {page.resources.map((resource) => (
                <ResourceItem
                  key={resource.slug}
                  resource={resource}
                  anchor={resource.anchor}
                  level={3}
                />
              ))}
            </Timeline>
          )}
        </section>
        <DetailFooter />
      </div>
    </RoadmapFrame>
  );
}
