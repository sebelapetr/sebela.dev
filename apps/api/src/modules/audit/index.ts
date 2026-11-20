// The audit's HTTP route: the authenticated, bounded read of the newest audited content changes.
// The audited writes themselves are composed by the app around every write route; this module only
// exposes what they recorded.
import { RecentChangesSchema, recentChangesLimit } from "@sebela/contracts";
import type { AuditService } from "@sebela/services";

import { defineRoute, type RouteDefinition } from "../../routing.js";

/** The routes of the content audit over the audit service. */
export function auditRoutes(audit: Pick<AuditService, "recentChanges">): RouteDefinition[] {
  return [
    defineRoute({
      operationId: "listRecentChanges",
      method: "GET",
      path: "/v1/audit/changes",
      access: "private",
      summary: "Read the newest content changes",
      description:
        `The newest ${String(recentChangesLimit)} audited content changes, newest first: one per ` +
        "record a committed write changed, with the verified API key that made it, the operation " +
        "and route, the provenance label the caller stated, and the record's public read before " +
        "and after. A refused or failed write records nothing. A caller that lost the response to " +
        "a write reads this to learn whether the write committed before it tries again. The " +
        "provenance label is what a caller stated, never proof of who acted or that a human approved.",
      response: {
        status: 200,
        description: "The newest changes.",
        schema: RecentChangesSchema,
      },
      errors: [],
      handle: async () => ({ changes: await audit.recentChanges() }),
    }),
  ];
}
