import { roadmapStructuredData, type RoadmapPageFacts } from "../data/roadmap-page";
import { serializeJsonLd } from "../data/structured-data";
import { siteOrigin } from "../data/site-origin";

/**
 * An AI Roadmap page's schema.org JSON-LD on the canonical origin: the page and its breadcrumbs.
 * Serialized so that no name from the roadmap can close the script element.
 */
export function RoadmapStructuredData({ facts }: { readonly facts: RoadmapPageFacts }) {
  const json = serializeJsonLd(roadmapStructuredData(siteOrigin(), facts));
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
