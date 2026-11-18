import type { Metadata } from "next";

import { RoadmapSectionPlaceholderTemplate, roadmapSectionName } from "../../../modules/roadmap";

// A placeholder until the section is published; kept out of search results until then.
export const metadata: Metadata = {
  title: `${roadmapSectionName("events")} — AI Roadmap`,
  robots: { index: false },
};

export default function RoadmapSectionPage() {
  return <RoadmapSectionPlaceholderTemplate section="events" />;
}
