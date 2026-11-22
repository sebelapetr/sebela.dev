import { connection } from "next/server";

import { relayChatRequest } from "../../../../../../modules/chat-relay";

/** Asks one of the caller's failed answers again under its retry ID, relayed to the API. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ operationId: string }> },
): Promise<Response> {
  await connection();
  const { operationId } = await params;
  return relayChatRequest(request, { kind: "retry", operationId });
}
