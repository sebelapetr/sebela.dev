import { connection } from "next/server";

import { relayChatRequest } from "../../../../modules/chat-relay";

/**
 * The caller's own usage, limits and last context measurement, relayed to the API with the
 * visitor's cookie. Reading it never consumes an operation.
 */
export async function GET(request: Request): Promise<Response> {
  await connection();
  return relayChatRequest(request, { kind: "usage" });
}
