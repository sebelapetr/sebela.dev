import { connection } from "next/server";

import { isPreviewPage, openGraphImageResponse } from "../../../modules/seo";

/** An indexed page's Open Graph preview image; read on every request, never at build time. */
export async function GET(
  _request: Request,
  { params }: { readonly params: Promise<{ readonly page: string }> },
): Promise<Response> {
  await connection();
  const { page } = await params;
  if (!isPreviewPage(page)) {
    return new Response("Not found.\n", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": "noindex" },
    });
  }
  return openGraphImageResponse(page);
}
