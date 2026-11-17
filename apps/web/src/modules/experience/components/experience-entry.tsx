import { TimelineContent, TimelineItem, TimelineTrigger } from "@sebela/ui/components/timeline";

import type { TimelineEntry } from "../data/timeline";
import { SummaryMarkdown } from "./markdown";

/**
 * One experience on the timeline. Its row names the period, the kind of work, the role and the
 * organization; opening it shows the summary, the responsibilities, the technologies and the
 * testimonials that belong to this experience. Current experiences are open at first.
 */
export function ExperienceEntry({ entry }: { readonly entry: TimelineEntry }) {
  return (
    <TimelineItem id={entry.anchor} defaultOpen={entry.current} className="scroll-mt-8">
      <h2>
        <TimelineTrigger>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className="font-mono tracking-tight text-balance">{entry.period}</span>
            <span className="rounded-sm border border-border px-1.5 py-px text-xs font-medium">
              {entry.kindLabel}
            </span>
          </span>
          <span className="text-lg leading-snug font-semibold tracking-tight text-pretty sm:text-xl">
            {entry.title}
            <span className="font-normal text-muted-foreground"> · {entry.organization.name}</span>
          </span>
        </TimelineTrigger>
      </h2>
      <TimelineContent>
        <div className="flex max-w-prose flex-col gap-5 text-base leading-relaxed text-pretty">
          <div className="text-muted-foreground [&>*+*]:mt-3">
            <SummaryMarkdown>{entry.summary}</SummaryMarkdown>
          </div>
          {entry.responsibilities.length === 0 ? null : (
            <ul aria-label="Responsibilities" className="list-disc space-y-1.5 pl-5">
              {entry.responsibilities.map((responsibility) => (
                <li key={responsibility}>{responsibility}</li>
              ))}
            </ul>
          )}
          {entry.technologies.length === 0 ? null : (
            <ul
              aria-label="Technologies"
              className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-sm text-muted-foreground"
            >
              {entry.technologies.map((technology) => (
                <li key={technology.slug}>{technology.name}</li>
              ))}
            </ul>
          )}
          {entry.organization.website === null ? null : (
            <p>
              <a
                href={entry.organization.website}
                className="inline-flex min-h-11 items-center text-sm font-medium break-all underline-offset-4 hover:underline focus-visible:underline"
              >
                {entry.organization.name} website
              </a>
            </p>
          )}
          {entry.testimonials.map((testimonial) => (
            <figure
              key={testimonial.slug}
              className="flex flex-col gap-2 border-l-2 border-foreground pl-4"
            >
              <blockquote className="text-foreground italic">
                <p>“{testimonial.quote}”</p>
              </blockquote>
              <figcaption className="text-sm text-muted-foreground">
                {testimonial.authorName}, {testimonial.authorRole}
              </figcaption>
            </figure>
          ))}
        </div>
      </TimelineContent>
    </TimelineItem>
  );
}
