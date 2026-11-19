import { connection } from "next/server";

import { getRoadmapEvents } from "../../../../modules/profile";
import { eventsPageFacts } from "../../../../modules/roadmap";
import { notFoundResponse, roadmapOpenGraphImageResponse } from "../../../../modules/seo";

/**
 * The events page's Open Graph preview image; read on every request, never at build time. Without a
 * published profile there is no image; events that cannot be read now gets the site's roadmap card.
 */
export async function GET(): Promise<Response> {
  await connection();
  const result = await getRoadmapEvents();
  if (result.status === "missing") return notFoundResponse();
  return roadmapOpenGraphImageResponse(
    result.status === "ready" ? eventsPageFacts(result.content) : null,
  );
}
