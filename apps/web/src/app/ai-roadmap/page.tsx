import type { Metadata } from "next";

import { RoadmapPlaceholderTemplate } from "../../modules/content-states";

// A placeholder until phase 4 publishes the roadmap; kept out of search results until then.
export const metadata: Metadata = {
  title: "AI Roadmap",
  robots: { index: false },
};

export default function AiRoadmapPage() {
  return <RoadmapPlaceholderTemplate />;
}
