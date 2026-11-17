import type { Service } from "@sebela/api-client";

import { anchorHref } from "../../_shared";

/** One service on the homepage: its name and summary, linking to its full description. */
export interface ServiceSummary {
  readonly slug: string;
  /** Two digits: `01`, `02`, … */
  readonly number: string;
  readonly name: string;
  /** Markdown. */
  readonly summary: string;
  /** The service on the services page. */
  readonly href: string;
}

/**
 * The services as short, numbered summaries in the API's order, each linking to its full entry on
 * the services page; the audience, deliverable and evidence stay there. Empty without services.
 */
export function toServicesSummary(services: readonly Service[]): ServiceSummary[] {
  return services.map((service, position) => ({
    slug: service.slug,
    number: String(position + 1).padStart(2, "0"),
    name: service.name,
    summary: service.summary,
    href: anchorHref({ kind: "service", slug: service.slug }),
  }));
}
