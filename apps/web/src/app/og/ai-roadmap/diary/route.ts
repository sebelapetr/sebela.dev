import { connection } from "next/server";

import { getRoadmapDiary } from "../../../../modules/profile";
import { diaryPageFacts } from "../../../../modules/roadmap";
import { notFoundResponse, roadmapOpenGraphImageResponse } from "../../../../modules/seo";

/**
 * The learning diary's Open Graph preview image; read on every request, never at build time. Without a
 * published profile there is no image; a diary that cannot be read now gets the site's roadmap card.
 */
export async function GET(): Promise<Response> {
  await connection();
  const result = await getRoadmapDiary();
  if (result.status === "missing") return notFoundResponse();
  return roadmapOpenGraphImageResponse(
    result.status === "ready" ? diaryPageFacts(result.content) : null,
  );
}
