import Link from "next/link";

import { ProseMarkdown } from "../../_shared";
import type { RoadmapAreaContent } from "../../profile";
import { EstimateBadge, ProgressBadge, WeightIndicator } from "../components/badges";
import { DetailHeader } from "../components/detail-header";
import { RoadmapFrame } from "../components/roadmap-frame";
import { StatusLabel } from "../components/status-label";
import { toRoadmapAreaPage } from "../data/detail";

/**
 * An area's own page under the roadmap's sub-navigation: the way from the overview, the area's
 * name, status, planned estimate, progress and weight, its description, then its modules in the
 * API's order as numbered rows, each linking to the module's own page. Without modules the page
 * says so.
 */
export function RoadmapAreaTemplate({ content }: { readonly content: RoadmapAreaContent }) {
  const page = toRoadmapAreaPage(content.area);
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
        />
        <section aria-labelledby="area-modules-heading" className="flex flex-col gap-6">
          <h2 id="area-modules-heading" className="type-heading">
            Modules
          </h2>
          {page.modules.length === 0 ? (
            <p className="text-base text-muted-foreground">No modules yet.</p>
          ) : (
            <ol className="flex flex-col">
              {page.modules.map((module) => (
                <li
                  key={module.slug}
                  className="grid gap-2 border-t border-border py-6 sm:grid-cols-[3rem_minmax(0,1fr)] sm:gap-4"
                >
                  <span aria-hidden="true" className="type-label pt-3">
                    {module.order}
                  </span>
                  <div className="flex min-w-0 flex-col gap-2">
                    <h3 className="type-item wrap-anywhere">
                      <Link
                        href={module.href}
                        prefetch={false}
                        className="inline-flex min-h-11 items-center rounded-sm underline-offset-4 hover:underline focus-visible:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                      >
                        {module.name}
                      </Link>
                    </h3>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusLabel status={module.status} />
                      {module.estimate === null ? null : (
                        <EstimateBadge estimate={module.estimate} />
                      )}
                      <ProgressBadge completed={module.completed} total={module.total} />
                    </div>
                    {module.description === null ? null : (
                      <div className="text-sm wrap-anywhere text-muted-foreground [&>*+*]:mt-2">
                        <ProseMarkdown>{module.description}</ProseMarkdown>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </RoadmapFrame>
  );
}
