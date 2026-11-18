import { connection } from "next/server";

import { getRoadmapArea } from "../../../../modules/profile";
import { roadmapPageFacts } from "../../../../modules/roadmap";
import { notFoundResponse, roadmapOpenGraphImageResponse } from "../../../../modules/seo";

/**
 * An AI Roadmap area's Open Graph preview image; read on every request, never at build time. An
 * area that does not exist has no image; one that cannot be read now gets the site's roadmap card.
 */
export async function GET(
  _request: Request,
  { params }: { readonly params: Promise<{ readonly area: string }> },
): Promise<Response> {
  await connection();
  const { area } = await params;
  const result = await getRoadmapArea(area);
  if (result.status === "missing") return notFoundResponse();
  return roadmapOpenGraphImageResponse(
    result.status === "ready" ? roadmapPageFacts(result.content) : null,
  );
}
