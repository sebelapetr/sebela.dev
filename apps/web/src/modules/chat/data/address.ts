// The Ask page's address of a conversation: `/ask?c=<id>`, where the identifier is random and the
// question is never part of it.

export const conversationHref = (conversationId: string | null): string => {
  throw new Error(`not implemented: ${String(conversationId)}`);
};

export const conversationIdFromParam = (param: string | null): string | null => {
  throw new Error(`not implemented: ${String(param)}`);
};
