// The retrieval route: the authenticated search of the indexed knowledge. It only reads, so it is a
// read-only `POST` that is neither audited nor announced; the query travels in the body, never in a
// URL or a log.
import {
  SearchRequestSchema,
  SearchResultSchema,
  retrievalMaxPassages,
  retrievalQueryMaxLength,
} from "@sebela/contracts";
import type { KnowledgeService } from "@sebela/services";

import { defineRoute, type RouteDefinition } from "../../routing.js";

/** The routes of the knowledge base over the knowledge service. */
export function retrievalRoutes(knowledge: Pick<KnowledgeService, "search">): RouteDefinition[] {
  return [
    defineRoute({
      operationId: "searchKnowledge",
      method: "POST",
      path: "/v1/retrieval/search",
      access: "private",
      readOnly: true,
      summary: "Search the indexed knowledge",
      description:
        `Embeds a query of at most ${String(retrievalQueryMaxLength)} characters and returns up to ` +
        `${String(retrievalMaxPassages)} passages of the indexed public portfolio, best first, each ` +
        "with its source, version, canonical site path and provenance, optionally only of the given " +
        "content kinds. When no passage reaches the configured relevance floor the result is " +
        "`no_evidence`. A provider that is not configured, fails or times out, or a month's spend " +
        "at its ceiling, is a 503 and never no evidence. It reads only and changes no content.",
      body: SearchRequestSchema,
      response: {
        status: 200,
        description: "The passages or no evidence.",
        schema: SearchResultSchema,
      },
      errors: ["provider_unavailable"],
      handle: ({ body }) => knowledge.search(body),
    }),
  ];
}
