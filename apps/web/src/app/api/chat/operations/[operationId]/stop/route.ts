import { connection } from "next/server";

import { relayChatRequest } from "../../../../../../modules/chat-relay";

/** Stops one of the caller's answers, relayed to the API without a body. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ operationId: string }> },
): Promise<Response> {
  await connection();
  const { operationId } = await params;
  return relayChatRequest(request, { kind: "stop", operationId });
}
