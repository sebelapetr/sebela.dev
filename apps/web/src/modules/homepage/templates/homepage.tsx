import { Footer, mainContentId, SiteHeader } from "../../_shared";
import type { HomepageProfile } from "../../profile";
import { ProfileStructuredData } from "../../seo";
import { Contact } from "../components/contact";
import { ExperienceSnapshot } from "../components/experience-snapshot";
import { Hero } from "../components/hero";
import { Now } from "../components/now";
import { SelectedWork } from "../components/selected-work";
import { ServicesSummary } from "../components/services-summary";
import { WhatIDo } from "../components/what-i-do";
import { toExperienceSnapshot } from "../data/experience-snapshot";
import { toNow } from "../data/now";
import { toSelectedWork } from "../data/selected-work";
import { toServicesSummary } from "../data/services-summary";

/**
 * The whole homepage in the PRD's order: the hero, What I do, the selected work, the experience
 * snapshot with the CV's actions, Now, the services in short, the closing contact block and the
 * footer, with the profile's structured data. Selected work, Now and the services are left out when they have no content; the
 * snapshot's career length is counted to today.
 */
export function HomepageTemplate({ profile }: { readonly profile: HomepageProfile }) {
  const selectedWork = toSelectedWork(profile.projects);
  const snapshot = toExperienceSnapshot(profile, new Date());
  const now = toNow(profile.currentFocus, profile.explorations);
  const services = toServicesSummary(profile.services);
  return (
    <>
      <ProfileStructuredData profile={profile} />
      <SiteHeader name={profile.name} />
      <main
        id={mainContentId}
        className="layout-page flex flex-1 flex-col gap-24 py-12 sm:py-20 md:gap-32"
      >
        <Hero profile={profile} />
        <WhatIDo />
        {selectedWork.length === 0 ? null : <SelectedWork items={selectedWork} />}
        <ExperienceSnapshot snapshot={snapshot} cvPdf={profile.cvPdf} />
        {now === null ? null : <Now now={now} />}
        {services.length === 0 ? null : <ServicesSummary services={services} />}
        <Contact contact={profile.contact} />
      </main>
      <Footer name={profile.name} />
    </>
  );
}
