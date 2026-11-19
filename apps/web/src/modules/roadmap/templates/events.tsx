import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { ProseMarkdown } from "../../_shared";
import type { RoadmapEventsContent } from "../../profile";
import { TypeBadge } from "../components/badges";
import { RoadmapFrame } from "../components/roadmap-frame";
import { EVENTS_NAME, toEventsPage, type EventRow } from "../data/events";

const LINK =
  "inline-flex min-h-11 items-center rounded-sm underline-offset-4 hover:underline focus-visible:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

/**
 * The roadmap's events under its sub-navigation: their name and what they are, then every event,
 * newest first and grouped by the year it starts in, as an editorial row — its period and kind,
 * its name (a link opening in a new tab only when it is safe), its organizer, place and the time
 * spent at it, its Markdown takeaways (rendered safely), its topics and the way to its first day in
 * the learning diary. No events says so.
 */
export function RoadmapEventsTemplate({ content }: { readonly content: RoadmapEventsContent }) {
  const page = toEventsPage(content.events);
  return (
    <RoadmapFrame name={content.name} section="events">
      <div className="flex max-w-3xl flex-col gap-12">
        <header className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            <p className="type-label">AI Roadmap</p>
            <h1 className="type-title">{EVENTS_NAME}</h1>
          </div>
          <p className="type-lead max-w-prose text-muted-foreground">
            Conferences, meetups, workshops and lectures attended along the roadmap, and what each
            of them left behind.
          </p>
        </header>
        {page.years.length === 0 ? (
          <p className="text-base text-muted-foreground">No events yet.</p>
        ) : (
          page.years.map((group) => (
            <section
              key={group.year}
              aria-labelledby={`events-${group.year}`}
              className="flex flex-col gap-6"
            >
              <h2 id={`events-${group.year}`} className="type-heading tabular-nums">
                {group.year}
              </h2>
              <ol aria-label={`Events in ${group.year}`} className="flex flex-col">
                {group.events.map((event) => (
                  <Event key={event.slug} event={event} />
                ))}
              </ol>
            </section>
          ))
        )}
      </div>
    </RoadmapFrame>
  );
}

/** One event as an editorial row under a 1 px rule. */
function Event({ event }: { readonly event: EventRow }) {
  return (
    <li className="flex flex-col gap-2 border-t border-border py-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="type-label tabular-nums">
          {/* The period in words, dated by its first day: the date the list is ordered by. */}
          <time dateTime={event.startsOn}>{event.period}</time>
        </p>
        <TypeBadge label={event.kindLabel} />
      </div>
      <h3 className="type-item wrap-anywhere">
        {event.href === null ? (
          <span className="inline-flex min-h-11 items-center">{event.name}</span>
        ) : (
          <a href={event.href} target="_blank" rel="noopener noreferrer" className={LINK}>
            <span>
              {event.name}
              <span className="sr-only"> (opens in a new tab)</span>
            </span>
          </a>
        )}
      </h3>
      {event.details === null && event.attendance === null ? null : (
        <p className="text-sm wrap-anywhere text-muted-foreground">
          {[event.details, event.attendance === null ? null : `${event.attendance} attended`]
            .filter((part) => part !== null)
            .join(" · ")}
        </p>
      )}
      {event.takeaways === null ? null : (
        <div className="max-w-prose text-base wrap-anywhere text-muted-foreground [&>*+*]:mt-3">
          <ProseMarkdown>{event.takeaways}</ProseMarkdown>
        </div>
      )}
      {event.topics.length === 0 ? null : (
        <p className="text-sm wrap-anywhere text-muted-foreground">
          <span className="font-medium text-foreground">Topics:</span> {event.topics.join(", ")}
        </p>
      )}
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
