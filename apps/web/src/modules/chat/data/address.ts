// The Ask page's address of a question the hero hands off: `/ask?c=<id>`, where the identifier is
// random, names only the question left in this tab, and never names or opens a conversation (the
// API resolves the visitor's conversation from its cookie). The question is never part of it.
import { z } from "zod";

import { routes } from "../../_shared";

const HandOffIdSchema = z.uuid();

/** The Ask page's address that takes the hand-off there; the page itself without one. */
export function handOffHref(handOffId: string | null): string {
  return handOffId === null ? routes.ask : `${routes.ask}?c=${handOffId}`;
}

/** The hand-off an address's `c` parameter names; null when it names none. */
export function handOffIdFromParam(param: string | null): string | null {
  if (param === null) return null;
  const id = param.toLowerCase();
  return HandOffIdSchema.safeParse(id).success ? id : null;
}
