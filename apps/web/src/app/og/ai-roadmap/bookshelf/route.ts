import { connection } from "next/server";

import { getRoadmapBookshelf } from "../../../../modules/profile";
import { bookshelfPageFacts } from "../../../../modules/roadmap";
import { notFoundResponse, roadmapOpenGraphImageResponse } from "../../../../modules/seo";

/**
 * The bookshelf's Open Graph preview image; read on every request, never at build time. Without a
 * published profile there is no image; a bookshelf that cannot be read now gets the site's roadmap
 * card.
 */
export async function GET(): Promise<Response> {
  await connection();
  const result = await getRoadmapBookshelf();
  if (result.status === "missing") return notFoundResponse();
  return roadmapOpenGraphImageResponse(
    result.status === "ready" ? bookshelfPageFacts(result.content) : null,
  );
}
