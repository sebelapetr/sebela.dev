import { connection } from "next/server";

import { websiteHealthResponse } from "../../modules/health";

/** The website's health for uptime monitoring, checked per request, never at build time. */
export async function GET(): Promise<Response> {
  await connection();
  return websiteHealthResponse();
}
