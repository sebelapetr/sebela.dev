import { Timeline } from "@sebela/ui/components/timeline";

import {
  careerYears,
  CvActions,
  Footer,
  toEducationRows,
  mainContentId,
  SiteHeader,
} from "../../_shared";
import type { ExperienceContent } from "../../profile";
import { EducationList } from "../components/education";
import { ExperienceEntry } from "../components/experience-entry";
import { IndependentRd } from "../components/independent-rd";
import { Technologies } from "../components/technologies";
import { toExplorationRows } from "../data/explorations";
import { toTechnologyGroups } from "../data/technologies";
import { TECHNOLOGY_LOGO_KEYS } from "../data/technology-logos";
import { toTimelineEntries } from "../data/timeline";
import { deepLinkIndex } from "../stores/deep-link";
import { DisclosuresProvider } from "../stores/disclosures";

/**
 * The experience page: the person's headline and length of career, the CV's actions (the PDF's
 * download and its date when there is one, and the live CV), every published experience on one
 * timeline in the API's order with its projects and case studies, then the independent R&D, the
 * technologies and the education, each left out when there is nothing to show. A link to an experience, a project, a case study, an exploration or a technology group
 * opens what encloses it. Without experiences the page says so.
 */
export function ExperienceTemplate({ content }: { readonly content: ExperienceContent }) {
  const entries = toTimelineEntries(content.experiences, content.logos, content.authorPhotos);
  const explorations = toExplorationRows(content.explorations);
  const technologies = toTechnologyGroups(content.technologies, TECHNOLOGY_LOGO_KEYS);
  const education = toEducationRows(content.education);
  const years = careerYears(content.careerStartedOn, new Date());
  return (
    <>
      <SiteHeader name={content.name} />
      <main
        id={mainContentId}
        className="layout-page flex flex-1 flex-col gap-24 py-12 sm:py-20 md:gap-32"
      >
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
          <CvActions pdf={content.cvPdf} />
        </header>
        <DisclosuresProvider
          index={deepLinkIndex({ timeline: entries, explorations, technologies })}
          initiallyOpen={entries.filter((entry) => entry.current).map((entry) => entry.anchor)}
        >
          {entries.length === 0 ? (
            <p className="text-muted-foreground">No experience is published yet.</p>
          ) : (
            <Timeline aria-label="Career timeline" className="max-w-3xl">
              {entries.map((entry) => (
                <ExperienceEntry key={entry.slug} entry={entry} />
              ))}
            </Timeline>
          )}
          {explorations.length === 0 ? null : <IndependentRd explorations={explorations} />}
          {technologies.length === 0 ? null : <Technologies groups={technologies} />}
        </DisclosuresProvider>
        {education.length === 0 ? null : <EducationList rows={education} />}
      </main>
      <Footer name={content.name} />
    </>
  );
}
