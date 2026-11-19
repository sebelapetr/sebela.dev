import { connection } from "next/server";

import { getRoadmapReadingGuide } from "../../../../modules/profile";
import { readingGuidePageFacts } from "../../../../modules/roadmap";
import { notFoundResponse, roadmapOpenGraphImageResponse } from "../../../../modules/seo";

/**
 * The reading guide's Open Graph preview image; read on every request, never at build time. Without a
 * published profile there is no image; a guide whose person cannot be read now gets the site's roadmap card.
 */
export async function GET(): Promise<Response> {
  await connection();
  const result = await getRoadmapReadingGuide();
  if (result.status === "missing") return notFoundResponse();
  return roadmapOpenGraphImageResponse(
    result.status === "ready" ? readingGuidePageFacts(result.content) : null,
  );
}
