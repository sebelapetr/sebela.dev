import Link from "next/link";
import { ArrowRight } from "lucide-react";

import type { RoadmapStatisticsContent } from "../../profile";
import { TypeBadge } from "../components/badges";
import { BookLink } from "../components/book-parts";
import { Breadcrumbs } from "../components/breadcrumbs";
import { RoadmapFrame } from "../components/roadmap-frame";
import { DIARY_NAME } from "../data/diary";
import {
  STATISTICS_NAME,
  toStatisticsPage,
  type StatisticsArea,
  type StatisticsBarRow,
  type StatisticsEvent,
  type StatisticsPeriod,
  type StatisticsResource,
} from "../data/statistics";

const LINK =
  "inline-flex min-h-11 items-center rounded-sm underline-offset-4 hover:underline focus-visible:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

const ROW = "flex flex-col gap-1 border-t border-border py-4 first:border-t-0 first:pt-0";

/**
 * The learning statistics under the roadmap's sub-navigation: the way from the overview through the
 * diary, then the API's totals — total time, study days and the average per day — and the total
 * split into resources, books and events; the study time by area and module, each with a bar of its
 * share of study time, saying that event attendance belongs to no area; the most recent days (each
 * leading to its diary day), weeks and every month; the resources with time (each leading to its
 * place on its module's page and a book's resource to the book) and the events with attendance
 * (each leading to the diary's page of its first day). Without any logged time it says so.
 */
export function RoadmapStatisticsTemplate({
  content,
}: {
  readonly content: RoadmapStatisticsContent;
}) {
  const page = toStatisticsPage(content.statistics);
  return (
    <RoadmapFrame name={content.name} section="diary">
      <article className="flex max-w-3xl flex-col gap-12">
        <header className="flex flex-col gap-6">
          <Breadcrumbs crumbs={page.breadcrumbs} />
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3">
              <p className="type-label">{DIARY_NAME}</p>
              <h1 className="type-title">{STATISTICS_NAME}</h1>
            </div>
            <p className="type-lead max-w-prose text-muted-foreground">
              How the time logged in the diary adds up: by kind, by area and module, and over time.
            </p>
          </div>
        </header>
        {page.empty ? (
          <p className="text-base text-muted-foreground">No time logged yet.</p>
        ) : (
          <>
            <section aria-labelledby="statistics-totals-heading" className="flex flex-col gap-8">
              <h2 id="statistics-totals-heading" className="sr-only">
                Totals
              </h2>
              <dl className="grid grid-cols-1 gap-6 sm:grid-cols-3">
                {page.figures.map((figure) => (
                  <div key={figure.label} className="flex flex-col gap-1">
                    <dt className="type-label">{figure.label}</dt>
                    <dd className="type-heading tabular-nums">{figure.value}</dd>
                  </div>
                ))}
              </dl>
              <div className="flex flex-col gap-3">
                <h3 className="type-item">By kind</h3>
                <dl className="flex flex-col">
                  {page.categories.map((category) => (
                    <div
                      key={category.label}
                      className="flex items-baseline justify-between gap-4 border-t border-border py-3 first:border-t-0 first:pt-0"
                    >
                      <dt className="font-medium">{category.label}</dt>
                      <dd className="type-label shrink-0 tabular-nums">
                        {category.value} · {category.share}
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="text-sm text-muted-foreground">
                  Resources, books and events together make the total time.
                </p>
              </div>
            </section>
            {page.areas.length === 0 ? null : (
              <section aria-labelledby="statistics-areas-heading" className="flex flex-col gap-6">
                <div className="flex flex-col gap-3">
                  <h2 id="statistics-areas-heading" className="type-heading">
                    Time by area
                  </h2>
                  <p className="max-w-prose text-sm text-muted-foreground">
                    Shares of the {page.studyTime} studied on resources and books. Time at events
                    belongs to no area.
                  </p>
                </div>
                <ol aria-label="Areas" className="flex flex-col">
                  {page.areas.map((area) => (
                    <AreaRow key={area.slug} area={area} />
                  ))}
                </ol>
              </section>
            )}
            {page.recentDays.length === 0 ? null : (
              <PeriodSection id="days" title="Recent activity" periods={page.recentDays} />
            )}
            {page.weeks.length === 0 ? null : (
              <PeriodSection id="weeks" title="By week" periods={page.weeks} />
            )}
            {page.months.length === 0 ? null : (
              <PeriodSection id="months" title="By month" periods={page.months} />
            )}
            {page.resources.length === 0 ? null : (
              <section
                aria-labelledby="statistics-resources-heading"
                className="flex flex-col gap-6"
              >
                <h2 id="statistics-resources-heading" className="type-heading">
                  Resources
                </h2>
                <ol aria-label="Resources with logged time" className="flex flex-col">
                  {page.resources.map((resource) => (
                    <ResourceRow key={resource.slug} resource={resource} />
                  ))}
                </ol>
              </section>
            )}
            {page.events.length === 0 ? null : (
              <section aria-labelledby="statistics-events-heading" className="flex flex-col gap-6">
                <div className="flex flex-col gap-3">
                  <h2 id="statistics-events-heading" className="type-heading">
                    Events
                  </h2>
                  <p className="max-w-prose text-sm text-muted-foreground">
                    Time at events counts toward the total, never toward an area.
                  </p>
                </div>
                <ol aria-label="Events with logged time" className="flex flex-col">
                  {page.events.map((event) => (
                    <EventRow key={event.slug} event={event} />
                  ))}
                </ol>
              </section>
            )}
          </>
        )}
      </article>
    </RoadmapFrame>
  );
}

/** A name with its time and share on one line, then a bar of the share (decorative). */
function BarRow({ row, as }: { readonly row: StatisticsBarRow; readonly as: "h3" | "p" }) {
  const Name = as;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <Name className={as === "h3" ? "type-item wrap-anywhere" : "font-medium wrap-anywhere"}>
          {row.href === null ? (
            <span className="inline-flex min-h-11 items-center">{row.name}</span>
          ) : (
            <Link href={row.href} prefetch={false} className={LINK}>
              {row.name}
            </Link>
          )}
        </Name>
        <p className="type-label shrink-0 tabular-nums">
          {row.value} · {row.share}
        </p>
      </div>
      <div aria-hidden="true" className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${String(row.percent)}%` }}
        />
      </div>
    </div>
  );
}

function AreaRow({ area }: { readonly area: StatisticsArea }) {
  return (
    <li className="flex flex-col gap-4 border-t border-border py-6 first:border-t-0 first:pt-0">
      <BarRow row={area} as="h3" />
      {area.modules.length === 0 ? null : (
        <ul
          aria-label={`Modules of ${area.name}`}
          className="flex flex-col gap-3 border-l border-border pl-4"
        >
          {area.modules.map((module) => (
            <li key={module.slug}>
              <BarRow row={module} as="p" />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** Days, weeks or months, newest first; a day leads to its page in the diary. */
function PeriodSection({
  id,
  title,
  periods,
}: {
  readonly id: string;
  readonly title: string;
  readonly periods: readonly StatisticsPeriod[];
}) {
  const headingId = `statistics-${id}-heading`;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-6">
      <h2 id={headingId} className="type-heading">
        {title}
      </h2>
      <ol aria-labelledby={headingId} className="flex flex-col">
        {periods.map((period) => (
          <li key={period.key} className={ROW}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4">
              <p className="font-medium wrap-anywhere">
                {period.href === null ? (
                  <span className="inline-flex min-h-11 items-center">
                    <time dateTime={period.key}>{period.label}</time>
                  </span>
                ) : (
                  <Link href={period.href} prefetch={false} className={LINK}>
                    <time dateTime={period.key}>{period.label}</time>
                  </Link>
                )}
              </p>
              <p className="type-label shrink-0 tabular-nums">{period.value}</p>
            </div>
            {period.split === null ? null : (
              <p className="text-sm text-muted-foreground tabular-nums">{period.split}</p>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** A resource with its time: the way to it on its module's page, and to the book it reads. */
function ResourceRow({ resource }: { readonly resource: StatisticsResource }) {
  return (
    <li className={ROW}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h3 className="font-medium wrap-anywhere">
          <Link href={resource.href} prefetch={false} className={LINK}>
            {resource.name}
          </Link>
        </h3>
        <p className="type-label shrink-0 tabular-nums">{resource.value}</p>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <TypeBadge label={resource.typeLabel} />
        <p className="text-sm text-muted-foreground wrap-anywhere">
          {resource.categoryLabel} · {resource.place}
        </p>
        {resource.book === null ? null : (
          <BookLink href={resource.book.href} resource={resource.name} />
        )}
      </div>
    </li>
  );
}

/** An event with its attendance and the way to the diary's page of its first day. */
function EventRow({ event }: { readonly event: StatisticsEvent }) {
  return (
    <li className={ROW}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h3 className="font-medium wrap-anywhere">
          <span className="inline-flex min-h-11 items-center">{event.name}</span>
        </h3>
        <p className="type-label shrink-0 tabular-nums">{event.value}</p>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <TypeBadge label={event.kindLabel} />
        <p className="text-sm text-muted-foreground">
          <time dateTime={event.startsOn}>{event.period}</time>
        </p>
      </div>
      <p>
        <Link
          href={event.diaryHref}
          prefetch={false}
          aria-label={`In the learning diary: ${event.name}`}
          className={`${LINK} gap-1 text-sm font-medium`}
        >
          In the learning diary
          <ArrowRight aria-hidden="true" className="size-3.5" />
        </Link>
      </p>
    </li>
  );
}
