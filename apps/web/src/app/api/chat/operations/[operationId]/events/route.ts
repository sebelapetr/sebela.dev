import { connection } from "next/server";

import { relayChatRequest } from "../../../../../../modules/chat-relay";

/** The event stream of one of the caller's questions, relayed unbuffered from the API. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ operationId: string }> },
): Promise<Response> {
  await connection();
  const { operationId } = await params;
  return relayChatRequest(request, { kind: "events", operationId });
}
