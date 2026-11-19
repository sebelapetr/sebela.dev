import { connection } from "next/server";

import { getRoadmapStatistics } from "../../../../../modules/profile";
import { statisticsPageFacts } from "../../../../../modules/roadmap";
import { notFoundResponse, roadmapOpenGraphImageResponse } from "../../../../../modules/seo";

/**
 * The learning statistics's Open Graph preview image; read on every request, never at build time. Without a
 * published profile there is no image; statistics that cannot be read now gets the site's roadmap card.
 */
export async function GET(): Promise<Response> {
  await connection();
  const result = await getRoadmapStatistics();
  if (result.status === "missing") return notFoundResponse();
  return roadmapOpenGraphImageResponse(
    result.status === "ready" ? statisticsPageFacts(result.content) : null,
  );
}
