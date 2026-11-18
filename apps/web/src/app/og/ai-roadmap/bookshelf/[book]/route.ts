import { connection } from "next/server";

import { getRoadmapBook } from "../../../../../modules/profile";
import { bookPageFacts } from "../../../../../modules/roadmap";
import { notFoundResponse, roadmapOpenGraphImageResponse } from "../../../../../modules/seo";

/**
 * A book's Open Graph preview image; read on every request, never at build time. A book that does
 * not exist has no image; one that cannot be read now gets the site's roadmap card.
 */
export async function GET(
  _request: Request,
  { params }: { readonly params: Promise<{ readonly book: string }> },
): Promise<Response> {
  await connection();
  const { book } = await params;
  const result = await getRoadmapBook(book);
  if (result.status === "missing") return notFoundResponse();
  return roadmapOpenGraphImageResponse(
    result.status === "ready" ? bookPageFacts(result.content) : null,
  );
}
