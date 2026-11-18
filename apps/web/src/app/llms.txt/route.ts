import { connection } from "next/server";

import { llmsTxtResponse } from "../../modules/seo";

/** llms.txt from the profile; read on every request, never at build time (caching is #56). */
export async function GET(): Promise<Response> {
  await connection();
  return llmsTxtResponse();
}
