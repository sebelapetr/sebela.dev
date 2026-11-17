import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Timeline } from "@sebela/ui/components/timeline";

import { Footer, routes } from "../../_shared";
import type { ExperienceContent } from "../../profile";
import { ExperienceEntry } from "../components/experience-entry";
import { careerYears, toTimelineEntries } from "../data/timeline";
import { deepLinkIndex } from "../stores/deep-link";
import { DisclosuresProvider } from "../stores/disclosures";

/**
 * The experience page: the person's headline and length of career, a link to the CV, and every
 * published experience on one timeline in the API's order, with its projects and case studies. A
 * link to an experience, a project or a case study opens what encloses it. Without experiences the
 * page says so.
 */
export function ExperienceTemplate({ content }: { readonly content: ExperienceContent }) {
  const entries = toTimelineEntries(content.experiences, content.logos, content.authorPhotos);
  const years = careerYears(content.careerStartedOn, new Date());
  return (
    <>
      <main className="layout-page flex flex-1 flex-col gap-24 py-12 sm:py-20 md:gap-32">
        <header className="flex max-w-3xl flex-col gap-6">
          <h1 className="flex flex-col gap-3">
            <span className="type-label">{content.name}</span>
            <span className="type-title">Experience</span>
          </h1>
          <div className="type-lead flex flex-col gap-2">
            <p>{content.headline}</p>
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
          <DisclosuresProvider
            index={deepLinkIndex(entries)}
            initiallyOpen={entries.filter((entry) => entry.current).map((entry) => entry.anchor)}
          >
            <Timeline aria-label="Career timeline" className="max-w-3xl">
              {entries.map((entry) => (
                <ExperienceEntry key={entry.slug} entry={entry} />
              ))}
            </Timeline>
          </DisclosuresProvider>
        )}
      </main>
      <Footer name={content.name} />
    </>
  );
}
