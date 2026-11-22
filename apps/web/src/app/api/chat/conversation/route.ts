import { connection } from "next/server";

import { relayChatRequest } from "../../../../modules/chat-relay";

/** The caller's own conversation, a page at a time, relayed to the API with the visitor's cookie. */
export async function GET(request: Request): Promise<Response> {
  await connection();
  return relayChatRequest(request, { kind: "conversation" });
}
