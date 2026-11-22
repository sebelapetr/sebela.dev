import { connection } from "next/server";

import { relayChatRequest } from "../../../../../modules/chat-relay";

/** A new question with its person-check token, relayed to the API. */
export async function POST(request: Request): Promise<Response> {
  await connection();
  return relayChatRequest(request, { kind: "messages" });
}
