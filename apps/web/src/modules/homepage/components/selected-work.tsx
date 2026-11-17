import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

import { ProseMarkdown, routes } from "../../_shared";
import type { SelectedWorkItem } from "../data/selected-work";

/**
 * The homepage's most prominent block: the selected projects as numbered editorial rows, each with
 * its period, technologies, problem, the person's role (only with a case study) and result, and a
 * link to the exact case study or project on the experience page. The caller leaves the block out
 * when nothing is selected.
 */
export function SelectedWork({ items }: { readonly items: readonly SelectedWorkItem[] }) {
  return (
    <section aria-labelledby="selected-work-heading" className="flex flex-col gap-10">
      <h2 id="selected-work-heading" className="type-heading">
        Selected work
      </h2>
      <ol className="flex flex-col gap-12">
        {items.map((item) => (
          <li
            key={item.slug}
            className="grid gap-4 border-t border-border pt-6 sm:grid-cols-[5rem_minmax(0,1fr)] sm:gap-8"
          >
            <span aria-hidden="true" className="type-label text-foreground">
              {item.number}
            </span>
            <div className="flex min-w-0 flex-col gap-5">
              <div className="flex flex-col gap-1">
                <h3 className="type-item">{item.name}</h3>
                <p className="type-label text-balance">{item.period}</p>
              </div>
              <dl className="grid max-w-prose gap-4 text-pretty">
                <Part label="Problem">
                  <ProseMarkdown>{item.problem}</ProseMarkdown>
                </Part>
                {item.role === null ? null : (
                  <Part label="My role">
                    <p>{item.role}</p>
                  </Part>
                )}
                <Part label="Result">
                  <ProseMarkdown>{item.result}</ProseMarkdown>
                </Part>
              </dl>
              {item.technologies.length === 0 ? null : (
                <ul
                  aria-label={`${item.name} technologies`}
                  className="type-label flex flex-wrap gap-x-3 gap-y-1"
                >
                  {item.technologies.map((technology) => (
                    <li key={technology.slug}>{technology.name}</li>
                  ))}
                </ul>
              )}
              <p>
                <Link
                  href={item.href}
                  aria-label={`${linkLabel(item)}: ${item.name}`}
                  className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline focus-visible:underline"
                >
                  {linkLabel(item)}
                  <ArrowRight aria-hidden="true" className="size-4" />
                </Link>
              </p>
            </div>
          </li>
        ))}
      </ol>
      <p>
        <Link
          href={routes.experience}
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline focus-visible:underline"
        >
          View full experience
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </p>
    </section>
  );
}

function Part({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="type-label">{label}</dt>
      <dd className="[&>*+*]:mt-3">{children}</dd>
    </div>
  );
}

/** What the row's link leads to: the case study when there is one (and so a role), else the project. */
function linkLabel(item: SelectedWorkItem): string {
  return item.role === null ? "View the project" : "Read the case study";
}
