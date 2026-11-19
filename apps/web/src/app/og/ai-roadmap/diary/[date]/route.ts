import { connection } from "next/server";

import { getRoadmapDiaryDay } from "../../../../../modules/profile";
import { diaryDayPageFacts } from "../../../../../modules/roadmap";
import { notFoundResponse, roadmapOpenGraphImageResponse } from "../../../../../modules/seo";

/**
 * A diary day's Open Graph preview image; read on every request, never at build time. A day
 * without a record has no image; one that cannot be read now gets the site's roadmap card.
 */
export async function GET(
  _request: Request,
  { params }: { readonly params: Promise<{ readonly date: string }> },
): Promise<Response> {
  await connection();
  const { date } = await params;
  const result = await getRoadmapDiaryDay(date);
  if (result.status === "missing") return notFoundResponse();
  return roadmapOpenGraphImageResponse(
    result.status === "ready" ? diaryDayPageFacts(result.content) : null,
  );
}
