import { NextResponse, type NextRequest } from "next/server";

/**
 * Runs before every page, route and asset the website answers (except Next's built files) and adds
 * the indexing decision's response headers: `X-Robots-Tag` unless `WEB_INDEXING` is on.
 */
export function proxy(request: NextRequest): NextResponse {
  throw new Error(`not implemented: ${request.nextUrl.pathname}`);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
