import Link from "next/link";
import { ArrowDown, ArrowRight } from "lucide-react";

import { Timeline } from "@sebela/ui/components/timeline";
import { buttonVariants } from "@sebela/ui/components/button";

import { routes } from "../../_shared";
import type { RoadmapContent } from "../../profile";
import { AreaItem } from "../components/area-item";
import { LearningApproach } from "../components/learning-approach";
import { ROADMAP_TIMELINE } from "../components/layout";
import { RoadmapFrame } from "../components/roadmap-frame";
import { SupportingSections } from "../components/supporting-sections";
import { roadmapLead, toRoadmapOverview } from "../data/overview";
import { toSupportingSections } from "../data/supporting";

/**
 * The AI Roadmap's overview under its sub-navigation: the title, what the roadmap holds (its
 * counts, planned hours and last update), the way to its first area and to who builds it, every
 * area with its modules and resources on the timeline, the learning approach, then the supporting
 * sections: the project ideas, the followed sources, the FAQ and the additional terms. Without
 * areas the page says so and still shows the supporting sections.
 */
export function RoadmapOverviewTemplate({ content }: { readonly content: RoadmapContent }) {
  const overview = toRoadmapOverview(content.roadmap);
  return (
    <RoadmapFrame name={content.name} section="roadmap">
      <div className="flex max-w-3xl flex-col gap-8">
        <header className="flex flex-col gap-4">
          <h1 className="type-title">AI Engineering Roadmap for Experienced Developers</h1>
          {overview.areas.length === 0 ? (
            <p className="text-base leading-7 text-muted-foreground">
              No roadmap areas are published yet.
            </p>
          ) : (
            <div className="flex flex-col gap-3 text-base leading-7 text-muted-foreground">
              <p>{roadmapLead(overview.facts)}</p>
              <div className="flex flex-wrap items-center gap-3">
                {overview.start === null ? null : (
                  <Link href={overview.start.href} prefetch={false} className={buttonVariants()}>
                    Start here: {overview.start.name}
                    <ArrowRight aria-hidden="true" />
                  </Link>
                )}
                <Link
                  href={routes.home}
                  className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:underline"
                >
                  Who&apos;s building this
                  <ArrowDown aria-hidden="true" className="size-3.5" />
                </Link>
              </div>
            </div>
          )}
        </header>
        {overview.areas.length === 0 ? null : (
          <>
            <section aria-label="Learning roadmap">
              <Timeline className={ROADMAP_TIMELINE}>
                {overview.areas.map((area) => (
                  <AreaItem key={area.slug} area={area} />
                ))}
              </Timeline>
            </section>
            <LearningApproach />
          </>
        )}
        <div className="mt-4 flex flex-col gap-12">
          <SupportingSections sections={toSupportingSections(content)} />
        </div>
      </div>
    </RoadmapFrame>
  );
}
