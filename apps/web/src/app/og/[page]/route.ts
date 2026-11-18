import { connection } from "next/server";

import { isPreviewPage, notFoundResponse, openGraphImageResponse } from "../../../modules/seo";

/** An indexed page's Open Graph preview image; read on every request, never at build time. */
export async function GET(
  _request: Request,
  { params }: { readonly params: Promise<{ readonly page: string }> },
): Promise<Response> {
  await connection();
  const { page } = await params;
  if (!isPreviewPage(page)) {
    return notFoundResponse();
  }
  return openGraphImageResponse(page);
}
