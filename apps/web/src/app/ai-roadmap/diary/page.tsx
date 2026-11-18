import type { Metadata } from "next";

import { RoadmapSectionPlaceholderTemplate, roadmapSectionName } from "../../../modules/roadmap";

// A placeholder until the section is published; kept out of search results until then.
export const metadata: Metadata = {
  title: `${roadmapSectionName("diary")} — AI Roadmap`,
  robots: { index: false },
};

export default function RoadmapSectionPage() {
  return <RoadmapSectionPlaceholderTemplate section="diary" />;
}
