import { connection } from "next/server";

import { llmsTxtResponse } from "../../modules/seo";

/** llms.txt from the profile, rendered per request from the content cache, never at build time. */
export async function GET(): Promise<Response> {
  await connection();
  return llmsTxtResponse();
}
