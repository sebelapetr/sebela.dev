import { Footer } from "../../_shared";
import type { HomepageProfile } from "../../profile";
import { Contact } from "../components/contact";
import { Hero } from "../components/hero";
import { SelectedWork } from "../components/selected-work";
import { toSelectedWork } from "../data/selected-work";

/**
 * The whole homepage: the hero, the selected work (left out when nothing is selected), the closing
 * contact block and the footer.
 */
export function HomepageTemplate({ profile }: { readonly profile: HomepageProfile }) {
  const selectedWork = toSelectedWork(profile.projects);
  return (
    <>
      <main className="layout-page flex flex-1 flex-col gap-24 py-12 sm:py-20 md:gap-32">
        <Hero profile={profile} />
        {selectedWork.length === 0 ? null : <SelectedWork items={selectedWork} />}
        <Contact contact={profile.contact} cvPdf={profile.cvPdf} />
      </main>
      <Footer name={profile.name} />
    </>
  );
}
