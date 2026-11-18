import { connection } from "next/server";

import { sitemapResponse } from "../../modules/seo";

/** The sitemap of the indexed pages, rendered per request from the content cache. */
export async function GET(): Promise<Response> {
  await connection();
  return sitemapResponse();
}
