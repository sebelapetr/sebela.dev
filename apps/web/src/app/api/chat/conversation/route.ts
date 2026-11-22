import { connection } from "next/server";

import { relayChatRequest } from "../../../../modules/chat-relay";

/** The caller's own conversation, a page at a time, relayed to the API with the visitor's cookie. */
export async function GET(request: Request): Promise<Response> {
  await connection();
  return relayChatRequest(request, { kind: "conversation" });
}

/**
 * Clears the caller's conversation the visitor confirmed (its ID in the body), relayed to the API
 * with the visitor's cookie; the cookie decides whose it is, never an address.
 */
export async function DELETE(request: Request): Promise<Response> {
  await connection();
  return relayChatRequest(request, { kind: "clear" });
}
