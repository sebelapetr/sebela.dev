import type { Service } from "@sebela/api-client";

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

export function toServicesSummary(services: readonly Service[]): ServiceSummary[] {
  throw new Error(`not implemented: ${String(services.length)}`);
}
