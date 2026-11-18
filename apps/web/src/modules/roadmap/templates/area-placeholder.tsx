import type { RoadmapContent } from "../../profile";
import { Placeholder } from "../components/placeholder";
import { RoadmapFrame } from "../components/roadmap-frame";
import type { RoadmapAreaHeading } from "../data/overview";

/**
 * An area's own address until its page is published: the area's number and name, a sentence that
 * its page is not here yet and the way back to the overview, where its modules and resources are.
 */
export function RoadmapAreaPlaceholderTemplate({
  content,
  area,
}: {
  readonly content: RoadmapContent;
  readonly area: RoadmapAreaHeading;
}) {
  return (
    <RoadmapFrame name={content.name} section="roadmap">
      <Placeholder label={`Area ${area.order.replace(/\.$/u, "")}`} heading={area.name}>
        This area&apos;s own page is not published yet. Its modules and resources are on the roadmap
        overview.
      </Placeholder>
    </RoadmapFrame>
  );
}
