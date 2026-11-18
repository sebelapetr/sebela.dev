import Link from "next/link";

import { InlineMarkdown } from "./markdown";
import { TextLink } from "./text-link";
import { routes } from "../../_shared";
import type { ServiceSummary } from "../data/services-summary";

/**
 * The services in short: numbered rows with each service's name, linking to its full entry on the
 * services page, and its one-sentence summary, then the link to all services. The caller leaves the block out
 * without services.
 */
export function ServicesSummary({ services }: { readonly services: readonly ServiceSummary[] }) {
  return (
    <section aria-labelledby="services-summary-heading" className="flex flex-col gap-10">
      <h2 id="services-summary-heading" className="type-heading">
        Services
      </h2>
      <ol className="flex flex-col gap-8">
        {services.map((service) => (
          <li
            key={service.slug}
            className="grid gap-3 border-t border-border pt-6 sm:grid-cols-[5rem_minmax(0,1fr)] sm:gap-8"
          >
            <span aria-hidden="true" className="type-label text-foreground">
              {service.number}
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <h3 className="type-item">
                <Link
                  href={service.href}
                  prefetch={false}
                  className="inline-flex min-h-11 items-center underline-offset-4 hover:underline focus-visible:underline"
                >
                  {service.name}
                </Link>
              </h3>
              <div className="max-w-prose text-pretty text-muted-foreground">
                <InlineMarkdown>{service.summary}</InlineMarkdown>
              </div>
            </div>
          </li>
        ))}
      </ol>
      <p>
        <TextLink href={routes.services}>All services</TextLink>
      </p>
    </section>
  );
}
