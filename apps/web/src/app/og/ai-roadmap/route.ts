import { connection } from "next/server";

import { getRoadmap } from "../../../modules/profile";
import { overviewPageFacts } from "../../../modules/roadmap";
import { notFoundResponse, roadmapOpenGraphImageResponse } from "../../../modules/seo";

/**
 * The AI Roadmap overview's Open Graph preview image; read on every request, never at build time. Without a
 * published profile there is no image; an overview that cannot be read now gets the site's roadmap card.
 */
export async function GET(): Promise<Response> {
  await connection();
  const result = await getRoadmap();
  if (result.status === "missing") return notFoundResponse();
  return roadmapOpenGraphImageResponse(
    result.status === "ready" ? overviewPageFacts(result.content) : null,
  );
}
