import { Placeholder } from "../components/placeholder";
import { RoadmapFrame } from "../components/roadmap-frame";
import type { RoadmapSection } from "../components/roadmap-nav";

const SECTIONS = {
  events: "Events",
} as const satisfies Partial<Record<RoadmapSection, string>>;

/** A roadmap section that is not published yet: the events. */
export type RoadmapPlaceholderSection = keyof typeof SECTIONS;

/** The section's name, as its page and its title name it. */
export function roadmapSectionName(section: RoadmapPlaceholderSection): string {
  return SECTIONS[section];
}

/**
 * A roadmap section's address until it is published: its name, a sentence that it is not here
 * yet and the way back to the overview. It reads no content, so it shows while the API is down.
 */
export function RoadmapSectionPlaceholderTemplate({
  section,
}: {
  readonly section: RoadmapPlaceholderSection;
}) {
  const name = SECTIONS[section];
  return (
    <RoadmapFrame name={null} section={section}>
      <Placeholder label="AI Roadmap" heading={name}>
        The {name} is not published yet. Until then, the roadmap overview shows what I am learning.
      </Placeholder>
    </RoadmapFrame>
  );
}
