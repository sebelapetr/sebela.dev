import { TimelineContent, TimelineTrigger } from "@sebela/ui/components/timeline";

import { ProseMarkdown } from "../../_shared";
import type { TimelineEntry } from "../data/timeline";
import { AuthorPhoto } from "./author-photo";
import { ExperienceItem } from "./disclosures";
import { OrganizationLogo } from "./organization-logo";
import { ProjectList } from "./project-list";

/**
 * One experience on the timeline. Its row names the period, the kind of work, the role and the
 * organization, with the organization's logo above them when it has one; opening it shows the
 * summary, the responsibilities, the technologies, the projects delivered within it with their
 * case studies, and the testimonials that belong to this experience, each with its author's photo
 * beside the quote when it has one. Current experiences are open at first; a link to the experience
 * or anything inside it opens it.
 */
export function ExperienceEntry({ entry }: { readonly entry: TimelineEntry }) {
  return (
    <ExperienceItem anchor={entry.anchor}>
      <h2>
        <TimelineTrigger>
          {entry.organization.logo === null ? null : (
            <span className="mb-1 flex">
              <OrganizationLogo logo={entry.organization.logo} />
            </span>
          )}
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
            <span className="type-label text-balance">{entry.period}</span>
            <span className="type-tag rounded-sm border border-border px-1.5">
              {entry.kindLabel}
            </span>
          </span>
          <span className="type-item">
            {entry.title}
            <span className="font-normal text-muted-foreground"> · {entry.organization.name}</span>
          </span>
        </TimelineTrigger>
      </h2>
      <TimelineContent>
        <div className="flex max-w-prose flex-col gap-6 text-pretty">
          <div className="text-muted-foreground [&>*+*]:mt-3">
            <ProseMarkdown>{entry.summary}</ProseMarkdown>
          </div>
          {entry.responsibilities.length === 0 ? null : (
            <ul aria-label="Responsibilities" className="list-disc space-y-2 pl-6">
              {entry.responsibilities.map((responsibility) => (
                <li key={responsibility}>{responsibility}</li>
              ))}
            </ul>
          )}
          {entry.technologies.length === 0 ? null : (
            <ul aria-label="Technologies" className="type-label flex flex-wrap gap-x-3 gap-y-1">
              {entry.technologies.map((technology) => (
                <li key={technology.slug}>{technology.name}</li>
              ))}
            </ul>
          )}
          {entry.projects.length === 0 ? null : <ProjectList projects={entry.projects} />}
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
              <div className="flex items-start gap-4">
                <blockquote className="min-w-0 flex-1 text-foreground italic">
                  <p>“{testimonial.quote}”</p>
                </blockquote>
                {testimonial.authorPhoto === null ? null : (
                  <AuthorPhoto photo={testimonial.authorPhoto} />
                )}
              </div>
              <figcaption className="text-sm text-muted-foreground">
                {testimonial.authorName}, {testimonial.authorRole}
              </figcaption>
            </figure>
          ))}
        </div>
      </TimelineContent>
    </ExperienceItem>
  );
}
