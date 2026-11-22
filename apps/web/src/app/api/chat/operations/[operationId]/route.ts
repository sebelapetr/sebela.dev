import { connection } from "next/server";

import { relayChatRequest } from "../../../../../modules/chat-relay";

/** The state of one of the caller's questions, relayed to the API. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ operationId: string }> },
): Promise<Response> {
  await connection();
  const { operationId } = await params;
  return relayChatRequest(request, { kind: "operation", operationId });
}
