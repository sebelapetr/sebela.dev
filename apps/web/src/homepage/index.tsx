// The homepage module: the sections of the homepage, rendered from the profile the API supplies.
import type { HomepageProfile } from "../profile";
import { Contact } from "./contact";
import { Hero } from "./hero";

/** The homepage's main content: the hero and the closing contact block. */
export function Homepage({ profile }: { readonly profile: HomepageProfile }) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-24 px-5 py-12 sm:px-8 sm:py-20 md:gap-32">
      <Hero profile={profile} />
      <Contact contact={profile.contact} />
    </main>
  );
}
