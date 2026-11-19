import type { ReactNode } from "react";

import { Footer, mainContentId, SiteHeader } from "../../_shared";
import { RoadmapNav, type RoadmapSection } from "./roadmap-nav";

/**
 * The frame of every AI Roadmap page: the site header, the roadmap's sub-navigation under it, the
 * page's main content in the page frame and the footer.
 */
export function RoadmapFrame({
  name,
  section,
  children,
}: {
  /** The person's name. */
  readonly name: string;
  readonly section: RoadmapSection;
  readonly children: ReactNode;
}) {
  return (
    <>
      <SiteHeader name={name} />
      <RoadmapNav current={section} />
      <main id={mainContentId} className="layout-page flex flex-1 flex-col py-12 sm:py-16">
        {children}
      </main>
      <Footer name={name} />
    </>
  );
}
