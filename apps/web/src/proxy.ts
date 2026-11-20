import { NextResponse } from "next/server";

import { indexingResponseHeaders } from "./modules/indexing";

/**
 * Runs before every page, route and asset the website answers (except Next's built files) and adds
 * the indexing decision's response headers: `X-Robots-Tag` unless `WEB_INDEXING` is on. The request
 * itself passes through unchanged.
 */
export function proxy(): NextResponse {
  const response = NextResponse.next();
  for (const [name, value] of Object.entries(indexingResponseHeaders())) {
    response.headers.set(name, value);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
