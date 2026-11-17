// The Ask page's address of a conversation: `/ask?c=<id>`, where the identifier is random and the
// question is never part of it.
import { z } from "zod";

import { routes } from "../../_shared";

const ConversationIdSchema = z.uuid();

/** The Ask page's address of the conversation; the page itself (a new chat) without one. */
export function conversationHref(conversationId: string | null): string {
  return conversationId === null ? routes.ask : `${routes.ask}?c=${conversationId}`;
}

/** The conversation an address's `c` parameter names; null (a new chat) when it names none. */
export function conversationIdFromParam(param: string | null): string | null {
  if (param === null) return null;
  const id = param.toLowerCase();
  return ConversationIdSchema.safeParse(id).success ? id : null;
}
