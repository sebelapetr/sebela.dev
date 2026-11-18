import { connection } from "next/server";

import { getRoadmapModule } from "../../../../../modules/profile";
import { roadmapPageFacts } from "../../../../../modules/roadmap";
import { notFoundResponse, roadmapOpenGraphImageResponse } from "../../../../../modules/seo";

/**
 * An AI Roadmap module's Open Graph preview image; read on every request, never at build time. A
 * module that does not exist, or lies under another area, has no image; one that cannot be read now
 * gets the site's roadmap card.
 */
export async function GET(
  _request: Request,
  { params }: { readonly params: Promise<{ readonly area: string; readonly module: string }> },
): Promise<Response> {
  await connection();
  const { area, module: moduleSlug } = await params;
  const result = await getRoadmapModule(area, moduleSlug);
  if (result.status === "missing") return notFoundResponse();
  return roadmapOpenGraphImageResponse(
    result.status === "ready" ? roadmapPageFacts(result.content) : null,
  );
}
