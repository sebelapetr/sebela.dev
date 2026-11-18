// The homepage's structured data (schema.org JSON-LD): the website, the profile page and the person
// it is about, from the profile the API supplies. It states only what the profile holds — name,
// headline, bio, photo, email and web links — and never derives skills or achievements.
import { plainText } from "../../_shared";
import type { HomepageProfile } from "../../profile";

/** What the person's structured data rests on. */
export type StructuredProfile = Pick<
  HomepageProfile,
  "name" | "headline" | "shortBio" | "photo" | "contact"
>;

/** The schema.org graph of the homepage on `origin`: a WebSite, a ProfilePage and a Person. */
export function profileStructuredData(origin: string, profile: StructuredProfile): object {
  const home = `${origin}/`;
  const ids = {
    website: `${home}#website`,
    page: `${home}#profile-page`,
    person: `${home}#person`,
  };
  const bio = plainText(profile.shortBio);
  const links = profile.contact.links.map((link) => link.url);
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": ids.website,
        url: home,
        name: profile.name,
        description: profile.headline,
        inLanguage: "en",
        publisher: { "@id": ids.person },
      },
      {
        "@type": "ProfilePage",
        "@id": ids.page,
        url: home,
        name: `${profile.name} — ${profile.headline}`,
        ...(bio === "" ? {} : { description: bio }),
        isPartOf: { "@id": ids.website },
        mainEntity: { "@id": ids.person },
      },
      {
        "@type": "Person",
        "@id": ids.person,
        name: profile.name,
        description: profile.headline,
        url: home,
        ...(profile.photo === null ? {} : { image: new URL(profile.photo.url, home).href }),
        ...(profile.contact.email === null ? {} : { email: profile.contact.email.address }),
        ...(links.length === 0 ? {} : { sameAs: links }),
      },
    ],
  };
}

const UNSAFE: Record<string, string> = {
  "<": "\\u003c",
  ">": "\\u003e",
  "&": "\\u0026",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
};

/**
 * JSON for a `<script type="application/ld+json">` element: the characters that could close the
 * element, open a comment or end a JavaScript line are written as `\u` escapes, so the text stays
 * the same data and can never become markup.
 */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (char) => UNSAFE[char] ?? char);
}
