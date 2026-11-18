import { connection } from "next/server";

import { robotsResponse } from "../../modules/seo";

/** robots.txt on the canonical origin, which is read at runtime, never at build time. */
export async function GET(): Promise<Response> {
  await connection();
  return robotsResponse();
}
