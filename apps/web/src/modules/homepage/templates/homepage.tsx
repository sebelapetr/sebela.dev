import { Footer } from "../../_shared";
import type { HomepageProfile } from "../../profile";
import { Contact } from "../components/contact";
import { Hero } from "../components/hero";

/** The whole homepage: the hero, the closing contact block and the footer. */
export function HomepageTemplate({ profile }: { readonly profile: HomepageProfile }) {
  return (
    <>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-24 px-5 py-12 sm:px-8 sm:py-20 md:gap-32">
        <Hero profile={profile} />
        <Contact contact={profile.contact} />
      </main>
      <Footer name={profile.name} />
    </>
  );
}
