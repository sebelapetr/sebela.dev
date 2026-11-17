import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Timeline } from "@sebela/ui/components/timeline";

import { Footer, routes } from "../../_shared";
import type { ExperienceContent } from "../../profile";
import { ExperienceEntry } from "../components/experience-entry";
import { careerYears, toTimelineEntries } from "../data/timeline";

/**
 * The experience page: the person's headline and length of career, a link to the CV, and every
 * published experience on one timeline in the API's order. Without experiences the page says so.
 */
export function ExperienceTemplate({ content }: { readonly content: ExperienceContent }) {
  const entries = toTimelineEntries(content.experiences);
  const years = careerYears(content.careerStartedOn, new Date());
  return (
    <>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-12 px-5 py-12 sm:px-8 sm:py-20 md:gap-16">
        <header className="flex flex-col gap-5">
          <h1 className="flex flex-col gap-3">
            <span className="font-mono text-sm tracking-tight text-muted-foreground">
              {content.name}
            </span>
            <span className="text-4xl font-semibold tracking-tight sm:text-5xl">Experience</span>
          </h1>
          <div className="flex max-w-prose flex-col gap-2 text-lg leading-relaxed text-pretty">
            <p className="text-muted-foreground">{content.headline}</p>
            {years === null ? null : (
              <p>
                {String(years)} {years === 1 ? "year" : "years"} of professional experience
              </p>
            )}
          </div>
          <p>
            <Link
              href={routes.cv}
              className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline focus-visible:underline"
            >
              Read the CV
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </p>
        </header>
        {entries.length === 0 ? (
          <p className="text-muted-foreground">No experience is published yet.</p>
        ) : (
          <Timeline aria-label="Career timeline">
            {entries.map((entry) => (
              <ExperienceEntry key={entry.slug} entry={entry} />
            ))}
          </Timeline>
        )}
      </main>
      <Footer name={content.name} />
    </>
  );
}
