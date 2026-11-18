import { connection } from "next/server";

import { sitemapResponse } from "../../modules/seo";

/** The sitemap of the indexed pages; read on every request, never at build time (caching is #56). */
export async function GET(): Promise<Response> {
  await connection();
  return sitemapResponse();
}
